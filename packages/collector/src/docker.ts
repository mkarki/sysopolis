import Docker from 'dockerode';
import {
  classifyImage,
  type IR,
  type Link,
  type MetricsPatch,
  type SystemNode,
  type SystemStatus,
} from '@sysopolis/core';

const USER_NETWORK_EXCLUDES = new Set(['bridge', 'host', 'none']);

export interface DockerWatcher {
  stop(): void;
}

interface ContainerInfoLite {
  Id: string;
  Names: string[];
  Image: string;
  ImageID: string;
  State: string;
  Status: string;
  Labels?: Record<string, string>;
  NetworkSettings?: { Networks?: Record<string, unknown> };
}

function shortId(id: string): string {
  return id.slice(0, 12);
}

function mapStatus(state: string, statusText: string): SystemStatus {
  if (/\(unhealthy\)/i.test(statusText)) return 'unhealthy';
  if (/\(health: starting\)/i.test(statusText)) return 'starting';
  switch (state) {
    case 'running':
      return 'running';
    case 'restarting':
    case 'created':
      return 'starting';
    case 'exited':
    case 'dead':
    case 'paused':
      return 'exited';
    default:
      return 'unknown';
  }
}

/** First user-defined network (fallback: bridge) — mapping rule from the build plan. */
function primaryNetwork(networks: string[]): string {
  const user = networks.filter((n) => !USER_NETWORK_EXCLUDES.has(n)).sort();
  return user[0] ?? networks[0] ?? 'bridge';
}

export class DockerAdapter {
  private readonly docker: Docker;
  private readonly imageSizeCache = new Map<string, number>();
  /** When set, only containers of this docker-compose project are mapped. */
  private readonly project?: string;

  constructor(options: { socketPath?: string; project?: string } = {}) {
    this.docker = options.socketPath ? new Docker({ socketPath: options.socketPath }) : new Docker();
    this.project = options.project;
  }

  async ping(): Promise<void> {
    await this.docker.ping();
  }

  /** Introspect running containers + networks and build a fresh IR. */
  async buildIR(): Promise<IR> {
    let containers = (await this.docker.listContainers({ all: true })) as ContainerInfoLite[];
    if (this.project) {
      containers = containers.filter((c) => c.Labels?.['com.docker.compose.project'] === this.project);
    }

    const networksOf = new Map<string, string[]>();
    for (const c of containers) {
      networksOf.set(c.Id, Object.keys(c.NetworkSettings?.Networks ?? {}));
    }

    // Image sizes (log-scaled → footprint), cached per image id.
    await Promise.all(
      [...new Set(containers.map((c) => c.ImageID))].map(async (imageId) => {
        if (this.imageSizeCache.has(imageId)) return;
        try {
          const info = await this.docker.getImage(imageId).inspect();
          this.imageSizeCache.set(imageId, info.Size ?? 0);
        } catch {
          this.imageSizeCache.set(imageId, 0);
        }
      }),
    );

    const districtIds = new Set<string>();
    const systems: SystemNode[] = [];
    for (const c of containers) {
      const nets = networksOf.get(c.Id) ?? [];
      districtIds.add(primaryNetwork(nets));
    }

    // links = every pair of containers sharing a user-defined network.
    const links: Link[] = [];
    const degree = new Map<string, number>();
    const membersByNetwork = new Map<string, string[]>();
    for (const c of containers) {
      for (const net of networksOf.get(c.Id) ?? []) {
        if (USER_NETWORK_EXCLUDES.has(net)) continue;
        const members = membersByNetwork.get(net) ?? [];
        members.push(c.Id);
        membersByNetwork.set(net, members);
      }
    }
    const seenPairs = new Set<string>();
    for (const [net, members] of [...membersByNetwork.entries()].sort()) {
      const sorted = [...members].sort();
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const pair = `${sorted[i]}|${sorted[j]}`;
          if (seenPairs.has(pair)) continue;
          seenPairs.add(pair);
          links.push({
            id: `link:${net}:${shortId(sorted[i])}->${shortId(sorted[j])}`,
            source: sorted[i],
            target: sorted[j],
            kind: 'network',
          });
          degree.set(sorted[i], (degree.get(sorted[i]) ?? 0) + 1);
          degree.set(sorted[j], (degree.get(sorted[j]) ?? 0) + 1);
        }
      }
    }

    let maxLogSize = 1;
    let maxDegree = 1;
    for (const c of containers) {
      maxLogSize = Math.max(maxLogSize, Math.log10(1 + (this.imageSizeCache.get(c.ImageID) ?? 0) / 1e6));
      maxDegree = Math.max(maxDegree, degree.get(c.Id) ?? 0);
    }

    for (const c of containers) {
      const name = (c.Names[0] ?? shortId(c.Id)).replace(/^\//, '');
      const nets = networksOf.get(c.Id) ?? [];
      systems.push({
        id: c.Id,
        label: name,
        districtId: primaryNetwork(nets),
        kind: classifyImage(c.Image),
        image: c.Image,
        footprint: Math.log10(1 + (this.imageSizeCache.get(c.ImageID) ?? 0) / 1e6) / maxLogSize,
        height: (degree.get(c.Id) ?? 0) / maxDegree,
        status: mapStatus(c.State, c.Status),
      });
    }

    return {
      meta: {
        source: 'docker',
        name: this.project ? `compose: ${this.project}` : 'Docker host',
        generatedAt: new Date().toISOString(),
      },
      districts: [...districtIds].sort().map((id) => ({ id, label: id, kind: 'network' as const })),
      systems,
      links,
      metrics: {},
    };
  }

  /**
   * Live layer: docker events drive status changes (and topology rebuilds),
   * a stats poll turns cpu/mem/net-io into metric patches.
   */
  watch(
    ir: () => IR,
    onPatches: (patches: MetricsPatch[]) => void,
    onTopologyChange: () => void,
    statsIntervalMs = 2000,
  ): DockerWatcher {
    let stopped = false;
    const prevNet = new Map<string, { rx: number; tx: number; at: number }>();

    // --- docker events → status / topology
    let eventStream: NodeJS.ReadableStream | null = null;
    this.docker
      .getEvents({ filters: { type: ['container'] } })
      .then((stream) => {
        if (stopped) return;
        eventStream = stream;
        let buffer = '';
        stream.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          let idx: number;
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            try {
              this.handleEvent(JSON.parse(line), ir(), onPatches, onTopologyChange);
            } catch {
              /* malformed event line — ignore */
            }
          }
        });
        stream.on('error', () => undefined);
      })
      .catch((e) => console.error('[docker] event stream failed:', e.message));

    // --- stats poll → cpu / mem / net
    const pollStats = async () => {
      const model = ir();
      const running = model.systems.filter((s) => s.status === 'running' || s.status === 'unhealthy');
      const patches = (
        await Promise.all(
          running.map(async (s): Promise<MetricsPatch | null> => {
            try {
              const stats = await this.docker.getContainer(s.id).stats({ stream: false });
              return this.statsToPatch(s.id, stats, prevNet);
            } catch {
              return null;
            }
          }),
        )
      ).filter((p): p is MetricsPatch => p !== null);
      if (patches.length > 0 && !stopped) onPatches(patches);
    };
    const timer = setInterval(() => void pollStats(), statsIntervalMs);
    void pollStats();

    return {
      stop() {
        stopped = true;
        clearInterval(timer);
        (eventStream as { destroy?: () => void } | null)?.destroy?.();
      },
    };
  }

  private handleEvent(
    event: { Action?: string; id?: string },
    model: IR,
    onPatches: (patches: MetricsPatch[]) => void,
    onTopologyChange: () => void,
  ): void {
    const action = event.Action ?? '';
    const id = event.id ?? '';
    if (action === 'create' || action === 'destroy' || action === 'rename') {
      onTopologyChange();
      return;
    }
    let status: SystemStatus | null = null;
    if (action === 'start' || action === 'unpause' || action === 'health_status: healthy') status = 'running';
    else if (action === 'restart') status = 'starting';
    else if (action === 'die' || action === 'stop' || action === 'kill' || action === 'pause') status = 'exited';
    else if (action === 'health_status: unhealthy') status = 'unhealthy';
    if (!status) return;

    const system = model.systems.find((s) => s.id === id);
    if (!system || system.status === status) return;
    system.status = status;
    model.metrics[id] = { ...model.metrics[id], status };
    onPatches([{ id, status }]);
  }

  private statsToPatch(
    id: string,
    stats: Docker.ContainerStats,
    prevNet: Map<string, { rx: number; tx: number; at: number }>,
  ): MetricsPatch {
    // CPU % — standard docker formula.
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats.cpu_usage?.total_usage ?? 0);
    const sysDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage ?? 0);
    const cores = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;
    const cpu = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cores * 100 : 0;

    const memUsage = stats.memory_stats.usage ?? 0;
    const memLimit = stats.memory_stats.limit ?? 0;
    const memPct = memLimit > 0 ? (memUsage / memLimit) * 100 : 0;

    let rx = 0;
    let tx = 0;
    for (const nic of Object.values(stats.networks ?? {})) {
      rx += nic.rx_bytes ?? 0;
      tx += nic.tx_bytes ?? 0;
    }
    const now = Date.now();
    const prev = prevNet.get(id);
    prevNet.set(id, { rx, tx, at: now });
    const dt = prev ? (now - prev.at) / 1000 : 0;
    const netInBps = prev && dt > 0 ? Math.max(0, (rx - prev.rx) / dt) : 0;
    const netOutBps = prev && dt > 0 ? Math.max(0, (tx - prev.tx) / dt) : 0;

    return {
      id,
      cpu: Math.round(cpu * 10) / 10,
      memPct: Math.round(memPct * 10) / 10,
      netInBps: Math.round(netInBps),
      netOutBps: Math.round(netOutBps),
    };
  }
}
