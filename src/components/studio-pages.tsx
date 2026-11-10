import { useState, useEffect } from "react";
import { Icon, PageIntro, PrototypeNotice, StudioShell } from "./studio-shell";
import { listContentFn, createContentFn } from "../lib/content";

const weekDays = [
  { day: "Lun", date: "9 nov", today: true },
  { day: "Mar", date: "10 nov", event: { time: "12:00", title: "Un minuto de productividad", platform: "TikTok", style: "tiktok" } },
  { day: "Mié", date: "11 nov" },
  { day: "Jue", date: "12 nov", event: { time: "19:00", title: "Historia del proyecto", platform: "YouTube", style: "youtube" } },
  { day: "Vie", date: "13 nov" },
  { day: "Sáb", date: "14 nov", event: { time: "18:30", title: "Café de origen", platform: "Instagram", style: "instagram" } },
  { day: "Dom", date: "15 nov" },
];

function SocialIcon({ platform }: { platform: string }) {
  if (platform === "Instagram") return <Icon className="social-icon" ><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".8" /></Icon>;
  if (platform === "TikTok") return <Icon className="social-icon tiktok-icon"><path d="M14 3v11.2a4.2 4.2 0 1 1-3.3-4.1M14 3c.5 3.2 2.5 5 5.5 5.5" /></Icon>;
  if (platform === "YouTube") return <Icon className="social-icon youtube-icon"><rect x="2.5" y="5" width="19" height="14" rx="4" /><path d="m10 9 5 3-5 3z" /></Icon>;
  return <Icon className="social-icon"><circle cx="12" cy="12" r="9" /><path d="M8 12h8M12 8v8" /></Icon>;
}

function PageSection({ title, detail, children, className = "" }: { title: string; detail?: string; children: React.ReactNode; className?: string }) {
  return <section className={`page-section ${className}`}><div className="page-section-heading"><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div></div>{children}</section>;
}

export function CalendarPage() {
  return <StudioShell active="calendario">
    <PageIntro title="Calendario" subtitle="Cada pieza en su momento, cada canal en su ritmo." />
    <PrototypeNotice />
    <section className="schedule-toolbar" aria-label="Controles del calendario">
      <div className="view-switch" aria-label="Vista semanal seleccionada"><span className="selected">Semana</span><span>Mes</span></div>
      <div className="week-controls">
        <button className="icon-button" type="button" disabled aria-label="Semana anterior"><Icon><path d="m15 18-6-6 6-6" /></Icon></button>
        <strong>9 — 15 nov 2026</strong>
        <button className="icon-button" type="button" disabled aria-label="Semana siguiente"><Icon><path d="m9 18 6-6-6-6" /></Icon></button>
      </div>
      <button className="quiet-button" type="button" disabled>Hoy</button>
    </section>
    <div className="calendar-scroller">
      <ol className="week-grid full-calendar" aria-label="Semana del 9 al 15 de noviembre">
        {weekDays.map((item) => <li className={`day-column${item.today ? " is-today" : ""}`} key={item.day}>
          <div className="day-head"><strong>{item.day}</strong><span>{item.date}</span></div>
          {item.today && <span className="today-line">Hoy</span>}
          {item.event && <div className={`calendar-event event-${item.event.style}`}><SocialIcon platform={item.event.platform} /><span><b>{item.event.time}</b>{item.event.title}<small>{item.event.platform}</small></span></div>}
        </li>)}
      </ol>
    </div>
    <PageSection title="Publicaciones de la semana" detail="Tres piezas preparadas en este calendario de muestra.">
      <ul className="schedule-list">
        {[
          ["Mar 10 nov", "12:00", "Un minuto de productividad", "TikTok · nex.crea"],
          ["Jue 12 nov", "19:00", "Historia del proyecto", "YouTube · Nex Studio"],
          ["Sáb 14 nov", "18:30", "Café de origen", "Instagram · nex.estudio"],
        ].map(([date, time, title, destination]) => <li className="schedule-row" key={title}><div className="schedule-date"><strong>{date}</strong><span>{time}</span></div><div className="schedule-title"><strong>{title}</strong><small>{destination}</small></div><span className="schedule-state"><i />Programada</span></li>)}
      </ul>
    </PageSection>
  </StudioShell>;
}

const assets = [
  { title: "Café de origen", description: "Una pausa breve, contada desde el origen.", type: "Video vertical", length: "0:58", channels: "Instagram · TikTok", state: "En revisión", cover: true },
  { title: "Historia del proyecto", description: "Cómo empezó el estudio y qué lo inspira.", type: "Guion", length: "6 escenas", channels: "YouTube", state: "Listo para producir" },
  { title: "Un minuto de productividad", description: "Tres ideas para cuidar el foco durante el día.", type: "Video vertical", length: "0:42", channels: "TikTok", state: "Programada" },
  { title: "Notas de contenido · noviembre", description: "Referencias, tono y objetivos de contenido.", type: "Documento", length: "4 páginas", channels: "Uso interno", state: "Borrador" },
];

export function LibraryPage() {
  const [items, setItems] = useState<Array<{ id: string; title: string; description: string | null; type: string; state: string; channels: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listContentFn()
      .then((res) => { if (!cancelled) setItems(res as any); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Error"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      await createContentFn({ data: { title: title.trim(), type: "video" } });
      setTitle("");
      const res = await listContentFn();
      setItems(res as any);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setCreating(false);
    }
  }

  return <StudioShell active="biblioteca">
    <PageIntro title="Biblioteca" subtitle="Videos, guiones y referencias de tu estudio." />
    {error && <p className="prototype-notice">{error} — <a href="/login">Iniciar sesión</a></p>}
    <form className="library-toolbar" onSubmit={handleCreate}>
      <div className="library-search"><Icon><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></Icon><input placeholder="Título de la nueva pieza" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="filter-group"><button type="button" disabled className="filter-chip active">Todo <span>{items.length}</span></button></div>
      <button className="primary-button" type="submit" disabled={creating || !title.trim()}><Icon><path d="M12 5v14M5 12h14" /></Icon><span>{creating ? "Creando…" : "Añadir pieza"}</span></button>
    </form>
    <PageSection title="Material reciente" detail="Ordenado por última actividad.">
      {loading ? <p>Cargando…</p> : (
        <ul className="library-list">
          {items.length === 0 && <li className="library-row"><div className="library-main"><h3>Sin piezas aún</h3><p>Crea tu primera pieza arriba.</p></div></li>}
          {items.map((asset, index) => <li className="library-row" key={asset.id}>
            <div className={`asset-monogram asset-monogram-${index}`} aria-hidden="true"><span>{asset.type === "guion" ? "G" : asset.type === "documento" ? "N" : "V"}</span></div>
            <div className="library-main"><div className="library-title-line"><h3>{asset.title}</h3><span className="asset-type">{asset.type}</span></div><p>{asset.description ?? "—"}</p><small>{asset.channels ?? "—"} <i>·</i> {asset.state}</small></div>
            <div className="library-state"><span className={`state-mark state-${index % 4}`} /><span>{asset.state}</span></div>
          </li>)}
        </ul>
      )}
    </PageSection>
    <div className="library-footnote"><span>{items.length} piezas</span><span>Almacenamiento en R2 y D1.</span></div>
  </StudioShell>;
}

const accounts = [
  { platform: "Instagram", handle: "@nex.estudio", type: "Cuenta de creador", status: "Conexión de muestra", note: "Publicaciones y reels" },
  { platform: "TikTok", handle: "@nex.crea", type: "Cuenta personal", status: "Conexión de muestra", note: "Videos cortos" },
  { platform: "YouTube", handle: "Nex Studio", type: "Canal", status: "Conexión de muestra", note: "Videos y Shorts" },
  { platform: "Instagram", handle: "@pablo.crea", type: "Cuenta personal", status: "Sin configurar", note: "Lista para conectarse" },
];

export function AccountsPage() {
  return <StudioShell active="cuentas">
    <PageIntro title="Cuentas" subtitle="Los destinos que forman parte de tu estudio." />
    <PrototypeNotice>Las cuentas de esta vista son ejemplos; no hay sesiones sociales conectadas.</PrototypeNotice>
    <section className="account-overview"><span className="overview-icon"><Icon><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4.6V20" /></Icon></span><div><strong>Destinos sociales</strong><p>Organiza las cuentas donde aparecerá cada pieza.</p></div><button className="primary-button" type="button" disabled><Icon><path d="M12 5v14M5 12h14" /></Icon><span>Conectar cuenta</span></button></section>
    <PageSection title="Canales del estudio" detail="Una misma pieza puede preparar contenido para varios destinos.">
      <ul className="account-list">
        {accounts.map((account, index) => <li className="account-row" key={`${account.platform}-${account.handle}`}><div className={`account-social account-social-${account.platform.toLowerCase()}`}><SocialIcon platform={account.platform} /></div><div className="account-identity"><strong>{account.handle}</strong><span>{account.platform} · {account.type}</span></div><div className="account-purpose">{account.note}</div><span className={`account-status${index === 3 ? " account-status-muted" : ""}`}><i />{account.status}</span><button className="icon-button" type="button" disabled aria-label={`Opciones de ${account.handle}`}><Icon><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Icon></button></li>)}
      </ul>
    </PageSection>
    <div className="permission-note"><Icon><path d="M12 3 4 6v5c0 5 3.4 8 8 10 4.6-2 8-5 8-10V6z" /><path d="M9 12h6M12 9v6" /></Icon><p><strong>Permisos claros</strong><span>Cuando conectes una cuenta, Nex indicará qué permisos solicita y para qué los necesita.</span></p></div>
  </StudioShell>;
}

const deployments = [
  { name: "Estudio Nex", provider: "Cloudflare Pages", domain: "estudio-nex.example", branch: "main", time: "Hoy · 14:32", status: "Publicado · muestra", tone: "ready" },
  { name: "Landing de lanzamiento", provider: "Vercel", domain: "campana-nex.example", branch: "preview/social-launch", time: "Ayer · 18:06", status: "Vista previa · muestra", tone: "preview" },
];

export function DeploymentsPage() {
  return <StudioShell active="despliegues">
    <PageIntro title="Despliegues" subtitle="Una vista de los sitios que acompañan tus piezas." />
    <PrototypeNotice>Estos registros son ilustrativos. No se consulta ni publica en Cloudflare o Vercel.</PrototypeNotice>
    <div className="deployment-layout">
      <PageSection title="Proyectos" detail="Entornos de publicación de muestra." className="deployment-projects">
        <ul className="deployment-list">
          {deployments.map((deployment) => <li className="deployment-row" key={deployment.name}>
            <div className="deployment-symbol"><Icon>{deployment.provider === "Vercel" ? <><path d="M12 4 22 20H2z" /></> : <><path d="M12 3 2.8 19h18.4z" /><path d="M12 10v5M12 17h.01" /></>}</Icon></div>
            <div className="deployment-main"><div className="deployment-title"><h3>{deployment.name}</h3><span>{deployment.provider}</span></div><span className="deployment-domain">{deployment.domain}</span><small>{deployment.branch} <i>·</i> {deployment.time}</small></div>
            <span className={`deployment-status ${deployment.tone}`}><i />{deployment.status}</span>
            <button className="quiet-button" type="button" disabled>Ver registro</button>
          </li>)}
        </ul>
      </PageSection>
      <aside className="deployment-aside"><span className="aside-orbit"><Icon><path d="M3 12h18M12 3v18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" /></Icon></span><h2>Publicaciones con contexto</h2><p>En la siguiente etapa podrás revisar proveedor, rama, dominio y resultado junto a cada pieza.</p><button className="quiet-button" type="button" disabled>Configurar proveedor</button></aside>
    </div>
    <PageSection title="Actividad reciente" detail="Historial de muestra; la actualización automática aún no está disponible.">
      <ul className="activity-list"><li><span className="activity-mark" /><p><strong>Estudio Nex</strong> <span>publicación completada</span><small>Cloudflare Pages · Hoy a las 14:32</small></p></li><li><span className="activity-mark activity-mark-soft" /><p><strong>Landing de pieza</strong> <span>vista previa preparada</span><small>Vercel · Ayer a las 18:06</small></p></li></ul>
    </PageSection>
  </StudioShell>;
}

const preferences = [
  { title: "Zona horaria", value: "America/Guayaquil", help: "Se usará para mostrar las fechas y horas del calendario." },
  { title: "Idioma del estudio", value: "Español", help: "Idioma de navegación y borradores de contenido." },
  { title: "Formato habitual", value: "Vertical · 9:16", help: "Formato recomendado para Reels, TikTok y Shorts." },
];

export function SettingsPage() {
  return <StudioShell active="ajustes">
    <PageIntro title="Ajustes" subtitle="Prepara el espacio de trabajo a tu manera." />
    <PrototypeNotice>Las preferencias se muestran como referencia y todavía no se guardan.</PrototypeNotice>
    <div className="settings-layout">
      <div className="settings-main">
        <PageSection title="Tu estudio" detail="El espacio desde el que organizas tus piezas.">
          <div className="workspace-settings"><span className="workspace-monogram">P</span><div><strong>Mi estudio</strong><span>Espacio personal de Pablo</span></div><button className="quiet-button" type="button" disabled>Editar</button></div>
        </PageSection>
        <PageSection title="Preferencias" detail="Ajustes iniciales para ordenar tu contenido.">
          <div className="preference-list">{preferences.map((preference) => <div className="preference-row" key={preference.title}><div><strong>{preference.title}</strong><p>{preference.help}</p></div><button className="select-like" type="button" disabled>{preference.value}<Icon><path d="m7 10 5 5 5-5" /></Icon></button></div>)}</div>
        </PageSection>
      </div>
      <aside className="settings-aside"><h2>Notificaciones</h2><p>Elige qué novedades te gustaría recibir.</p><label className="setting-toggle"><span><strong>Revisión pendiente</strong><small>Cuando una pieza necesite tu aprobación.</small></span><input type="checkbox" disabled /></label><label className="setting-toggle"><span><strong>Publicación próxima</strong><small>Un recordatorio antes de la hora programada.</small></span><input type="checkbox" disabled /></label><div className="settings-hint">Los controles se activarán cuando el estudio pueda guardar tus preferencias.</div></aside>
    </div>
    <div className="settings-profile"><span className="avatar">P</span><div><strong>Pablo</strong><span>Perfil de muestra · sin cuenta conectada</span></div><button className="quiet-button" type="button" disabled>Gestionar perfil</button></div>
  </StudioShell>;
}
