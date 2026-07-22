import { KIND_COLORS, SYSTEM_KINDS } from '@sysopolis/core';

export function Legend() {
  return (
    <aside className="legend">
      {SYSTEM_KINDS.filter((k) => k !== 'unknown').map((kind) => (
        <span key={kind} className="legend-item">
          <i style={{ background: KIND_COLORS[kind] }} />
          {kind}
        </span>
      ))}
    </aside>
  );
}
