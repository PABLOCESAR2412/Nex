import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Icon, StudioShell } from "./studio-shell";
import { listContentFn, type ContentItem, type ContentState } from "../lib/content";

const stateLabels: Record<ContentState, string> = {
  borrador: "Borrador",
  en_revision: "En revisión",
  aprobada: "Aprobada",
  programada: "Programada",
  publicada: "Publicada",
};

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getMonday(date: Date) {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function humanDay(date: Date, today: Date) {
  if (dayKey(date) === dayKey(today)) return "Hoy";
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dayKey(date) === dayKey(tomorrow)) return "Mañana";
  return date.toLocaleDateString("es-EC", { weekday: "short", day: "numeric", month: "short" });
}

export function HomePage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listContentFn()
      .then((result) => { if (!cancelled) setItems(result); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "No se pudo cargar tu estudio."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const today = new Date();
  const scheduled = items
    .filter((item) => item.scheduled_at && new Date(item.scheduled_at).getTime() > today.getTime())
    .sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));
  const reviewCount = items.filter((item) => item.state === "en_revision").length;
  const featured = items.find((item) => item.state === "en_revision") ?? items[0];
  const weekStart = getMonday(today);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    return {
      date,
      events: items.filter((item) => item.scheduled_at && dayKey(new Date(item.scheduled_at)) === dayKey(date)),
    };
  });
  const dateLine = today.toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long" }).toUpperCase();

  return <StudioShell active="inicio">
    <section className="welcome-row" aria-labelledby="page-title">
      <div>
        <p className="date-line">{dateLine}</p>
        <h1 id="page-title">Tu estudio de contenido</h1>
        <p className="welcome-subtitle">Crea, revisa y organiza tus piezas desde un mismo lugar.</p>
      </div>
      <Link className="primary-button" to="/biblioteca"><Icon><path d="M12 5v14M5 12h14" /></Icon><span>Crear pieza</span></Link>
    </section>

    {error && <p className="content-feedback" role="alert">{error}</p>}

    <section className="overview-strip" aria-label="Resumen del estudio">
      <div className="overview-item">
        <span className="overview-icon"><Icon><path d="M7 3h10a2 2 0 0 1 2 2v16H5V5a2 2 0 0 1 2-2Z" /><path d="M8 8h8M8 12h8M8 16h5" /></Icon></span>
        <span className="overview-label">Por revisar</span><strong className="overview-value">{loading ? "—" : String(reviewCount).padStart(2, "0")}</strong>
      </div>
      <div className="overview-item">
        <span className="overview-icon"><Icon><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></Icon></span>
        <span className="overview-label">Programadas</span><strong className="overview-value">{loading ? "—" : String(scheduled.length).padStart(2, "0")}</strong>
      </div>
      <div className="overview-item">
        <span className="overview-icon"><Icon><path d="M4 5h16v14H4z" /><path d="M8 9h8M8 13h5" /></Icon></span>
        <span className="overview-label">Piezas totales</span><strong className="overview-value">{loading ? "—" : String(items.length).padStart(2, "0")}</strong>
      </div>
    </section>

    <div className="work-grid">
      <section className="production-section" aria-labelledby="production-title">
        <div className="section-heading">
          <div><h2 id="production-title">Producción en curso</h2><p>{featured ? stateLabels[featured.state as ContentState] ?? featured.state : "Tus piezas aparecerán aquí."}</p></div>
          <Link className="quiet-button" to="/biblioteca">Ver biblioteca <span aria-hidden="true">↗</span></Link>
        </div>
        {featured ? <article className="production-feature">
          <div className="reel-cover-wrap home-reel-cover">
            {featured.asset_key && featured.asset_content_type?.startsWith("video/") ? <video className="reel-cover" src={`/api/content/${encodeURIComponent(featured.id)}/asset`} controls preload="metadata" /> : featured.asset_key && featured.asset_content_type?.startsWith("image/") ? <img className="reel-cover" src={`/api/content/${encodeURIComponent(featured.id)}/asset`} alt={featured.asset_name ?? featured.title} /> : <div className="home-asset-placeholder"><Icon><path d="M5 4h14v16H5z" /><path d="m9 10 2 2 4-4M8 16h8" /></Icon></div>}
          </div>
          <div className="production-copy">
            <div className="production-meta">{featured.channels || "Canales por definir"}</div>
            <h3>{featured.title}</h3>
            <p className="campaign-description">{featured.description || "Añade una descripción para tener el contexto de esta pieza a mano."}</p>
            {featured.scheduled_at && <p className="content-feedback">Programada para {new Date(featured.scheduled_at).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short" })}</p>}
            <Link className="review-button" to="/biblioteca">Abrir pieza</Link>
          </div>
        </article> : <div className="home-empty-state">{loading ? "Cargando tus piezas…" : "Todavía no hay piezas. Crea la primera desde la biblioteca."} {!loading && <Link to="/biblioteca">Ir a la biblioteca</Link>}</div>}
      </section>

      <section className="upcoming-section" aria-labelledby="upcoming-title">
        <div className="section-heading">
          <div><h2 id="upcoming-title">Próximas publicaciones</h2><p>Fechas que organizaste en el calendario.</p></div>
          <Link className="icon-button" to="/calendario" aria-label="Abrir calendario"><Icon><path d="m9 18 6-6-6-6" /></Icon></Link>
        </div>
        <ul className="upcoming-list">
          {loading ? <li className="home-empty-state">Cargando calendario…</li> : scheduled.length === 0 ? <li className="home-empty-state">No tienes publicaciones programadas. Puedes añadir una fecha en la biblioteca.</li> : scheduled.slice(0, 3).map((item) => {
            const date = new Date(item.scheduled_at!);
            return <li className="upcoming-item" key={item.id}>
              <span className="social-icon"><Icon><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></Icon></span>
              <div className="upcoming-details"><span className="upcoming-time">{humanDay(date, today)} <i>·</i> {date.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}</span><strong>{item.title}</strong><small>{item.channels || "Sin canal asignado"}</small></div>
              <span className="schedule-state"><i />Programada</span>
            </li>;
          })}
        </ul>
        <Link className="text-link" to="/calendario">Ver calendario completo <span aria-hidden="true">↗</span></Link>
      </section>
    </div>

    <section className="calendar-section" id="calendario" aria-labelledby="calendar-title">
      <div className="calendar-heading">
        <div><h2 id="calendar-title">Esta semana</h2><p>Tu ritmo de publicación.</p></div>
        <div className="week-controls"><span>{weekStart.toLocaleDateString("es-EC", { day: "numeric", month: "short" })} — {days[6].date.toLocaleDateString("es-EC", { day: "numeric", month: "short" })}</span><Link className="text-link" to="/calendario">Abrir</Link></div>
      </div>
      <ol className="week-grid" aria-label="Calendario semanal de publicaciones">
        {days.map(({ date, events }) => <li className={`day-column${dayKey(date) === dayKey(today) ? " is-today" : ""}`} key={dayKey(date)}>
          <div className="day-head"><strong>{date.toLocaleDateString("es-EC", { weekday: "short" })}</strong><span>{date.toLocaleDateString("es-EC", { day: "numeric", month: "short" })}</span></div>
          {dayKey(date) === dayKey(today) && <div className="today-line">Hoy</div>}
          {events.map((item) => <div className="calendar-event" key={item.id}><Icon className="event-platform"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></Icon><span><b>{new Date(item.scheduled_at!).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}</b>{item.title}</span></div>)}
        </li>)}
      </ol>
    </section>

    <footer className="page-footer"><span>Un espacio para dar forma a las ideas.</span><span>Nex · tu centro de contenido</span></footer>
  </StudioShell>;
}
