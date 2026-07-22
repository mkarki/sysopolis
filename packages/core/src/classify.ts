import type { SystemKind } from './ir.js';

const RULES: Array<[RegExp, SystemKind]> = [
  [/postgres|mysql|mariadb|mongo|oracle|mssql|cockroach|clickhouse|cassandra|elasticsearch|opensearch/i, 'database'],
  [/redis|memcached|varnish|hazelcast/i, 'cache'],
  [/rabbitmq|kafka|nats|activemq|pulsar|mosquitto|celery/i, 'queue'],
  [/nginx|traefik|haproxy|envoy|caddy|kong|apisix/i, 'proxy'],
  [/worker|cron|job|consumer|batch|etl|spark|flink/i, 'worker'],
];

/**
 * kind = substring match on the image name (mapping rule from the build plan).
 * Falls back to 'web' when an image exists, 'unknown' otherwise.
 */
export function classifyImage(image?: string): SystemKind {
  if (!image) return 'unknown';
  for (const [re, kind] of RULES) {
    if (re.test(image)) return kind;
  }
  return 'web';
}

/** Fixed categorical palette — drives building colors. */
export const KIND_COLORS: Record<SystemKind, string> = {
  database: '#38bdf8',
  cache: '#f472b6',
  queue: '#fbbf24',
  proxy: '#a78bfa',
  web: '#34d399',
  worker: '#fb923c',
  unknown: '#94a3b8',
};

/** Muted palette for district ground blocks. */
export const DISTRICT_COLORS = [
  '#1c2a3a',
  '#22303c',
  '#2a2438',
  '#1f3230',
  '#33272b',
  '#252d40',
  '#2e3226',
  '#31283c',
  '#203636',
  '#362e24',
];
