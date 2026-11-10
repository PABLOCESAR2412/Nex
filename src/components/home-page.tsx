import { StudioShell } from './studio-shell';
import { Link } from "@tanstack/react-router";

export function HomePage() {
  return (
    <StudioShell active="inicio">
      <section className="welcome-row" aria-labelledby="page-title">
            <div>
              <p className="date-line">LUNES, 9 DE NOVIEMBRE</p>
              <h1 id="page-title">Tu estudio de contenido</h1>
              <p className="welcome-subtitle">Crea, revisa y programa desde un mismo lugar.</p>
            </div>
            <button className="primary-button" type="button" disabled>
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              <span>Crear pieza</span>
            </button>
          </section>

          <section className="overview-strip" aria-label="Resumen del estudio">
            <div className="overview-item">
              <span className="overview-icon"><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10a2 2 0 0 1 2 2v16H5V5a2 2 0 0 1 2-2Z" /><path d="M8 8h8M8 12h8M8 16h5" /></svg></span>
              <span className="overview-label">Por revisar</span><strong className="overview-value">03</strong>
            </div>
            <div className="overview-item">
              <span className="overview-icon"><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg></span>
              <span className="overview-label">Programadas</span><strong className="overview-value">08</strong>
            </div>
            <div className="overview-item">
              <span className="overview-icon"><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4.6V20" /></svg></span>
              <span className="overview-label">Cuentas conectadas</span><strong className="overview-value">04</strong>
            </div>
            <p className="sample-note">Datos de muestra</p>
          </section>

          <div className="work-grid">
            <section className="production-section" aria-labelledby="production-title">
              <div className="section-heading">
                <div><h2 id="production-title">Producción en curso</h2><p>Una pieza está lista para revisión.</p></div>
                <Link className="quiet-button" to="/biblioteca">Ver biblioteca <span aria-hidden="true">↗</span></Link>
              </div>
              <article className="production-feature">
                <div className="reel-cover-wrap">
                  <img className="reel-cover" src="/assets/cafe-cover.svg" alt="Portada editorial de muestra para el video Café de origen" />
                  <span className="duration">0:58</span>
                  <button className="play-button" type="button" disabled aria-label="Vista previa del video">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 10 6-10 6z" /></svg>
                  </button>
                </div>
                <div className="production-copy">
                  <div className="production-meta"><span className="channel-pair"><span className="platform-mark instagram-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8"/></svg></span><span className="platform-mark tiktok-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 3v11.2a4.2 4.2 0 1 1-3.3-4.1M14 3c.5 3.2 2.5 5 5.5 5.5"/></svg></span></span><span>Instagram · TikTok</span></div>
                  <h3>El café que despierta ideas</h3>
                  <p className="campaign-description">Una pausa breve, contada desde el origen.</p>

                  <div className="production-progress" aria-label="Progreso de la pieza: 3 de 4 etapas">
                    <div className="progress-fill"></div>
                  </div>
                  <ol className="stage-list">
                    <li className="stage-done"><span className="stage-indicator"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg></span><span>Brief</span><span className="stage-check">Listo</span></li>
                    <li className="stage-done"><span className="stage-indicator"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg></span><span>Guion</span><span className="stage-check">Listo</span></li>
                    <li className="stage-current"><span className="stage-indicator"></span><span>Video en revisión</span><span className="stage-current-label">Ahora</span></li>
                    <li><span className="stage-indicator"></span><span>Programación</span></li>
                  </ol>
                  <button className="review-button" type="button" disabled>Revisar video</button>
                </div>
              </article>
            </section>

            <section className="upcoming-section" aria-labelledby="upcoming-title">
              <div className="section-heading">
                <div><h2 id="upcoming-title">Próximas publicaciones</h2><p>Lo que viene en tus cuentas.</p></div>
                <button className="icon-button" type="button" disabled aria-label="Más publicaciones">
                  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
                </button>
              </div>
              <ul className="upcoming-list">
                <li className="upcoming-item">
                  <span className="social-icon instagram-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8"/></svg></span>
                  <div className="upcoming-details"><span className="upcoming-time">Hoy <i>·</i> 18:30</span><strong>Café de origen</strong><small>Instagram · nex.estudio</small></div>
                  <span className="schedule-state"><i></i>Programada</span>
                </li>
                <li className="upcoming-item">
                  <span className="social-icon tiktok-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 3v11.2a4.2 4.2 0 1 1-3.3-4.1M14 3c.5 3.2 2.5 5 5.5 5.5"/></svg></span>
                  <div className="upcoming-details"><span className="upcoming-time">Mañana <i>·</i> 12:00</span><strong>Un minuto de productividad</strong><small>TikTok · nex.crea</small></div>
                  <span className="schedule-state"><i></i>Programada</span>
                </li>
                <li className="upcoming-item">
                  <span className="social-icon youtube-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="m10 9 5 3-5 3z"/></svg></span>
                  <div className="upcoming-details"><span className="upcoming-time">Jue <i>·</i> 19:00</span><strong>Historia del proyecto</strong><small>YouTube · Nex Studio</small></div>
                  <span className="schedule-state"><i></i>Programada</span>
                </li>
              </ul>
              <Link className="text-link" to="/calendario">Ver calendario completo <span aria-hidden="true">↗</span></Link>
            </section>
          </div>

          <section className="calendar-section" id="calendario" aria-labelledby="calendar-title">
            <div className="calendar-heading">
              <div><h2 id="calendar-title">Esta semana</h2><p>Una vista rápida del ritmo de publicación.</p></div>
              <div className="week-controls">
                <button className="icon-button" type="button" disabled aria-label="Semana anterior"><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
                <span>9 — 15 nov</span>
                <button className="icon-button" type="button" disabled aria-label="Semana siguiente"><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></button>
              </div>
            </div>
            <ol className="week-grid" aria-label="Calendario semanal de publicaciones">
              <li className="day-column"><div className="day-head"><strong>Lun</strong><span>9 nov</span></div><div className="today-line">Hoy</div></li>
              <li className="day-column"><div className="day-head"><strong>Mar</strong><span>10 nov</span></div><div className="calendar-event event-tiktok"><svg className="event-platform" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3v11.2a4.2 4.2 0 1 1-3.3-4.1M14 3c.5 3.2 2.5 5 5.5 5.5"/></svg><span><b>12:00</b>Un minuto de productividad</span></div></li>
              <li className="day-column"><div className="day-head"><strong>Mié</strong><span>11 nov</span></div></li>
              <li className="day-column"><div className="day-head"><strong>Jue</strong><span>12 nov</span></div><div className="calendar-event event-youtube"><svg className="event-platform" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="m10 9 5 3-5 3z"/></svg><span><b>19:00</b>Historia del proyecto</span></div></li>
              <li className="day-column"><div className="day-head"><strong>Vie</strong><span>13 nov</span></div></li>
              <li className="day-column"><div className="day-head"><strong>Sáb</strong><span>14 nov</span></div><div className="calendar-event event-instagram"><svg className="event-platform" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8"/></svg><span><b>18:30</b>Café de origen</span></div></li>
              <li className="day-column"><div className="day-head"><strong>Dom</strong><span>15 nov</span></div></li>
            </ol>
          </section>

          <footer className="page-footer"><span>Un espacio para dar forma a las ideas.</span><span>Prototipo visual · Nex</span></footer>
    </StudioShell>
  );
}
