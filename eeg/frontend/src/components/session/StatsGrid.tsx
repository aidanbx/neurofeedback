interface StatItem {
  label: string;
  value: string;
  color?: string;
}

export function StatsGrid({ stats }: { stats: StatItem[] }) {
  return (
    <div className="stat-grid">
      {stats.map((s) => (
        <div key={s.label} className="stat-card">
          <div className="stat-card-label">{s.label}</div>
          <div className="stat-card-value" style={{ color: s.color ?? 'var(--text)' }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}
