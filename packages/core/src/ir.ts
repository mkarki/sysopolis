/**
 * Sysopolis Intermediate Representation (IR).
 *
 * This is the locked contract at the heart of the project:
 * adapters (docker, synthetic, later nmap/k8s/terraform) WRITE it,
 * the renderer READS it, the live layer PATCHES it.
 */

export type IRSource = 'docker' | 'synthetic';

export type SystemStatus = 'running' | 'starting' | 'unhealthy' | 'exited' | 'unknown';

export type SystemKind =
  | 'database'
  | 'cache'
  | 'queue'
  | 'proxy'
  | 'web'
  | 'worker'
  | 'unknown';

export interface IRMeta {
  source: IRSource;
  name: string;
  generatedAt: string;
}

export interface District {
  id: string;
  label: string;
  kind: 'network';
  color?: string;
}

export interface SystemNode {
  /** Stable key (container id in docker mode). */
  id: string;
  /** Display name. */
  label: string;
  /** Primary district (its main network). */
  districtId: string;
  kind: SystemKind;
  image?: string;
  /** 0..1 → building base size. */
  footprint: number;
  /** 0..1 → building height. */
  height: number;
  status: SystemStatus;
}

export interface Link {
  id: string;
  source: string;
  target: string;
  kind: 'network' | 'depends_on';
  /** 0..1 flow intensity; exact in synthetic mode, approximated in docker mode. */
  weight?: number;
}

export interface SystemMetrics {
  status?: SystemStatus;
  cpu?: number;
  memPct?: number;
  netInBps?: number;
  netOutBps?: number;
}

export interface IR {
  meta: IRMeta;
  districts: District[];
  systems: SystemNode[];
  links: Link[];
  /** Keyed by systemId, hot-patched over WebSocket. */
  metrics: Record<string, SystemMetrics>;
}

/** One WebSocket delta: patches metrics[id] and/or a system's status. */
export interface MetricsPatch extends SystemMetrics {
  id: string;
}

/** Live protocol messages sent by the collector after the initial GET /ir. */
export type LiveMessage =
  | { type: 'patch'; patches: MetricsPatch[] }
  | { type: 'ir'; ir: IR };

export const SYSTEM_STATUSES: readonly SystemStatus[] = [
  'running',
  'starting',
  'unhealthy',
  'exited',
  'unknown',
];

export const SYSTEM_KINDS: readonly SystemKind[] = [
  'database',
  'cache',
  'queue',
  'proxy',
  'web',
  'worker',
  'unknown',
];
