import { useCallback, useEffect, useState } from "react";
import type { ContentItem } from "../lib/content";
import { cancelPublicationFn, listPublicationsFn, schedulePublicationsFn, type PublicationStatus, type PublicationSummary } from "../lib/publications";
import type { SocialAccountSummary } from "../lib/social";

const statusLabels: Record<PublicationStatus, string> = {
  programada: "Programada",
  en_curso: "En curso",
  publicada: "Publicada",
  borrador_enviado: "Borrador enviado",
  fallida: "Falló",
  requiere_revision: "Requiere revisión",
  cancelada: "Cancelada",
};
const OPEN_STATUSES: PublicationStatus[] = ["programada", "en_curso"];
const SCHEDULABLE_STATES = ["aprobada", "programada", "publicada"];

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatWhen(value: string) {
  return new Date(value).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short" });
}

/** Programa una pieza aprobada en una o varias cuentas y muestra el estado de cada publicación. */
export function PublicationsPanel({ item, accounts, onChanged }: { item: ContentItem; accounts: SocialAccountSummary[]; onChanged: () => Promise<void> }) {
  const [publications, setPublications] = useState<PublicationSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [when, setWhen] = useState(toLocalInput(item.scheduled_at));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const all = await listPublicationsFn();
    setPublications(all.filter((publication) => publication.content_id === item.id));
  }, [item.id]);

  useEffect(() => { void reload().catch(() => undefined); }, [reload, item.state]);

  const hasOpen = publications.some((publication) => OPEN_STATUSES.includes(publication.status));
  useEffect(() => {
    if (!hasOpen) return;
    const timer = window.setInterval(() => { void reload().then(onChanged).catch(() => undefined); }, 30_000);
    return () => window.clearInterval(timer);
  }, [hasOpen, reload, onChanged]);

  const isVideo = ["video/mp4", "video/quicktime"].includes(item.asset_content_type ?? "");
  const canSchedule = isVideo && SCHEDULABLE_STATES.includes(item.state) && accounts.length > 0;
  if (!canSchedule && publications.length === 0) return null;

  async function schedule(event: React.FormEvent) {
    event.preventDefault();
    const date = new Date(when);
    if (selected.length === 0 || Number.isNaN(date.getTime())) {
      setMessage("Elige al menos una cuenta y una fecha.");
      return;
    }
    const handles = accounts.filter((account) => selected.includes(account.id)).map((account) => account.platform + " " + account.handle).join(", ");
    if (!window.confirm("¿Programar “" + item.title + "” para " + formatWhen(date.toISOString()) + " en " + handles + "? Nex lo enviará solo a esa hora.")) return;
    setBusy(true);
    setMessage(null);
    try {
      await schedulePublicationsFn({ data: { contentId: item.id, accountIds: selected, scheduledAt: date.toISOString() } });
      await reload();
      await onChanged();
      setSelected([]);
      setMessage("Publicación programada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo programar la publicación.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(publication: PublicationSummary) {
    setBusy(true);
    setMessage(null);
    try {
      await cancelPublicationFn({ data: { id: publication.id } });
      await reload();
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cancelar la publicación.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="publications-panel" aria-label="Publicaciones programadas">
    <h4>Publicaciones</h4>
    {publications.length > 0 && <ul className="publication-list">
      {publications.map((publication) => <li key={publication.id}>
        <span className={"publication-status publication-" + publication.status}>{statusLabels[publication.status] ?? publication.status}</span>
        <span>{publication.platform} {publication.handle}</span>
        <time dateTime={publication.scheduled_at}>{formatWhen(publication.scheduled_at)}</time>
        {publication.error && <small role="alert">{publication.error}</small>}
        {publication.status === "programada" && <button className="quiet-button" type="button" disabled={busy} onClick={() => void cancel(publication)}>Cancelar</button>}
      </li>)}
    </ul>}
    {canSchedule && <form className="publication-form" onSubmit={schedule}>
      <fieldset disabled={busy}>
        <legend>Programar en cuentas</legend>
        {accounts.map((account) => <label key={account.id} className="publication-account">
          <input type="checkbox" checked={selected.includes(account.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, account.id] : current.filter((id) => id !== account.id))} />
          {account.platform} {account.handle}
        </label>)}
        <label className="publication-when">Fecha y hora<input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} required /></label>
        <button className="quiet-button" type="submit">{busy ? "Programando…" : "Programar publicación"}</button>
      </fieldset>
      <p className="publication-hint">La fecha de arriba solo mueve la pieza en el calendario; esta publica de verdad.</p>
    </form>}
    {message && <p className="content-feedback" role="status">{message}</p>}
  </section>;
}
