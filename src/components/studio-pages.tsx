import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Icon, PageIntro, PrototypeNotice, StudioShell } from "./studio-shell";
import { SkeletonRows } from "./loading-skeletons";
import { CONTENT_STATES, type ContentItem, type ContentState, createContentFn, deleteContentFn, listContentFn, updateContentFn } from "../lib/content";
import { listSocialAccountsFn, type SocialAccountSummary, type SocialPlatform } from "../lib/social";
import { listRegisteredUsersFn, type RegisteredUsersResult } from "../lib/user-admin-client";

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

function formatRegisteredAt(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" });
}

function RegisteredUsersSection() {
  const [directory, setDirectory] = useState<RegisteredUsersResult | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listRegisteredUsersFn()
      .then((result) => { if (!cancelled) setDirectory(result); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  return <PageSection title="Usuarios registrados" detail="Directorio de solo lectura; el acceso está restringido a administradores.">
    {error ? <p className="content-feedback" role="alert">No se pudo cargar el directorio de usuarios.</p>
      : !directory ? <SkeletonRows count={3} label="Cargando usuarios registrados" variant="compact" />
        : directory.status === "not_configured" ? <p className="settings-hint">Vista protegida y aún sin administrador configurado. Define <code>NEX_ADMIN_EMAILS</code> en las variables del Worker con el correo de inicio de sesión autorizado; admite varios correos separados por comas.</p>
          : directory.status === "forbidden" ? <p className="content-empty">Esta cuenta no tiene permiso para consultar el directorio.</p>
            : <>
              <div className="users-directory-summary"><strong>{directory.total.toLocaleString("es-EC")}</strong><span>cuentas registradas</span></div>
              {directory.users.length === 0 ? <p className="content-empty">Aún no hay usuarios registrados.</p> : <div className="users-table-wrap">
                <table className="users-table">
                  <thead><tr><th>Nombre</th><th>Correo</th><th>Registro</th><th>Sesiones activas</th></tr></thead>
                  <tbody>{directory.users.map((user) => <tr key={user.email}>
                    <td>{user.name?.trim() || "Sin nombre"}</td><td>{user.email}</td><td>{formatRegisteredAt(user.created_at)}</td><td>{user.active_sessions}</td>
                  </tr>)}</tbody>
                </table>
              </div>}
              {directory.truncated && <p className="settings-hint">Se muestran hasta 500 cuentas. Hay {directory.total.toLocaleString("es-EC")} en total.</p>}
            </>}
  </PageSection>;
}

export function CalendarPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listContentFn()
      .then((result) => { if (!cancelled) setItems(result); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "No se pudo cargar el calendario."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const gridStart = mondayOf(monthStart);
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const dayOffset = (monthStart.getDay() + 6) % 7;
  const cellCount = Math.max(35, Math.ceil((dayOffset + daysInMonth) / 7) * 7);
  const days = Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(date.getDate() + index);
    const key = dateKey(date);
    const events = items
      .filter((item) => item.scheduled_at && dateKey(new Date(item.scheduled_at)) === key)
      .sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));
    return { date, key, events };
  });
  const monthLabel = monthStart.toLocaleDateString("es-EC", { month: "long", year: "numeric" });
  const scheduled = items.filter((item) => item.scheduled_at).sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));

  return <StudioShell active="calendario">
    <PageIntro title="Calendario" subtitle="Cada pieza en su momento, cada canal en su ritmo." />
    <PrototypeNotice>Las fechas y publicaciones programadas se cargan desde tu biblioteca.</PrototypeNotice>
    {error && <p className="content-feedback" role="alert">{error}</p>}
    <section className="schedule-toolbar" aria-label="Controles del calendario">
      <div className="view-switch" aria-label="Vista mensual seleccionada"><span className="selected">Mes</span></div>
      <div className="week-controls">
        <button className="icon-button" type="button" onClick={() => setMonthOffset((value) => value - 1)} aria-label="Mes anterior"><Icon><path d="m15 18-6-6 6-6" /></Icon></button>
        <strong>{monthLabel}</strong>
        <button className="icon-button" type="button" onClick={() => setMonthOffset((value) => value + 1)} aria-label="Mes siguiente"><Icon><path d="m9 18 6-6-6-6" /></Icon></button>
      </div>
      <button className="quiet-button" type="button" onClick={() => setMonthOffset(0)}>Hoy</button>
    </section>
    <div className="calendar-scroller month-calendar-scroller">
      <div className="month-weekdays" aria-hidden="true">{["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => <span key={day}>{day}</span>)}</div>
      <ol className="month-grid" aria-label={`Calendario mensual de ${monthLabel}`}>
        {days.map(({ date, key, events }) => <li className={`month-day${date.getMonth() !== monthStart.getMonth() ? " outside-month" : ""}${key === dateKey(today) ? " is-today" : ""}`} key={key}>
          <span className="month-day-number">{date.getDate()}{key === dateKey(today) && <small>Hoy</small>}</span>
          <div className="month-day-events">{events.slice(0, 3).map((item) => {
            const channel = item.channels?.split(/[·,]/)[0]?.trim() ?? "";
            const time = new Date(item.scheduled_at!).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
            return <div className={`calendar-event month-event ${channel ? `event-${channel.toLowerCase()}` : ""}`} key={item.id} title={`${time} · ${item.title}`}>
              <span><b>{time}</b>{item.title}</span>
            </div>;
          })}{events.length > 3 && <span className="month-more">+{events.length - 3} más</span>}</div>
        </li>)}
      </ol>
    </div>
    <PageSection title="Publicaciones programadas" detail="El calendario organiza las fechas; la publicación en Instagram se confirma desde la biblioteca.">
      {loading ? <SkeletonRows count={3} label="Cargando publicaciones programadas" variant="compact" /> : scheduled.length === 0 ? <p className="content-empty">Todavía no hay piezas programadas. Añade una fecha desde la biblioteca.</p> : <ul className="schedule-list">
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

function accountLabel(account: SocialAccountSummary, accounts: SocialAccountSummary[]) {
  const duplicate = accounts.some((other) => other.id !== account.id && other.platform === account.platform && other.handle === account.handle);
  return duplicate ? `${account.handle} · ${account.id.slice(-6)}` : account.handle;
}

type PublicationResult = { jobId?: string; status?: string; error?: string; caption?: string };

function ContentEditor({ item, accounts, onChanged, onDeleted }: { item: ContentItem; accounts: SocialAccountSummary[]; onChanged: () => Promise<void>; onDeleted: (assetCleanupPending: boolean) => Promise<void> }) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? "");
  const [script, setScript] = useState(item.script ?? "");
  const [channels, setChannels] = useState(item.channels ?? "");
  const [state, setState] = useState<ContentState>(CONTENT_STATES.includes(item.state as ContentState) ? item.state as ContentState : "borrador");
  const [scheduledAt, setScheduledAt] = useState(toDateTimeInput(item.scheduled_at));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishAccountId, setPublishAccountId] = useState("");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [tiktokCaption, setTikTokCaption] = useState<string | null>(null);
  const validAccounts = accounts.filter((account) => account.platform === "TikTok"
    ? ["video/mp4", "video/quicktime", "video/webm"].includes(item.asset_content_type ?? "")
    : ["video/mp4", "video/quicktime"].includes(item.asset_content_type ?? ""));
  const selectedAccount = validAccounts.find((account) => account.id === publishAccountId)
    ?? (validAccounts.length === 1 ? validAccounts[0] : undefined);
  const [publicationJobs, setPublicationJobs] = useState<Record<string, string>>({});

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

  async function publishVideo() {
    const account = selectedAccount;
    if (!account) return;
    const knownJob = publicationJobs[account.id];
    const isTikTok = account.platform === "TikTok";
    if (!knownJob && (title !== item.title || description !== (item.description ?? ""))) {
      setMessage("Guarda el título y la descripción antes de enviar el video.");
      return;
    }
    const destination = `${accountLabel(account, accounts)} en ${account.platform}`;
    const action = isTikTok ? "Enviar a la bandeja de" : "Publicar como Reel para";
    if (!knownJob && !window.confirm(`¿${action} ${destination} el video “${item.title}”?`)) return;
    setMessage(null);
    setTikTokCaption(null);
    setPublishing(true);
    try {
      const endpoint = isTikTok ? "/api/social/tiktok/upload" : "/api/social/instagram/publish";
      async function requestPublication(body: object) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json() as PublicationResult;
        if (!response.ok || !result.jobId) throw new Error(result.error ?? `No se pudo consultar ${account!.platform}.`);
        return result;
      }
      let result = await requestPublication(knownJob
        ? { action: "check", jobId: knownJob }
        : { action: "start", contentId: item.id, accountId: account.id });
      const jobId = result.jobId!;
      setPublicationJobs((jobs) => ({ ...jobs, [account.id]: jobId }));

      for (let attempt = 0; attempt <= 24; attempt++) {
        if (result.status === "published") {
          setState("publicada");
          await onChanged();
          setMessage(`Video publicado para ${destination}.`);
          return;
        }
        if (result.status === "awaiting_user") {
          setTikTokCaption(result.caption ?? null);
          setMessage(`Video en la bandeja de ${destination}. Abre la notificación, revisa el texto y publica desde TikTok.`);
          return;
        }
        if (result.status === "failed") setPublicationJobs(({ [account.id]: _, ...jobs }) => jobs);
        if (result.status === "failed" || result.status === "needs_review") {
          throw new Error(result.error ?? `${account.platform} no pudo completar el envío.`);
        }
        if (attempt === 24) break;
        setMessage(`${account.platform} está procesando el video…`);
        await new Promise((resolve) => setTimeout(resolve, isTikTok ? 4000 : 2500));
        result = await requestPublication({ action: "check", jobId });
      }
      setMessage(`El video sigue procesándose en ${account.platform}. Puedes consultar su estado.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo enviar el video.");
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
          {["aprobada", "publicada"].includes(item.state) && validAccounts.length > 0 && <div className="publish-social-control">
            <label>Cuenta de destino<select value={selectedAccount?.id ?? ""} onChange={(e) => { setPublishAccountId(e.target.value); setTikTokCaption(null); setMessage(null); }} disabled={publishing}>
              {validAccounts.length > 1 && <option value="">Selecciona una cuenta</option>}
              {validAccounts.map((account) => <option key={account.id} value={account.id}>{account.platform} · {accountLabel(account, accounts)}</option>)}
            </select></label>
            <button className="quiet-button" type="button" disabled={!selectedAccount || saving || uploading || publishing} onClick={() => void publishVideo()}>{publishing ? "Procesando…" : selectedAccount && publicationJobs[selectedAccount.id] ? "Consultar estado" : selectedAccount?.platform === "TikTok" ? "Enviar a TikTok" : selectedAccount ? "Publicar Reel" : "Enviar video"}</button>
          </div>}
          <button className="quiet-button delete-content-button" type="button" disabled={saving || uploading || publishing} onClick={() => void remove()}>Eliminar pieza</button>
        </div>
      </form>
      {uploading && <div className="upload-progress" role="status"><progress value={progress} max={100} />Subiendo archivo… {progress}%</div>}
      {message && <p className="content-feedback" role="status">{message}</p>}
      {tiktokCaption && <label className="content-edit-form content-description">Texto para TikTok<textarea readOnly rows={3} value={tiktokCaption} /></label>}
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
  const [socialAccounts, setSocialAccounts] = useState<SocialAccountSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

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
    listSocialAccountsFn()
      .then((result) => { if (!cancelled) setSocialAccounts(result.accounts.filter((account) => account.status === "conectada")); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setSearchQuery(new URLSearchParams(window.location.search).get("q")?.trim() ?? "");
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

  const visibleItems = searchQuery
    ? items.filter((item) => `${item.title} ${item.description ?? ""} ${item.script ?? ""} ${item.channels ?? ""} ${item.asset_name ?? ""}`.toLocaleLowerCase().includes(searchQuery.toLocaleLowerCase()))
    : items;

  return <StudioShell active="biblioteca">
    <PageIntro title="Biblioteca" subtitle="Videos, guiones y referencias de tu estudio." />
    {!loading && socialAccounts.length === 0 && <p className="content-feedback">Conecta Instagram o TikTok desde <a href="/cuentas">Cuentas</a> para enviar tus videos.</p>}
    {error && <p className="prototype-notice" role="alert">{error}</p>}
    <form className="library-toolbar" onSubmit={handleCreate}>
      <div className="library-search"><Icon><path d="M12 5v14M5 12h14" /></Icon><input aria-label="Título de la nueva pieza" placeholder="Título de la nueva pieza" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required /></div>
      <div className="library-search"><input aria-label="Canales previstos" placeholder="Canales previstos · Instagram, TikTok…" value={channels} onChange={(e) => setChannels(e.target.value)} maxLength={200} /></div>
      <button className="primary-button" type="submit" disabled={creating || !title.trim()}><Icon><path d="M12 5v14M5 12h14" /></Icon><span>{creating ? "Creando…" : "Añadir pieza"}</span></button>
    </form>
    <PageSection title={searchQuery ? "Resultados de búsqueda" : "Material reciente"} detail={searchQuery ? `Coincidencias para “${searchQuery}”.` : "Ordenado por última actividad."}>
      {loading ? <SkeletonRows count={3} label="Cargando biblioteca" /> : (
        <ul className="library-list">
          {items.length === 0 && <li className="content-empty">Todavía no hay piezas. Crea una arriba para guardar su guion, archivo y fecha.</li>}
          {items.length > 0 && visibleItems.length === 0 && <li className="content-empty">No encontramos piezas que coincidan con esa búsqueda.</li>}
          {visibleItems.map((item) => <ContentEditor key={item.id} item={item} accounts={socialAccounts} onChanged={refresh} onDeleted={async (cleanupPending) => { await refresh(); if (cleanupPending) setError("La pieza se eliminó; no se pudo borrar su archivo de R2."); }} />)}
        </ul>
      )}
    </PageSection>
    <div className="library-footnote"><span>{searchQuery ? visibleItems.length : items.length} piezas{searchQuery ? " encontradas" : ""}</span><span>Tu biblioteca · archivos privados.</span></div>
  </StudioShell>;
}

export function AccountsPage() {
  const [connections, setConnections] = useState<Awaited<ReturnType<typeof listSocialAccountsFn>> | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const platforms: SocialPlatform[] = ["Instagram", "TikTok"];

  useEffect(() => {
    let cancelled = false;
    listSocialAccountsFn()
      .then((result) => { if (!cancelled) setConnections(result); })
      .catch(() => { if (!cancelled) setAccountError("No se pudieron cargar las cuentas. Recarga la página para reintentar."); });

    const url = new URL(window.location.href);
    const platform = url.searchParams.has("instagram") ? "Instagram" : url.searchParams.has("tiktok") ? "TikTok" : null;
    if (platform) {
      const provider = platform.toLowerCase();
      const messages: Record<string, string> = {
        connected: `Cuenta de ${platform} conectada. Si querías añadir otro perfil, cambia de cuenta en ${platform} y vuelve a intentarlo.`,
        reconnected: `Se renovó la conexión con ${platform}. Para añadir otro perfil, cambia de cuenta en ${platform}.`,
        denied: `Se canceló la conexión con ${platform}.`,
        config: `Falta configurar la conexión con ${platform}.`,
        expired: `La conexión con ${platform} venció. Vuelve a intentarlo.`,
        invalid: `No se pudo validar la conexión con ${platform}. Iníciala otra vez desde Cuentas.`,
        token_error: "Instagram no completó la autorización. Comprueba los permisos y vuelve a conectar la cuenta.",
        profile_error: "Instagram no devolvió un perfil profesional. Comprueba la cuenta elegida.",
      };
      const status = url.searchParams.get(provider) ?? "";
      const message = Object.hasOwn(messages, status) ? messages[status] : `No se pudo conectar ${platform}. Comprueba la autorización del perfil y vuelve a intentarlo.`;
      setNotice(message);
      url.searchParams.delete(provider);
      window.history.replaceState(window.history.state, "", url);
    }
    return () => { cancelled = true; };
  }, []);

  async function disconnectAccount(account: SocialAccountSummary, label: string) {
    if (!window.confirm(`¿Desconectar ${label} de ${account.platform}?`)) return;
    setDisconnecting(account.id);
    setAccountError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/social/${account.platform.toLowerCase()}/disconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: account.id }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "No se pudo desconectar la cuenta.");
      setConnections((current) => current && {
        ...current,
        accounts: current.accounts.map((row) => row.id === account.id ? { ...row, status: "desconectada", token_expires_at: null } : row),
      });
      setNotice(`${label} se desconectó de ${account.platform} en Nex.`);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "No se pudo desconectar la cuenta.");
    } finally {
      setDisconnecting(null);
    }
  }

  return <StudioShell active="cuentas">
    <PageIntro title="Cuentas" subtitle="Conecta cada perfil donde quieres compartir tus videos." />
    {notice && <p className="content-feedback" role="status">{notice}</p>}
    {accountError && <p className="content-feedback" role="alert">{accountError}</p>}
    {!connections && !accountError && <SkeletonRows count={2} label="Cargando cuentas conectadas" variant="compact" />}
    {connections && platforms.map((platform) => {
      const provider = platform.toLowerCase();
      const instagram = platform === "Instagram";
      const accounts = connections.accounts.filter((account) => account.platform === platform);
      const endpoint = `/api/social/${provider}/connect`;
      const action = accounts.length ? "Añadir cuenta" : `Conectar ${platform}`;
      return <section key={platform} aria-label={`Cuentas de ${platform}`}>
        <div className="account-overview">
          <span className="overview-icon"><SocialIcon platform={platform} /></span>
          <div>
            <strong>{platform}</strong>
            <p>{instagram ? "Publica Reels en cuentas profesionales." : "Envía videos a la bandeja para completarlos en TikTok."}</p>
            {connections.configured[platform] && accounts.length > 0 && <p>Para añadir otro perfil, cambia de cuenta en {platform} y pulsa Añadir cuenta.</p>}
          </div>
          {connections.configured[platform] && <a className="primary-button" href={endpoint} aria-label={accounts.length ? `Añadir cuenta de ${platform}` : action}>
            <Icon><path d="M12 5v14M5 12h14" /></Icon><span>{action}</span>
          </a>}
        </div>
        {!connections.configured[platform] && <div className="social-config-note">
          <strong>Configuración pendiente</strong>
          <p>{instagram ? "Configura Instagram Login en Meta Developers para poder añadir perfiles profesionales." : "Configura Login Kit y el permiso de carga de video en TikTok for Developers para poder añadir perfiles."}</p>
        </div>}
        {accounts.length === 0 ? <p className="content-empty">Aún no hay cuentas de {platform} conectadas.</p> : <ul className="account-list">
          {accounts.map((account) => {
            const label = accountLabel(account, accounts);
            const connected = account.status === "conectada";
            const expired = instagram && !!account.token_expires_at && Date.parse(account.token_expires_at) <= Date.now();
            const status = !connected ? "Desconectada" : expired ? "Autorización vencida" : "Conectada";
            return <li key={account.id}>
              <div className="account-row">
                <div className={`account-social account-social-${provider}`}><SocialIcon platform={platform} /></div>
                <div className="account-identity"><strong title={label}>{label}</strong><span>{instagram ? "Cuenta profesional" : "Cuenta de TikTok"}</span></div>
                <div className="account-purpose">{instagram ? "Reels" : "Borradores de video"}</div>
                <span className={`account-status${!connected || expired ? " account-status-muted" : ""}`}><i />{status}</span>
              </div>
              {(connected || connections.configured[platform]) && <div className="account-disconnect-row">
                {connections.configured[platform] && (!connected || expired) && <a href={endpoint} className="quiet-button" aria-label={`Volver a conectar ${label} en ${platform}`}>Volver a conectar</a>}
                {connected && <button className="quiet-button" type="button" disabled={disconnecting !== null} onClick={() => void disconnectAccount(account, label)}>{disconnecting === account.id ? "Desconectando…" : `Desconectar ${label}`}</button>}
              </div>}
            </li>;
          })}
        </ul>}
      </section>;
    })}
  </StudioShell>;
}

export function DeploymentsPage() {
  return <StudioShell active="despliegues">
    <PageIntro title="Despliegues" subtitle="Esta sección queda pendiente para otra etapa." />
    <section className="deferred-panel"><span className="aside-orbit"><Icon><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" /></Icon></span><h2>Lo veremos más adelante</h2><p>Por ahora Nex se enfoca en organizar el contenido y conectar tus redes sociales. Aquí aparecerán datos reales cuando activemos esta parte.</p><Link className="primary-button" to="/cuentas">Ir a cuentas sociales</Link></section>
  </StudioShell>;
}

export function SettingsPage() {
  return <StudioShell active="ajustes">
    <PageIntro title="Ajustes" subtitle="Opciones de conexión y apariencia de tu estudio." />
    <PageSection title="Apariencia" detail="El modo oscuro se abre por defecto. Puedes cambiarlo desde el botón de tema en la barra superior.">
      <p className="settings-hint">La preferencia de tema se guarda en este navegador.</p>
    </PageSection>
    <PageSection title="Redes sociales" detail="Administra tus conexiones de Instagram y TikTok.">
      <Link className="primary-button" to="/cuentas">Gestionar cuentas</Link>
    </PageSection>
    <RegisteredUsersSection />
  </StudioShell>;
}
