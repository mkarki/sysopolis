import { useStore } from '../store';

export function Hud() {
  const ir = useStore((s) => s.ir);
  const connection = useStore((s) => s.connection);
  useStore((s) => s.statusVersion); // re-render on status changes

  if (!ir) return null;

  const counts = { running: 0, starting: 0, unhealthy: 0, exited: 0, unknown: 0 };
  for (const s of ir.systems) counts[s.status]++;

  return (
    <header className="hud">
      <div className="hud-title">
        <span className="hud-logo">SYSOPOLIS</span>
        <span className="hud-city">{ir.meta.name}</span>
        <span className={`hud-badge hud-badge-${ir.meta.source}`}>{ir.meta.source}</span>
        <span className={`hud-conn hud-conn-${connection}`} title={`stream: ${connection}`} />
      </div>
      <div className="hud-stats">
        <span className="stat stat-running">{counts.running} running</span>
        {counts.starting > 0 && <span className="stat stat-starting">{counts.starting} starting</span>}
        {counts.unhealthy > 0 && <span className="stat stat-unhealthy">{counts.unhealthy} unhealthy</span>}
        {counts.exited > 0 && <span className="stat stat-exited">{counts.exited} down</span>}
      </div>
    </header>
  );
}
