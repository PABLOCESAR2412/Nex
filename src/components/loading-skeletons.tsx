export function SkeletonRows({
  count = 3,
  label,
  variant = "default",
}: {
  count?: number;
  label: string;
  variant?: "default" | "compact";
}) {
  return <div className={`loading-skeleton-list${variant === "compact" ? " loading-skeleton-list-compact" : ""}`} role="status" aria-label={label} aria-busy="true">
    {Array.from({ length: count }, (_, index) => <div className="loading-skeleton-row" aria-hidden="true" key={index}>
      <span className="skeleton-pulse loading-skeleton-icon" />
      <span className="loading-skeleton-copy"><span className="skeleton-pulse loading-skeleton-primary" /><span className="skeleton-pulse loading-skeleton-secondary" /></span>
      <span className="skeleton-pulse loading-skeleton-tail" />
    </div>)}
  </div>;
}

export function SessionShellSkeleton() {
  return <div className="app-shell session-shell-skeleton" role="status" aria-label="Cargando tu estudio" aria-busy="true">
    <span className="sr-only">Comprobando tu sesión…</span>
    <aside className="sidebar" aria-hidden="true">
      <div className="session-skeleton-brand"><span className="skeleton-pulse session-skeleton-mark" /><span className="skeleton-pulse session-skeleton-brand-name" /></div>
      <div className="session-skeleton-nav">
        <span className="skeleton-pulse session-skeleton-nav-label" />
        {Array.from({ length: 6 }, (_, index) => <div className="session-skeleton-nav-item" key={index}><span className="skeleton-pulse session-skeleton-nav-icon" /><span className="skeleton-pulse session-skeleton-nav-text" /></div>)}
      </div>
      <div className="session-skeleton-user"><span className="skeleton-pulse session-skeleton-avatar" /><span className="session-skeleton-user-copy"><span className="skeleton-pulse session-skeleton-user-name" /><span className="skeleton-pulse session-skeleton-user-email" /></span></div>
    </aside>
    <main className="main-panel" aria-hidden="true">
      <header className="topbar"><span className="skeleton-pulse session-skeleton-breadcrumb" /><div className="session-skeleton-actions"><span className="skeleton-pulse session-skeleton-search" /><span className="skeleton-pulse session-skeleton-button" /><span className="skeleton-pulse session-skeleton-button" /></div></header>
      <div className="content-wrap session-skeleton-content">
        <div className="session-skeleton-intro"><span className="skeleton-pulse session-skeleton-title" /><span className="skeleton-pulse session-skeleton-subtitle" /></div>
        <div className="session-skeleton-metrics">{[0, 1, 2].map((index) => <div key={index}><span className="skeleton-pulse session-skeleton-metric-label" /><span className="skeleton-pulse session-skeleton-metric-value" /></div>)}</div>
        <div className="session-skeleton-panels"><section><span className="skeleton-pulse session-skeleton-panel-heading" /><span className="skeleton-pulse session-skeleton-panel-body" /></section><section><span className="skeleton-pulse session-skeleton-panel-heading" /><span className="skeleton-pulse session-skeleton-panel-line" /><span className="skeleton-pulse session-skeleton-panel-line short" /><span className="skeleton-pulse session-skeleton-panel-line" /></section></div>
      </div>
    </main>
  </div>;
}
