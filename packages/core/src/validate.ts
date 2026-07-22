import { SYSTEM_KINDS, SYSTEM_STATUSES, type IR } from './ir.js';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isUnitInterval(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

/**
 * Structural + referential validation of an IR document.
 * No dependencies on purpose: the IR is the contract, the validator is its spec.
 */
export function validateIR(input: unknown): ValidationResult {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(msg);

  if (!isRecord(input)) {
    return { ok: false, errors: ['IR must be an object'] };
  }
  const ir = input as Partial<IR> & Record<string, unknown>;

  // meta
  if (!isRecord(ir.meta)) err('meta: missing or not an object');
  else {
    if (ir.meta.source !== 'docker' && ir.meta.source !== 'synthetic')
      err(`meta.source: expected "docker" | "synthetic", got ${JSON.stringify(ir.meta.source)}`);
    if (typeof ir.meta.name !== 'string' || !ir.meta.name) err('meta.name: expected non-empty string');
    if (typeof ir.meta.generatedAt !== 'string' || Number.isNaN(Date.parse(ir.meta.generatedAt)))
      err('meta.generatedAt: expected ISO date string');
  }

  // districts
  const districtIds = new Set<string>();
  if (!Array.isArray(ir.districts)) err('districts: missing or not an array');
  else {
    ir.districts.forEach((d, i) => {
      if (!isRecord(d)) return err(`districts[${i}]: not an object`);
      if (typeof d.id !== 'string' || !d.id) err(`districts[${i}].id: expected non-empty string`);
      else if (districtIds.has(d.id)) err(`districts[${i}].id: duplicate id "${d.id}"`);
      else districtIds.add(d.id);
      if (typeof d.label !== 'string' || !d.label) err(`districts[${i}].label: expected non-empty string`);
      if (d.kind !== 'network') err(`districts[${i}].kind: expected "network"`);
    });
  }

  // systems
  const systemIds = new Set<string>();
  if (!Array.isArray(ir.systems)) err('systems: missing or not an array');
  else {
    ir.systems.forEach((s, i) => {
      if (!isRecord(s)) return err(`systems[${i}]: not an object`);
      if (typeof s.id !== 'string' || !s.id) err(`systems[${i}].id: expected non-empty string`);
      else if (systemIds.has(s.id)) err(`systems[${i}].id: duplicate id "${s.id}"`);
      else systemIds.add(s.id);
      if (typeof s.label !== 'string' || !s.label) err(`systems[${i}].label: expected non-empty string`);
      if (typeof s.districtId !== 'string' || !districtIds.has(s.districtId as string))
        err(`systems[${i}].districtId: "${String(s.districtId)}" is not a declared district`);
      if (!SYSTEM_KINDS.includes(s.kind as never)) err(`systems[${i}].kind: invalid "${String(s.kind)}"`);
      if (!isUnitInterval(s.footprint)) err(`systems[${i}].footprint: expected number in 0..1`);
      if (!isUnitInterval(s.height)) err(`systems[${i}].height: expected number in 0..1`);
      if (!SYSTEM_STATUSES.includes(s.status as never)) err(`systems[${i}].status: invalid "${String(s.status)}"`);
    });
  }

  // links
  const linkIds = new Set<string>();
  if (!Array.isArray(ir.links)) err('links: missing or not an array');
  else {
    ir.links.forEach((l, i) => {
      if (!isRecord(l)) return err(`links[${i}]: not an object`);
      if (typeof l.id !== 'string' || !l.id) err(`links[${i}].id: expected non-empty string`);
      else if (linkIds.has(l.id)) err(`links[${i}].id: duplicate id "${l.id}"`);
      else linkIds.add(l.id);
      for (const end of ['source', 'target'] as const) {
        if (typeof l[end] !== 'string' || !systemIds.has(l[end] as string))
          err(`links[${i}].${end}: "${String(l[end])}" is not a declared system`);
      }
      if (l.source === l.target) err(`links[${i}]: self-link on "${String(l.source)}"`);
      if (l.kind !== 'network' && l.kind !== 'depends_on')
        err(`links[${i}].kind: expected "network" | "depends_on"`);
      if (l.weight !== undefined && !isUnitInterval(l.weight))
        err(`links[${i}].weight: expected number in 0..1`);
    });
  }

  // metrics
  if (ir.metrics !== undefined && !isRecord(ir.metrics)) err('metrics: expected an object');
  else if (isRecord(ir.metrics)) {
    for (const id of Object.keys(ir.metrics)) {
      if (!systemIds.has(id)) err(`metrics["${id}"]: not a declared system`);
    }
  }

  return { ok: errors.length === 0, errors };
}
