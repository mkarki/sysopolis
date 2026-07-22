import { classifyImage } from './classify.js';
import type { IR, Link, SystemNode, SystemStatus } from './ir.js';

/** Deterministic PRNG (mulberry32) — same seed, same city. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Blueprint {
  id: string;
  label: string;
  /** [name, image][] — image drives kind + color via the shared classify rules. */
  systems: Array<[string, string]>;
  /** Names of this district's hubs (receive/emit most cross-district traffic). */
  hubs: string[];
}

/** A credible fake enterprise: heterogeneous, hub-y, a bit messy — like real life. */
const BLUEPRINTS: Blueprint[] = [
  {
    id: 'net-edge',
    label: 'Edge',
    systems: [
      ['edge-lb', 'haproxy:2.9'],
      ['edge-nginx-1', 'nginx:1.25-alpine'],
      ['edge-nginx-2', 'nginx:1.25-alpine'],
      ['waf', 'owasp/modsecurity:nginx'],
      ['cdn-cache', 'varnish:7.4'],
    ],
    hubs: ['edge-lb'],
  },
  {
    id: 'net-frontend',
    label: 'Frontend',
    systems: [
      ['web-storefront', 'acme/storefront:3.12.0'],
      ['web-backoffice', 'acme/backoffice:2.4.1'],
      ['web-mobile-bff', 'acme/mobile-bff:1.19.2'],
      ['redis-sessions', 'redis:7-alpine'],
      ['web-search', 'acme/search-api:0.9.4'],
      ['elasticsearch', 'elasticsearch:8.13.0'],
      ['web-help-center', 'acme/help-center:1.2.0'],
    ],
    hubs: ['web-storefront', 'web-mobile-bff'],
  },
  {
    id: 'net-payments',
    label: 'Payments',
    systems: [
      ['svc-payments', 'acme/payments:5.2.0'],
      ['svc-checkout', 'acme/checkout:4.0.3'],
      ['pg-payments', 'postgres:16-alpine'],
      ['redis-payments', 'redis:7-alpine'],
      ['worker-settlement', 'acme/settlement-worker:1.7.0'],
      ['svc-fraud', 'acme/fraud-scoring:2.1.0'],
      ['vault-tokens', 'hashicorp/vault:1.15'],
    ],
    hubs: ['svc-payments'],
  },
  {
    id: 'net-core-banking',
    label: 'Core banking',
    systems: [
      ['core-ledger', 'acme/ledger:12.0.1'],
      ['pg-ledger', 'postgres:15'],
      ['pg-ledger-replica', 'postgres:15'],
      ['mainframe-bridge', 'acme/cobol-bridge:0.4.2'],
      ['batch-eod', 'acme/eod-batch-worker:3.3.0'],
    ],
    hubs: ['core-ledger'],
  },
  {
    id: 'net-messaging',
    label: 'Messaging',
    systems: [
      ['kafka-1', 'confluentinc/cp-kafka:7.6.0'],
      ['kafka-2', 'confluentinc/cp-kafka:7.6.0'],
      ['kafka-3', 'confluentinc/cp-kafka:7.6.0'],
      ['zookeeper', 'confluentinc/cp-zookeeper:7.6.0'],
      ['rabbitmq-tasks', 'rabbitmq:3.13-management'],
      ['nats-events', 'nats:2.10'],
      ['worker-email', 'acme/email-worker:2.0.5'],
      ['worker-webhooks', 'acme/webhook-worker:1.4.0'],
    ],
    hubs: ['kafka-1', 'rabbitmq-tasks'],
  },
  {
    id: 'net-data',
    label: 'Data platform',
    systems: [
      ['warehouse', 'clickhouse/clickhouse-server:24.3'],
      ['etl-ingest', 'acme/etl-ingest:0.12.0'],
      ['etl-transform', 'acme/etl-transform:0.12.0'],
      ['spark-master', 'bitnami/spark:3.5'],
      ['spark-worker-1', 'bitnami/spark:3.5'],
      ['spark-worker-2', 'bitnami/spark:3.5'],
      ['mongo-features', 'mongo:7'],
      ['dashboard-bi', 'metabase/metabase:v0.49'],
    ],
    hubs: ['warehouse', 'etl-ingest'],
  },
  {
    id: 'net-identity',
    label: 'Identity',
    systems: [
      ['idp-keycloak', 'keycloak/keycloak:24.0'],
      ['pg-identity', 'postgres:16-alpine'],
      ['ldap-bridge', 'osixia/openldap:1.5.0'],
      ['svc-permissions', 'acme/permissions:1.1.8'],
    ],
    hubs: ['idp-keycloak'],
  },
  {
    id: 'net-observability',
    label: 'Observability',
    systems: [
      ['prometheus', 'prom/prometheus:v2.51'],
      ['grafana', 'grafana/grafana:10.4'],
      ['loki', 'grafana/loki:2.9'],
      ['alertmanager', 'prom/alertmanager:v0.27'],
      ['jaeger', 'jaegertracing/all-in-one:1.56'],
    ],
    hubs: ['prometheus'],
  },
  {
    id: 'net-legacy',
    label: 'Legacy',
    systems: [
      ['soap-gateway', 'acme/soap-gateway:0.2.9'],
      ['ftp-partner-sync', 'acme/ftp-sync-cron:0.1.4'],
      ['mysql-crm-2014', 'mysql:5.7'],
      ['tomcat-intranet', 'tomcat:9-jdk8'],
    ],
    hubs: ['soap-gateway'],
  },
];

/** Cross-district dependencies: [source hub district, target hub district, weight hint]. */
const BACKBONE: Array<[string, string, number]> = [
  ['net-edge', 'net-frontend', 0.95],
  ['net-edge', 'net-identity', 0.4],
  ['net-frontend', 'net-payments', 0.8],
  ['net-frontend', 'net-identity', 0.55],
  ['net-frontend', 'net-messaging', 0.45],
  ['net-payments', 'net-core-banking', 0.7],
  ['net-payments', 'net-messaging', 0.5],
  ['net-core-banking', 'net-legacy', 0.3],
  ['net-messaging', 'net-data', 0.65],
  ['net-data', 'net-legacy', 0.15],
  ['net-observability', 'net-frontend', 0.2],
  ['net-observability', 'net-payments', 0.2],
  ['net-observability', 'net-messaging', 0.2],
];

/**
 * Generate a large, credible fake enterprise honoring the mapping rules:
 * kind from image name, footprint log-scaled from a fake image size,
 * height from node degree, statuses mostly healthy with a few casualties.
 */
export function generateSyntheticIR(seed = 42, name = 'Acme Group — production'): IR {
  const rand = mulberry32(seed);
  const systems: SystemNode[] = [];
  const links: Link[] = [];
  const degree = new Map<string, number>();

  const addLink = (source: string, target: string, weight: number, kind: Link['kind'] = 'network') => {
    if (source === target) return;
    const id = `link:${source}->${target}`;
    if (links.some((l) => l.id === id)) return;
    links.push({ id, source, target, kind, weight: Math.min(1, Math.max(0.02, weight)) });
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  };

  // Fake image size in MB → footprint via log scale, like the docker adapter does with real sizes.
  const imageSizes = new Map<string, number>();
  const imageSizeMB = (image: string) => {
    let size = imageSizes.get(image);
    if (size === undefined) {
      size = 30 + rand() * 1400;
      imageSizes.set(image, size);
    }
    return size;
  };

  for (const bp of BLUEPRINTS) {
    for (const [nm, image] of bp.systems) {
      systems.push({
        id: `sys-${nm}`,
        label: nm,
        districtId: bp.id,
        kind: classifyImage(image),
        image,
        footprint: 0, // normalized below
        height: 0, // normalized below
        status: 'running',
      });
    }
    // Intra-district wiring: every member talks to its district hub(s).
    for (const hub of bp.hubs) {
      for (const [nm] of bp.systems) {
        if (nm === hub) continue;
        addLink(`sys-${nm}`, `sys-${hub}`, 0.15 + rand() * 0.5);
      }
    }
    // A few extra local edges for texture (db/cache direct consumers).
    const members = bp.systems.map(([nm]) => nm);
    const extras = Math.floor(members.length / 3);
    for (let i = 0; i < extras; i++) {
      const a = members[Math.floor(rand() * members.length)];
      const b = members[Math.floor(rand() * members.length)];
      addLink(`sys-${a}`, `sys-${b}`, 0.1 + rand() * 0.35);
    }
  }

  // Backbone: hub-to-hub inter-district roads.
  const hubOf = new Map(BLUEPRINTS.map((bp) => [bp.id, bp.hubs[0]]));
  for (const [fromDistrict, toDistrict, w] of BACKBONE) {
    const a = hubOf.get(fromDistrict);
    const b = hubOf.get(toDistrict);
    if (a && b) addLink(`sys-${a}`, `sys-${b}`, w * (0.8 + rand() * 0.4), 'depends_on');
  }

  // Normalize footprint (log-scaled image size) and height (node degree) per-city.
  let maxLogSize = 0;
  let maxDegree = 1;
  for (const s of systems) {
    maxLogSize = Math.max(maxLogSize, Math.log10(1 + imageSizeMB(s.image!)));
    maxDegree = Math.max(maxDegree, degree.get(s.id) ?? 0);
  }
  for (const s of systems) {
    s.footprint = Math.log10(1 + imageSizeMB(s.image!)) / maxLogSize;
    s.height = (degree.get(s.id) ?? 0) / maxDegree;
  }

  // A few casualties so a fresh city already tells a story.
  const casualties: Array<[string, SystemStatus]> = [
    ['sys-ftp-partner-sync', 'exited'],
    ['sys-spark-worker-2', 'unhealthy'],
    ['sys-tomcat-intranet', 'unhealthy'],
  ];
  for (const [id, status] of casualties) {
    const s = systems.find((x) => x.id === id);
    if (s) s.status = status;
  }

  return {
    meta: { source: 'synthetic', name, generatedAt: new Date().toISOString() },
    districts: BLUEPRINTS.map((bp) => ({ id: bp.id, label: bp.label, kind: 'network' as const })),
    systems,
    links,
    metrics: {},
  };
}
