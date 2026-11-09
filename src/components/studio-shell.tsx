import { Fragment, type ReactNode } from "react";

type ViewKey = "inicio" | "calendario" | "biblioteca" | "cuentas" | "despliegues" | "ajustes";

const navigation: Array<{ key: ViewKey; label: string; href: string; icon: ReactNode }> = [
  { key: "inicio", label: "Inicio", href: "/", icon: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /> },
  { key: "calendario", label: "Calendario", href: "/calendario", icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></> },
  { key: "biblioteca", label: "Biblioteca", href: "/biblioteca", icon: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5z" /><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20M8 7h8M8 10h6" /></> },
  { key: "cuentas", label: "Cuentas", href: "/cuentas", icon: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M8 20v-2a4 4 0 0 1 8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /></> },
  { key: "despliegues", label: "Despliegues", href: "/despliegues", icon: <><path d="M12 20s7-4 7-11V5l-7-3-7 3v4c0 7 7 11 7 11Z" /><path d="m9 12 2 2 4-5" /></> },
  { key: "ajustes", label: "Ajustes", href: "/ajustes", icon: <><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.8-.6a8 8 0 0 1-1.5.9l-.4 1.9h-2.8l-.4-1.9a8 8 0 0 1-1.5-.9l-1.8.6-1.4-2.4 1.4-1.1a7.4 7.4 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.8.6a8 8 0 0 1 1.5-.9l.4-1.9h2.8l.4 1.9a8 8 0 0 1 1.5.9l1.8-.6 1.4 2.4-1.4 1.1a7.4 7.4 0 0 1 0 1.7Z" transform="translate(-2 -2)" /></> },
];

export function StudioShell({ active, children }: { active: ViewKey; children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Navegación principal">
        <a className="brand" href="/" aria-label="Nex, inicio">
          <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><path d="M9 30 30 9M11 10l19 20M8 20h24" /><circle cx="9" cy="30" r="2.2" /><circle cx="30" cy="9" r="2.2" /><circle cx="30" cy="30" r="2.2" /></svg>
          <span>Nex</span>
        </a>

        <div className="workspace-switcher">
          <span className="workspace-monogram">P</span>
          <span className="workspace-copy"><strong>Mi estudio</strong><small>Espacio personal</small></span>
          <svg className="icon chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
        </div>

        <nav className="primary-nav">
          <p className="nav-label">Espacio</p>
          {navigation.map((item, index) => <Fragment key={item.key}>
            {index === 5 && <p className="nav-label nav-label-spaced">Preferencias</p>}
            <a key={item.key} className={`nav-link${active === item.key ? " active" : ""}`} href={item.href} aria-label={item.label} title={item.label} aria-current={active === item.key ? "page" : undefined}>
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{item.icon}</svg>
              <span>{item.label}</span>
            </a>
          </Fragment>)}
        </nav>

        <div className="sidebar-bottom">
          <div className="cloud-status"><span className="status-dot" /><span>Prototipo visual</span></div>
          <div className="user-profile">
            <span className="avatar">P</span>
            <span><strong>Pablo</strong><small>Mi estudio</small></span>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>Mi estudio</span><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg><span className="breadcrumb-current">{navigation.find((item) => item.key === active)?.label}</span></div>
          <div className="topbar-actions">
            <div className="search-box search-box-inert" aria-label="Búsqueda disponible en una próxima versión">
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></svg>
              <span>Buscar campañas, videos…</span>
              <kbd>⌘ K</kbd>
            </div>
            <span className="avatar avatar-top" aria-label="Perfil de Pablo">P</span>
          </div>
        </header>
        <div className="content-wrap">{children}</div>
      </main>
    </div>
  );
}

export function PageIntro({ title, subtitle, note = "Datos de muestra" }: { title: string; subtitle: string; note?: string }) {
  return (
    <section className="page-intro" aria-labelledby="page-title">
      <div><h1 id="page-title">{title}</h1><p className="welcome-subtitle">{subtitle}</p></div>
      <span className="sample-note-inline">{note}</span>
    </section>
  );
}

export function Icon({ children, className = "icon" }: { children: ReactNode; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
}

export function PrototypeNotice({ children = "Contenido ilustrativo. Las conexiones y acciones todavía no están activas." }: { children?: string }) {
  return <p className="prototype-notice"><span className="status-dot" />{children}</p>;
}
