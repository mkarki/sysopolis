import { DISTRICT_COLORS } from './classify.js';
import type { IR } from './ir.js';

/**
 * Deterministic city layout (mapping rule from the build plan):
 * - districts are blocks placed on a spiral from the center
 * - buildings fill each block row-major, sorted by id
 * - a network with many members collapses to a district ring road instead of a full mesh
 * - cross-district links become inter-district roads
 * Same IR in → same city out, every run.
 */

export const CELL = 2.4;
export const BLOCK_PADDING = 1.6;
export const BLOCK_GAP = 3.2;
/** Districts with more members than this trade their intra mesh for a ring road. */
export const RING_THRESHOLD = 6;

export interface Vec2 {
  x: number;
  z: number;
}

export interface DistrictBlock {
  id: string;
  label: string;
  color: string;
  /** Center of the block. */
  center: Vec2;
  /** Full block size (world units). */
  w: number;
  d: number;
  memberCount: number;
  hasRing: boolean;
}

export interface Road {
  id: string;
  kind: 'intra' | 'inter' | 'ring';
  from: Vec2;
  to: Vec2;
  /** Static 0..1 intensity baseline (from link weights). */
  baseWeight: number;
  /** System ids feeding this road (for live intensity). */
  source?: string;
  target?: string;
  /** For ring segments: the district they belong to. */
  districtId?: string;
}

export interface CityLayout {
  positions: Record<string, Vec2>;
  districts: DistrictBlock[];
  roads: Road[];
  /** Outgoing link count per system — used to split netOutBps across roads. */
  outDegree: Record<string, number>;
  /** World-space bounding radius, for camera fitting. */
  radius: number;
}

/** Square-spiral walk: (0,0), (1,0), (1,1), (0,1), (-1,1), (-1,0), ... deterministic. */
function spiralCell(n: number): Vec2 {
  if (n === 0) return { x: 0, z: 0 };
  let x = 0;
  let z = 0;
  let dx = 1;
  let dz = 0;
  let stepLen = 1;
  let stepsDone = 0;
  let turns = 0;
  for (let i = 0; i < n; i++) {
    x += dx;
    z += dz;
    stepsDone++;
    if (stepsDone === stepLen) {
      stepsDone = 0;
      // rotate left: (dx,dz) -> (-dz,dx)
      const t = dx;
      dx = -dz;
      dz = t;
      turns++;
      if (turns % 2 === 0) stepLen++;
    }
  }
  return { x, z };
}

export function computeLayout(ir: IR): CityLayout {
  const positions: Record<string, Vec2> = {};
  const outDegree: Record<string, number> = {};
  const roads: Road[] = [];

  const membersByDistrict = new Map<string, string[]>();
  for (const d of ir.districts) membersByDistrict.set(d.id, []);
  const sortedSystems = [...ir.systems].sort((a, b) => a.id.localeCompare(b.id));
  for (const s of sortedSystems) {
    const members = membersByDistrict.get(s.districtId);
    if (members) members.push(s.id);
  }

  // Biggest districts first (center of the spiral), ties broken by id → deterministic.
  const orderedDistricts = [...ir.districts].sort((a, b) => {
    const diff = (membersByDistrict.get(b.id)?.length ?? 0) - (membersByDistrict.get(a.id)?.length ?? 0);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  // Uniform spiral slot size so blocks can never overlap.
  let maxSide = CELL + BLOCK_PADDING * 2;
  for (const d of orderedDistricts) {
    const n = Math.max(1, membersByDistrict.get(d.id)?.length ?? 0);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    maxSide = Math.max(maxSide, Math.max(cols, rows) * CELL + BLOCK_PADDING * 2);
  }
  const slot = maxSide + BLOCK_GAP;

  const districts: DistrictBlock[] = [];
  orderedDistricts.forEach((d, i) => {
    const members = membersByDistrict.get(d.id) ?? [];
    const n = Math.max(1, members.length);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const w = cols * CELL + BLOCK_PADDING * 2;
    const depth = rows * CELL + BLOCK_PADDING * 2;
    const cellPos = spiralCell(i);
    const center: Vec2 = { x: cellPos.x * slot, z: cellPos.z * slot };

    members.forEach((id, j) => {
      const col = j % cols;
      const row = Math.floor(j / cols);
      positions[id] = {
        x: center.x - w / 2 + BLOCK_PADDING + (col + 0.5) * CELL,
        z: center.z - depth / 2 + BLOCK_PADDING + (row + 0.5) * CELL,
      };
    });

    districts.push({
      id: d.id,
      label: d.label,
      color: d.color ?? DISTRICT_COLORS[i % DISTRICT_COLORS.length],
      center,
      w,
      d: depth,
      memberCount: members.length,
      hasRing: members.length > RING_THRESHOLD,
    });
  });

  const districtById = new Map(districts.map((d) => [d.id, d]));
  const systemById = new Map(ir.systems.map((s) => [s.id, s]));

  // Roads from links. Intra-district links inside a "ring" district are collapsed:
  // their weight feeds the ring instead of adding an O(n²) hairball.
  const ringLoad = new Map<string, { total: number; count: number }>();
  const sortedLinks = [...ir.links].sort((a, b) => a.id.localeCompare(b.id));
  for (const link of sortedLinks) {
    const s = systemById.get(link.source);
    const t = systemById.get(link.target);
    if (!s || !t) continue;
    outDegree[s.id] = (outDegree[s.id] ?? 0) + 1;
    const from = positions[s.id];
    const to = positions[t.id];
    if (!from || !to) continue;

    const sameDistrict = s.districtId === t.districtId;
    const district = districtById.get(s.districtId);
    if (sameDistrict && district?.hasRing) {
      const load = ringLoad.get(district.id) ?? { total: 0, count: 0 };
      load.total += link.weight ?? 0.3;
      load.count++;
      ringLoad.set(district.id, load);
      continue;
    }

    roads.push({
      id: `road:${link.id}`,
      kind: sameDistrict ? 'intra' : 'inter',
      from,
      to,
      baseWeight: link.weight ?? 0.3,
      source: s.id,
      target: t.id,
    });
  }

  // Ring roads: 4 segments running just inside the block edge.
  for (const d of districts) {
    if (!d.hasRing) continue;
    const load = ringLoad.get(d.id);
    const weight = load && load.count > 0 ? Math.min(1, load.total / load.count) : 0.25;
    const inset = BLOCK_PADDING * 0.45;
    const x0 = d.center.x - d.w / 2 + inset;
    const x1 = d.center.x + d.w / 2 - inset;
    const z0 = d.center.z - d.d / 2 + inset;
    const z1 = d.center.z + d.d / 2 - inset;
    const corners: Vec2[] = [
      { x: x0, z: z0 },
      { x: x1, z: z0 },
      { x: x1, z: z1 },
      { x: x0, z: z1 },
    ];
    corners.forEach((from, i) => {
      roads.push({
        id: `ring:${d.id}:${i}`,
        kind: 'ring',
        from,
        to: corners[(i + 1) % 4],
        baseWeight: weight,
        districtId: d.id,
      });
    });
  }

  let radius = 10;
  for (const d of districts) {
    radius = Math.max(
      radius,
      Math.hypot(d.center.x, d.center.z) + Math.max(d.w, d.d) / 2 + BLOCK_GAP,
    );
  }

  return { positions, districts, roads, outDegree, radius };
}
