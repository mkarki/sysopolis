import { useEffect, useState } from 'react';
import { KIND_COLORS } from '@sysopolis/core';
import { useStore } from '../store';

function formatBps(bps?: number): string {
  if (bps === undefined) return '—';
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)} GB/s`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} MB/s`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} kB/s`;
  return `${Math.round(bps)} B/s`;
}

function MetricBar({ label, value }: { label: string; value?: number }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <div className="metric-track">
        <div
          className="metric-fill"
          style={{ width: `${pct}%`, background: pct > 85 ? '#f87171' : pct > 60 ? '#fbbf24' : '#34d399' }}
        />
      </div>
      <span className="metric-value">{value === undefined ? '—' : `${Math.round(pct)}%`}</span>
    </div>
  );
}

/** Click a building → live details panel. */
export function Inspector() {
  const ir = useStore((s) => s.ir);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  useStore((s) => s.statusVersion);

  // Metrics are mutated in place (no store events) → refresh the numbers on a timer.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, []);

  if (!ir || !selectedId) return null;
  const system = ir.systems.find((s) => s.id === selectedId);
  if (!system) return null;

  const metrics = ir.metrics[system.id] ?? {};
  const district = ir.districts.find((d) => d.id === system.districtId);
  const neighbors = ir.links
    .filter((l) => l.source === system.id || l.target === system.id)
    .map((l) => {
      const otherId = l.source === system.id ? l.target : l.source;
      return ir.systems.find((s) => s.id === otherId);
    })
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
    .filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i)
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <aside className="inspector">
      <button className="inspector-close" onClick={() => select(null)} aria-label="Close">
        ×
      </button>
      <h2>{system.label}</h2>
      <div className="inspector-tags">
        <span className="tag" style={{ borderColor: KIND_COLORS[system.kind], color: KIND_COLORS[system.kind] }}>
          {system.kind}
        </span>
        <span className={`tag tag-status-${system.status}`}>{system.status}</span>
      </div>
      <dl className="inspector-facts">
        <dt>district</dt>
        <dd>{district?.label ?? system.districtId}</dd>
        {system.image && (
          <>
            <dt>image</dt>
            <dd className="mono">{system.image}</dd>
          </>
        )}
        <dt>net in / out</dt>
        <dd className="mono">
          {formatBps(metrics.netInBps)} / {formatBps(metrics.netOutBps)}
        </dd>
      </dl>
      <MetricBar label="cpu" value={metrics.cpu} />
      <MetricBar label="mem" value={metrics.memPct} />
      {neighbors.length > 0 && (
        <div className="inspector-links">
          <h3>connected to</h3>
          <ul>
            {neighbors.map((n) => (
              <li key={n.id}>
                <button className={`link-chip status-${n.status}`} onClick={() => select(n.id)}>
                  <i style={{ background: KIND_COLORS[n.kind] }} />
                  {n.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
