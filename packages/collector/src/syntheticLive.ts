import {
  generateSyntheticIR,
  mulberry32,
  type IR,
  type MetricsPatch,
  type SystemStatus,
} from '@sysopolis/core';

type IncidentPhase = 'unhealthy' | 'exited' | 'starting';

interface Incident {
  systemId: string;
  phase: IncidentPhase;
  ticksLeft: number;
}

/**
 * Drives the synthetic city: smooth metric noise every tick, plus a rolling
 * "incident story" — every so often a system degrades, dies, then comes back.
 */
export class SyntheticSim {
  readonly ir: IR;
  private readonly rand: () => number;
  private readonly cpuTarget = new Map<string, number>();
  private incident: Incident | null = null;
  private ticksUntilIncident: number;
  private readonly outWeight = new Map<string, number>();

  constructor(seed = 42) {
    this.ir = generateSyntheticIR(seed);
    this.rand = mulberry32(seed ^ 0x9e3779b9);
    this.ticksUntilIncident = 12 + Math.floor(this.rand() * 10);
    for (const s of this.ir.systems) {
      this.cpuTarget.set(s.id, 5 + this.rand() * 40);
    }
    // Traffic a system emits ∝ sum of its outgoing link weights.
    for (const l of this.ir.links) {
      this.outWeight.set(l.source, (this.outWeight.get(l.source) ?? 0) + (l.weight ?? 0.3));
    }
  }

  /** Advance one tick (~1s) and return the deltas to broadcast. */
  tick(): MetricsPatch[] {
    const patches: MetricsPatch[] = [];
    const statusChanges = this.advanceIncident();

    for (const s of this.ir.systems) {
      const newStatus = statusChanges.get(s.id);
      if (newStatus) s.status = newStatus;
      const alive = s.status === 'running' || s.status === 'unhealthy';

      // CPU drifts toward a per-system target that itself wanders.
      let target = this.cpuTarget.get(s.id) ?? 20;
      if (this.rand() < 0.05) target = 5 + this.rand() * 70;
      if (s.status === 'unhealthy') target = 85 + this.rand() * 14;
      this.cpuTarget.set(s.id, target);

      const prev = this.ir.metrics[s.id] ?? {};
      const cpu = alive
        ? Math.max(0, Math.min(100, (prev.cpu ?? target) + (target - (prev.cpu ?? target)) * 0.3 + (this.rand() - 0.5) * 8))
        : 0;
      const memPct = alive
        ? Math.max(2, Math.min(98, (prev.memPct ?? 30) + (this.rand() - 0.5) * 3))
        : 0;
      const flow = alive ? (this.outWeight.get(s.id) ?? 0.2) * (0.6 + 0.8 * this.rand()) : 0;
      const netOutBps = Math.round(flow * 2_500_000);
      const netInBps = Math.round(netOutBps * (0.4 + this.rand() * 1.2));

      const patch: MetricsPatch = { id: s.id, cpu: Math.round(cpu * 10) / 10, memPct: Math.round(memPct * 10) / 10, netInBps, netOutBps };
      if (newStatus) patch.status = newStatus;
      this.ir.metrics[s.id] = { status: s.status, cpu: patch.cpu, memPct: patch.memPct, netInBps, netOutBps };
      patches.push(patch);
    }
    return patches;
  }

  /** unhealthy → exited → starting → running, then a quiet period. */
  private advanceIncident(): Map<string, SystemStatus> {
    const changes = new Map<string, SystemStatus>();
    if (!this.incident) {
      if (--this.ticksUntilIncident <= 0) {
        const candidates = this.ir.systems.filter((s) => s.status === 'running');
        if (candidates.length > 0) {
          const victim = candidates[Math.floor(this.rand() * candidates.length)];
          this.incident = { systemId: victim.id, phase: 'unhealthy', ticksLeft: 5 + Math.floor(this.rand() * 4) };
          changes.set(victim.id, 'unhealthy');
          console.log(`[synthetic] incident: ${victim.label} is degrading…`);
        }
      }
      return changes;
    }

    if (--this.incident.ticksLeft > 0) return changes;
    const { systemId, phase } = this.incident;
    const label = this.ir.systems.find((s) => s.id === systemId)?.label ?? systemId;
    if (phase === 'unhealthy') {
      this.incident = { systemId, phase: 'exited', ticksLeft: 10 + Math.floor(this.rand() * 6) };
      changes.set(systemId, 'exited');
      console.log(`[synthetic] incident: ${label} DIED`);
    } else if (phase === 'exited') {
      this.incident = { systemId, phase: 'starting', ticksLeft: 3 };
      changes.set(systemId, 'starting');
      console.log(`[synthetic] incident: ${label} restarting…`);
    } else {
      changes.set(systemId, 'running');
      console.log(`[synthetic] incident: ${label} recovered`);
      this.incident = null;
      this.ticksUntilIncident = 15 + Math.floor(this.rand() * 20);
    }
    return changes;
  }
}
