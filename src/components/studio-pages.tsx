import { useState, useEffect } from "react";
import { Icon, PageIntro, PrototypeNotice, StudioShell } from "./studio-shell";
import { CONTENT_STATES, type ContentItem, type ContentState, createContentFn, deleteContentFn, listContentFn, updateContentFn } from "../lib/content";
import { listInstagramAccountsFn, type InstagramAccountSummary } from "../lib/social";

const stateLabels: Record<ContentState, string> = {
  borrador: "Borrador",
  en_revision: "En revisión",
  aprobada: "Aprobada",
  programada: "Programada",
  publicada: "Publicada",
};

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function mondayOf(date: Date) {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function toDateTimeInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatFileSize(size: number | null) {
  if (!size) return "";
  if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(size / 1024))} KB`;
}

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
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listContentFn()
      .then((result) => { if (!cancelled) setItems(result); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "No se pudo cargar el calendario."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const today = new Date();
  const weekStart = mondayOf(today);
  weekStart.setDate(weekStart.getDate() + weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    const key = dateKey(date);
    const events = items
      .filter((item) => item.scheduled_at && dateKey(new Date(item.scheduled_at)) === key)
      .sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));
    return { date, key, events };
  });
  const weekEnd = days[6].date;
  const weekLabel = `${weekStart.toLocaleDateString("es-EC", { day: "numeric", month: "short" })} — ${weekEnd.toLocaleDateString("es-EC", { day: "numeric", month: "short", year: "numeric" })}`;
  const scheduled = items.filter((item) => item.scheduled_at).sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));

  return <StudioShell active="calendario">
    <PageIntro title="Calendario" subtitle="Cada pieza en su momento, cada canal en su ritmo." />
    <PrototypeNotice>Las fechas se guardan en tu biblioteca. La publicación automática llegará con las conexiones sociales.</PrototypeNotice>
    {error && <p className="content-feedback" role="alert">{error}{/unauthorized|inicia sesión/i.test(error) && <> — <a href="/login">Iniciar sesión</a></>}</p>}
    <section className="schedule-toolbar" aria-label="Controles del calendario">
      <div className="view-switch" aria-label="Vista semanal seleccionada"><span className="selected">Semana</span></div>
      <div className="week-controls">
        <button className="icon-button" type="button" onClick={() => setWeekOffset((value) => value - 1)} aria-label="Semana anterior"><Icon><path d="m15 18-6-6 6-6" /></Icon></button>
        <strong>{weekLabel}</strong>
        <button className="icon-button" type="button" onClick={() => setWeekOffset((value) => value + 1)} aria-label="Semana siguiente"><Icon><path d="m9 18 6-6-6-6" /></Icon></button>
      </div>
      <button className="quiet-button" type="button" onClick={() => setWeekOffset(0)}>Hoy</button>
    </section>
    <div className="calendar-scroller">
      <ol className="week-grid full-calendar" aria-label="Calendario semanal">
        {days.map(({ date, key, events }) => <li className={`day-column${key === dateKey(today) ? " is-today" : ""}`} key={key}>
          <div className="day-head"><strong>{date.toLocaleDateString("es-EC", { weekday: "short" })}</strong><span>{date.toLocaleDateString("es-EC", { day: "numeric", month: "short" })}</span></div>
          {key === dateKey(today) && <span className="today-line">Hoy</span>}
          {events.map((item) => {
            const channel = item.channels?.split(/[·,]/)[0]?.trim() ?? "";
            const time = new Date(item.scheduled_at!).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
            return <div className={`calendar-event ${channel ? `event-${channel.toLowerCase()}` : ""}`} key={item.id}>
              {channel ? <SocialIcon platform={channel} /> : <Icon className="social-icon"><path d="M12 5v14M5 12h14" /></Icon>}
              <span><b>{time}</b>{item.title}<small>{stateLabels[item.state as ContentState] ?? item.state}</small></span>
            </div>;
          })}
        </li>)}
      </ol>
    </div>
    <PageSection title="Publicaciones programadas" detail="Programa o cambia las fechas desde la biblioteca.">
      {loading ? <p>Cargando calendario…</p> : scheduled.length === 0 ? <p className="content-empty">Todavía no hay piezas programadas. Añade una fecha desde la biblioteca.</p> : <ul className="schedule-list">
        {scheduled.map((item) => {
          const date = new Date(item.scheduled_at!);
          return <li className="schedule-row" key={item.id}>
            <div className="schedule-date"><strong>{date.toLocaleDateString("es-EC", { weekday: "short", day: "numeric", month: "short" })}</strong><span>{date.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}</span></div>
            <div className="schedule-title"><strong>{item.title}</strong><small>{item.channels || "Sin canal asignado"}</small></div>
            <span className="schedule-state"><i />{stateLabels[item.state as ContentState] ?? item.state}</span>
          </li>;
        })}
      </ul>}
    </PageSection>
  </StudioShell>;
}

function ContentEditor({ item, instagramAccounts, onChanged, onDeleted }: { item: ContentItem; instagramAccounts: InstagramAccountSummary[]; onChanged: () => Promise<void>; onDeleted: (assetCleanupPending: boolean) => Promise<void> }) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? "");
  const [script, setScript] = useState(item.script ?? "");
  const [channels, setChannels] = useState(item.channels ?? "");
  const [state, setState] = useState<ContentState>(CONTENT_STATES.includes(item.state as ContentState) ? item.state as ContentState : "borrador");
  const [scheduledAt, setScheduledAt] = useState(toDateTimeInput(item.scheduled_at));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishAccountId, setPublishAccountId] = useState(instagramAccounts[0]?.id ?? "");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!instagramAccounts.some((account) => account.id === publishAccountId)) {
      setPublishAccountId(instagramAccounts[0]?.id ?? "");
    }
  }, [instagramAccounts, publishAccountId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const date = scheduledAt ? new Date(scheduledAt) : null;
      const nextState = date ? "programada" : state === "programada" ? "borrador" : state;
      await updateContentFn({ data: { id: item.id, title, description, script, channels, state: nextState, scheduledAt: date?.toISOString() ?? null } });
      await onChanged();
      setState(nextState);
      setMessage("Cambios guardados.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudieron guardar los cambios.");
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File) {
    setMessage(null);
    setUploading(true);
    setProgress(0);
    let uploadId = "";
    try {
      const endpoint = `/api/content/${encodeURIComponent(item.id)}/upload`;
      const start = await fetch(`${endpoint}?action=start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
      });
      const startData = await start.json() as { uploadId?: string; partSize?: number; error?: string };
      if (!start.ok || !startData.uploadId || !startData.partSize) throw new Error(startData.error ?? "No se pudo iniciar la carga.");
      uploadId = startData.uploadId;
      const partSize = startData.partSize;
      const parts: Array<{ partNumber: number; etag: string }> = [];
      const partCount = Math.ceil(file.size / partSize);
      for (let partNumber = 1; partNumber <= partCount; partNumber++) {
        const chunk = file.slice((partNumber - 1) * partSize, Math.min(partNumber * partSize, file.size));
        const response = await fetch(`${endpoint}?action=part&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`, { method: "PUT", body: chunk });
        const data = await response.json() as { partNumber?: number; etag?: string; error?: string };
        if (!response.ok || typeof data.partNumber !== "number" || typeof data.etag !== "string") throw new Error(data.error ?? `No se pudo subir la parte ${partNumber}.`);
        parts.push({ partNumber: data.partNumber, etag: data.etag });
        setProgress(Math.round((partNumber / partCount) * 100));
      }
      const complete = await fetch(`${endpoint}?action=complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId, parts }),
      });
      const completeData = await complete.json() as { error?: string };
      if (!complete.ok) throw new Error(completeData.error ?? "No se pudo guardar el archivo.");
      uploadId = "";
      await onChanged();
      setMessage("Archivo guardado en la pieza.");
    } catch (e) {
      if (uploadId) await fetch(`/api/content/${encodeURIComponent(item.id)}/upload?action=abort&uploadId=${encodeURIComponent(uploadId)}`, { method: "POST" }).catch(() => undefined);
      setMessage(e instanceof Error ? e.message : "No se pudo subir el archivo.");
    } finally {
      setUploading(false);
    }
  }

  async function publishToInstagram() {
    const account = instagramAccounts.find((candidate) => candidate.id === publishAccountId);
    if (!account) {
      setMessage("Conecta una cuenta de Instagram desde Cuentas antes de publicar.");
      return;
    }
    if (!window.confirm("¿Publicar ahora “" + item.title + "” como Reel en " + account.handle + "? Será visible para esa cuenta.")) return;
    setMessage(null);
    setPublishing(true);
    try {
      const startResponse = await fetch("/api/social/instagram/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", contentId: item.id, accountId: account.id }),
      });
      const start = await startResponse.json() as { jobId?: string; error?: string };
      if (!startResponse.ok || !start.jobId) throw new Error(start.error ?? "No se pudo iniciar la publicación.");

      for (let attempt = 0; attempt < 48; attempt++) {
        setMessage("Instagram está preparando el Reel…");
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const checkResponse = await fetch("/api/social/instagram/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "check", jobId: start.jobId }),
        });
        const check = await checkResponse.json() as { status?: string; error?: string };
        if (check.status === "published") {
          setState("publicada");
          await onChanged();
          setMessage("Reel publicado en " + account.handle + ".");
          return;
        }
        if (check.status === "failed" || check.status === "needs_review" || !checkResponse.ok) {
          throw new Error(check.error ?? "Instagram no pudo completar la publicación.");
        }
      }
      setMessage("El Reel sigue procesándose en Instagram. Puedes volver a intentar revisar su estado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo publicar en Instagram.");
    } finally {
      setPublishing(false);
    }
  }

  async function remove() {
    if (!window.confirm(`¿Eliminar “${item.title}” y su archivo?`)) return;
    setMessage(null);
    try {
      const result = await deleteContentFn({ data: { id: item.id } });
      await onDeleted(result.assetCleanupPending);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo eliminar la pieza.");
    }
  }

  const assetUrl = `/api/content/${encodeURIComponent(item.id)}/asset`;
  return <li className="library-row content-row">
    <div className="asset-monogram" aria-hidden="true"><span>{item.asset_content_type?.startsWith("image/") ? "I" : item.asset_content_type?.startsWith("video/") ? "V" : "N"}</span></div>
    <div className="library-main">
      <form className="content-edit-form" onSubmit={save}>
        <div className="content-fields">
          <label>Título<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required /></label>
          <label>Estado<select value={state} onChange={(e) => setState(e.target.value as ContentState)}>{CONTENT_STATES.map((value) => <option key={value} value={value}>{stateLabels[value]}</option>)}</select></label>
          <label>Canales previstos<input value={channels} onChange={(e) => setChannels(e.target.value)} placeholder="Instagram, TikTok…" maxLength={200} /></label>
          <label>Fecha y hora<input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></label>
        </div>
        <label className="content-description">Descripción<textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={2} /></label>
        <label className="content-description">Guion<textarea value={script} onChange={(e) => setScript(e.target.value)} maxLength={20000} rows={5} placeholder="Guarda aquí el guion o las notas de producción." /></label>
        <div className="content-row-actions">
          <button className="primary-button" type="submit" disabled={saving || uploading}>{saving ? "Guardando…" : "Guardar cambios"}</button>
          <label className="quiet-button file-button">{item.asset_key ? "Reemplazar archivo" : "Adjuntar archivo"}<input type="file" accept="video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp,application/pdf" disabled={uploading || saving} onChange={(e) => { const file = e.currentTarget.files?.[0]; if (file) void upload(file); e.currentTarget.value = ""; }} /></label>
          {item.state === "aprobada" && ["video/mp4", "video/quicktime"].includes(item.asset_content_type ?? "") && instagramAccounts.length > 0 && <div className="publish-social-control">
            {instagramAccounts.length > 1 && <label className="sr-only">Cuenta de Instagram<select value={publishAccountId} onChange={(e) => setPublishAccountId(e.target.value)} disabled={publishing}>{instagramAccounts.map((account) => <option key={account.id} value={account.id}>{account.handle}</option>)}</select></label>}
            <button className="quiet-button" type="button" disabled={saving || uploading || publishing} onClick={() => void publishToInstagram()}>{publishing ? "Publicando…" : "Publicar Reel"}</button>
          </div>}
          <button className="quiet-button delete-content-button" type="button" disabled={saving || uploading || publishing} onClick={() => void remove()}>Eliminar pieza</button>
        </div>
      </form>
      {uploading && <div className="upload-progress" role="status"><progress value={progress} max={100} />Subiendo archivo… {progress}%</div>}
      {message && <p className="content-feedback" role="status">{message}</p>}
      {item.asset_key && <div className="content-asset">
        {item.asset_content_type?.startsWith("video/") ? <video src={assetUrl} controls preload="metadata" /> : item.asset_content_type?.startsWith("image/") ? <a href={assetUrl} target="_blank" rel="noreferrer"><img src={assetUrl} alt={item.asset_name ?? item.title} /></a> : <a href={assetUrl}>{item.asset_name ?? "Abrir archivo"}</a>}
        <span>{item.asset_name} · {formatFileSize(item.asset_size)}</span>
      </div>}
    </div>
  </li>;
}

export function LibraryPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [channels, setChannels] = useState("");
  const [creating, setCreating] = useState(false);
  const [instagramAccounts, setInstagramAccounts] = useState<InstagramAccountSummary[]>([]);

  async function refresh() {
    const result = await listContentFn();
    setItems(result);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    listContentFn()
      .then((result) => { if (!cancelled) setItems(result); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "No se pudo cargar la biblioteca."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    listInstagramAccountsFn()
      .then((result) => { if (!cancelled) setInstagramAccounts(result.accounts.filter((account) => account.status === "conectada")); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    setCreating(true);
    try {
      await createContentFn({ data: { title: title.trim(), channels: channels.trim() || undefined, type: "video" } });
      setTitle("");
      setChannels("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la pieza.");
    } finally {
      setCreating(false);
    }
  }

  return <StudioShell active="biblioteca">
    <PageIntro title="Biblioteca" subtitle="Videos, guiones y referencias de tu estudio." />
    {!loading && instagramAccounts.length === 0 && <p className="content-feedback">Para publicar un Reel, conecta una cuenta profesional desde <a href="/cuentas">Cuentas</a>.</p>}
    {error && <p className="prototype-notice">{error}{/unauthorized|inicia sesión/i.test(error) && <> — <a href="/login">Iniciar sesión</a></>}</p>}
    <form className="library-toolbar" onSubmit={handleCreate}>
      <div className="library-search"><Icon><path d="M12 5v14M5 12h14" /></Icon><input aria-label="Título de la nueva pieza" placeholder="Título de la nueva pieza" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required /></div>
      <div className="library-search"><input aria-label="Canales previstos" placeholder="Canales previstos · Instagram, TikTok…" value={channels} onChange={(e) => setChannels(e.target.value)} maxLength={200} /></div>
      <button className="primary-button" type="submit" disabled={creating || !title.trim()}><Icon><path d="M12 5v14M5 12h14" /></Icon><span>{creating ? "Creando…" : "Añadir pieza"}</span></button>
    </form>
    <PageSection title="Material reciente" detail="Ordenado por última actividad.">
      {loading ? <p>Cargando biblioteca…</p> : (
        <ul className="library-list">
          {items.length === 0 && <li className="content-empty">Todavía no hay piezas. Crea una arriba para guardar su guion, archivo y fecha.</li>}
          {items.map((item) => <ContentEditor key={item.id} item={item} instagramAccounts={instagramAccounts} onChanged={refresh} onDeleted={async (cleanupPending) => { await refresh(); if (cleanupPending) setError("La pieza se eliminó; no se pudo borrar su archivo de R2."); }} />)}
        </ul>
      )}
    </PageSection>
    <div className="library-footnote"><span>{items.length} piezas</span><span>Datos en D1 · archivos privados en R2.</span></div>
  </StudioShell>;
}

const unconnectedAccounts = [
  { platform: "TikTok", handle: "Sin conectar", type: "TikTok", status: "Sin conectar", note: "Publicación de videos próximamente" },
  { platform: "YouTube", handle: "Sin conectar", type: "Canal", status: "Sin conectar", note: "Videos y Shorts próximamente" },
];

export function AccountsPage() {
  const [instagramAccounts, setInstagramAccounts] = useState<InstagramAccountSummary[]>([]);
  const [configured, setConfigured] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refreshAccounts() {
    try {
      const result = await listInstagramAccountsFn();
      setInstagramAccounts(result.accounts);
      setConfigured(result.configured);
      setAccountError(null);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "No se pudieron cargar las cuentas.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    listInstagramAccountsFn()
      .then((result) => {
        if (cancelled) return;
        setInstagramAccounts(result.accounts);
        setConfigured(result.configured);
      })
      .catch((error) => {
        if (!cancelled) setAccountError(error instanceof Error ? error.message : "No se pudieron cargar las cuentas.");
      });
    const status = new URLSearchParams(window.location.search).get("instagram");
    const messages: Record<string, string> = {
      connected: "Cuenta de Instagram conectada.",
      denied: "No se concedieron los permisos de Instagram.",
      config: "Configura la app de Meta antes de conectar Instagram.",
      expired: "La conexión venció. Vuelve a intentarlo.",
      invalid: "No se pudo validar la conexión.",
      token_error: "Instagram no entregó un token válido. Intenta conectar de nuevo.",
      profile_error: "No se pudo leer el perfil profesional de Instagram.",
      error: "No se pudo completar la conexión con Instagram.",
    };
    if (status && messages[status]) {
      setNotice(messages[status]);
      window.history.replaceState({}, "", window.location.pathname);
    }
    return () => { cancelled = true; };
  }, []);

  async function disconnectInstagram(account: InstagramAccountSummary) {
    if (!window.confirm("¿Desconectar " + account.handle + " de Nex?")) return;
    try {
      const response = await fetch("/api/social/instagram/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: account.id }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "No se pudo desconectar la cuenta.");
      setNotice(account.handle + " se desconectó de Nex.");
      await refreshAccounts();
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "No se pudo desconectar la cuenta.");
    }
  }

  const accounts = [
    ...instagramAccounts.map((account) => ({
      id: account.id,
      platform: "Instagram",
      handle: account.handle,
      type: "Cuenta profesional",
      status: account.status === "conectada" ? "Conectada" : "Desconectada",
      note: "Publicaciones y Reels",
    })),
    ...unconnectedAccounts,
  ];

  return <StudioShell active="cuentas">
    <PageIntro title="Cuentas" subtitle="Los destinos que forman parte de tu estudio." />
    <PrototypeNotice>Instagram conecta cuentas profesionales y publica Reels. TikTok y YouTube todavía no están conectados.</PrototypeNotice>
    {notice && <p className="content-feedback" role="status">{notice}</p>}
    {accountError && <p className="content-feedback" role="alert">{accountError}{/unauthorized|inicia sesión/i.test(accountError) && <> — <a href="/login">Iniciar sesión</a></>}</p>}
    <section className="account-overview"><span className="overview-icon"><Icon><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4.6V20" /></Icon></span><div><strong>Destinos sociales</strong><p>Organiza las cuentas donde aparecerá cada pieza.</p></div>{configured ? <a className="primary-button" href="/api/social/instagram/connect"><Icon><path d="M12 5v14M5 12h14" /></Icon><span>Conectar Instagram</span></a> : <button className="primary-button" type="button" disabled><Icon><path d="M12 5v14M5 12h14" /></Icon><span>Configurar Instagram</span></button>}</section>
    {!configured && <p className="content-empty">Añade la app de Meta, su secreto y la clave de cifrado en la configuración de este Worker para activar OAuth.</p>}
    <PageSection title="Canales del estudio" detail="Una misma pieza puede preparar contenido para varios destinos.">
      <ul className="account-list">
        {accounts.map((account, index) => <li className="account-row" key={`${account.platform}-${account.handle}`}><div className={`account-social account-social-${account.platform.toLowerCase()}`}><SocialIcon platform={account.platform} /></div><div className="account-identity"><strong>{account.handle}</strong><span>{account.platform} · {account.type}</span></div><div className="account-purpose">{account.note}</div><span className={`account-status${index === 3 ? " account-status-muted" : ""}`}><i />{account.status}</span><button className="icon-button" type="button" disabled aria-label={`Opciones de ${account.handle}`}><Icon><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Icon></button></li>)}
      </ul>
    </PageSection>
    {instagramAccounts.filter((account) => account.status === "conectada").map((account) => <div className="account-disconnect-row" key={account.id}><span>Token cifrado en D1 · autorización hasta {account.token_expires_at ? new Date(account.token_expires_at).toLocaleDateString("es-EC") : "sin fecha"}</span><button className="quiet-button" type="button" onClick={() => void disconnectInstagram(account)}>Desconectar {account.handle}</button></div>)}
    <div className="permission-note"><Icon><path d="M12 3 4 6v5c0 5 3.4 8 8 10 4.6-2 8-5 8-10V6z" /><path d="M9 12h6M12 9v6" /></Icon><p><strong>Permisos solicitados</strong><span>Instagram básico y publicación de contenido para leer la cuenta y publicar Reels cuando lo confirmes.</span></p></div>
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
