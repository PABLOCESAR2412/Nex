import { Fragment, type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { logoutFn } from "../lib/auth";
import { listMcpTokensFn, revokeMcpTokenFn, type McpTokenSummary } from "../lib/mcp";
import { listMcpOAuthGrantsFn, revokeMcpOAuthGrantFn, type McpOAuthGrantSummary } from "../lib/mcp-oauth-client";
import { createHermesInstallLink } from "../lib/mcp-oauth-protocol";
import { SessionShellSkeleton, SkeletonRows } from "./loading-skeletons";
import { useStudioSession } from "./studio-session";

type ViewKey = "inicio" | "calendario" | "biblioteca" | "cuentas" | "despliegues" | "ajustes";
type Theme = "dark" | "light";

const navigation: Array<{ key: ViewKey; label: string; href: string; icon: ReactNode }> = [
  { key: "inicio", label: "Inicio", href: "/", icon: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /> },
  { key: "calendario", label: "Calendario", href: "/calendario", icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></> },
  { key: "biblioteca", label: "Biblioteca", href: "/biblioteca", icon: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5z" /><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20M8 7h8M8 10h6" /></> },
  { key: "cuentas", label: "Cuentas", href: "/cuentas", icon: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M8 20v-2a4 4 0 0 1 8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /></> },
  { key: "despliegues", label: "Despliegues", href: "/despliegues", icon: <><path d="M12 20s7-4 7-11V5l-7-3-7 3v4c0 7 7 11 7 11Z" /><path d="m9 12 2 2 4-5" /></> },
  { key: "ajustes", label: "Ajustes", href: "/ajustes", icon: <><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.8-.6a8 8 0 0 1-1.5.9l-.4 1.9h-2.8l-.4-1.9a8 8 0 0 1-1.5-.9l-1.8.6-1.4-2.4 1.4-1.1a7.4 7.4 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.8.6a8 8 0 0 1 1.5-.9l.4-1.9h2.8l.4 1.9a8 8 0 0 1 1.5.9l1.8-.6 1.4 2.4-1.4 1.1a7.4 7.4 0 0 1 0 1.7Z" transform="translate(-2 -2)" /></> },
];

function formatMcpScopes(scopes: string) {
  const labels: Record<string, string> = {
    "nex:read": "Consultar datos",
    "nex:write": "Crear y programar contenido",
    "nex:publish": "Publicar en Instagram",
    offline_access: "Mantener sesión activa",
  };
  return scopes.split(/\s+/).filter(Boolean).map((scope) => labels[scope] ?? scope).join(", ");
}

function McpConnectionDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const [tokens, setTokens] = useState<McpTokenSummary[]>([]);
  const [oauthGrants, setOAuthGrants] = useState<McpOAuthGrantSummary[]>([]);
  const [installLink, setInstallLink] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [endpointCopied, setEndpointCopied] = useState(false);

  async function refresh() {
    const [legacyTokens, grants] = await Promise.all([listMcpTokensFn(), listMcpOAuthGrantsFn()]);
    setTokens(legacyTokens);
    setOAuthGrants(grants);
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([listMcpTokensFn(), listMcpOAuthGrantsFn()])
      .then(([legacyTokens, grants]) => {
        if (cancelled) return;
        setTokens(legacyTokens);
        setOAuthGrants(grants);
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudieron cargar las conexiones MCP."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try {
      const endpoint = new URL("/api/mcp", window.location.origin).toString();
      setMcpUrl(endpoint);
      setInstallLink(createHermesInstallLink(endpoint));
    } catch {
      setError("No se pudo preparar el enlace seguro para Hermes.");
    }
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? []);
    focusable()[0]?.focus();
    function keepFocus(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", keepFocus);
    return () => document.removeEventListener("keydown", keepFocus);
  }, [onClose]);

  async function revoke(token: McpTokenSummary) {
    if (!window.confirm(`¿Revocar la conexión “${token.label}”? Hermes dejará de tener acceso.`)) return;
    setBusy(true);
    setError(null);
    try {
      await revokeMcpTokenFn({ data: { id: token.id } });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo revocar la conexión.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeOAuthGrant(grant: McpOAuthGrantSummary) {
    if (!window.confirm(`¿Revocar el acceso de “${grant.client_name}” a Nex?`)) return;
    setBusy(true);
    setError(null);
    try {
      await revokeMcpOAuthGrantFn({ data: { id: grant.id } });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo revocar el acceso OAuth.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInstallLink() {
    try {
      await navigator.clipboard.writeText(installLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("No se pudo copiar el enlace. Usa el botón para abrir Hermes.");
    }
  }

  async function copyMcpUrl() {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setEndpointCopied(true);
      window.setTimeout(() => setEndpointCopied(false), 2000);
    } catch {
      setError("No se pudo copiar la dirección MCP.");
    }
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="mcp-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-dialog-title">
      <div className="mcp-dialog-heading"><div><h2 id="mcp-dialog-title">Conectar asistentes con Nex</h2><p>Conecta Hermes o cualquier cliente compatible con MCP y autoriza cada cuenta Nex con OAuth.</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar"><Icon><path d="m6 6 12 12M18 6 6 18" /></Icon></button></div>
      {error && <p className="content-feedback" role="alert">{error}</p>}
      <div className="mcp-existing-keys">
        <div className="mcp-connect-notes"><strong>Autorización OAuth</strong><p>Cada asistente se registra con PKCE. Nex muestra los permisos solicitados y almacena solo hashes de los tokens; no tienes que copiar claves privadas.</p></div>
        <div className="content-row-actions">
          <a className={`primary-button${installLink ? "" : " disabled"}`} href={installLink || undefined} aria-disabled={!installLink}>Añadir Nex a Hermes</a>
          <button className="quiet-button" type="button" onClick={() => void copyInstallLink()} disabled={!installLink}>{copied ? "Enlace copiado" : "Copiar enlace de Hermes"}</button>
        </div>
        <section className="mcp-client-guide" aria-labelledby="mcp-chatgpt-title">
          <h3 id="mcp-chatgpt-title">ChatGPT</h3>
          <p>En ChatGPT web, abre Ajustes → Apps o Plugins → Añadir servidor MCP personalizado. Pega esta dirección, selecciona OAuth y después inicia sesión en Nex y acepta los permisos.</p>
          <div className="mcp-endpoint-copy"><code>{mcpUrl || "Preparando dirección segura…"}</code><button className="quiet-button" type="button" onClick={() => void copyMcpUrl()} disabled={!mcpUrl}>{endpointCopied ? "Copiada" : "Copiar dirección"}</button></div>
          <p className="mcp-plan-note">ChatGPT requiere Business, Enterprise o Edu para usar acciones de escritura; Pro permite conectar solo herramientas de lectura.</p>
        </section>
        {loading ? <SkeletonRows count={2} label="Cargando autorizaciones" variant="compact" /> : <>
          <section className="mcp-existing-keys" aria-labelledby="mcp-oauth-connections-title">
            <h3 id="mcp-oauth-connections-title">Autorizaciones activas</h3>
            {oauthGrants.length === 0 ? <p>Una sesión aparece aquí después de que Hermes o ChatGPT inicie sesión en Nex y aceptes los permisos. Luego puedes revisar el acceso o revocarlo.</p> : oauthGrants.map((grant) => <div className="mcp-key-row" key={grant.id}><div><strong>{grant.client_name}</strong><small>Permisos: {formatMcpScopes(grant.scopes)} · Creada {new Date(grant.created_at.replace(" ", "T") + (grant.created_at.endsWith("Z") ? "" : "Z")).toLocaleDateString("es-EC")} · {grant.last_used_at ? `Último uso ${new Date(grant.last_used_at.replace(" ", "T") + (grant.last_used_at.endsWith("Z") ? "" : "Z")).toLocaleString("es-EC")}` : "Sin uso registrado todavía"}</small></div><button className="quiet-button" type="button" disabled={busy} onClick={() => void revokeOAuthGrant(grant)}>Revocar</button></div>)}
          </section>
          {tokens.length > 0 && <section className="mcp-existing-keys" aria-labelledby="mcp-legacy-connections-title"><h3 id="mcp-legacy-connections-title">Claves Bearer antiguas (no OAuth)</h3><p>Son claves fijas del método anterior, separadas de tus cuentas de Instagram. Mientras aparezcan aquí, siguen activas; pulsa Revocar para deshabilitarlas. “Sin uso registrado” significa que Nex no recibió llamadas con esa clave.</p>{tokens.map((token) => <div className="mcp-key-row" key={token.id}><div><strong>{token.label}</strong><small>Creada {new Date(token.created_at.replace(" ", "T") + (token.created_at.endsWith("Z") ? "" : "Z")).toLocaleDateString("es-EC")} · {token.last_used_at ? `Último uso ${new Date(token.last_used_at.replace(" ", "T") + (token.last_used_at.endsWith("Z") ? "" : "Z")).toLocaleString("es-EC")}` : "Sin uso registrado"}</small></div><button className="quiet-button" type="button" disabled={busy} onClick={() => void revoke(token)}>Revocar</button></div>)}</section>}
        </>}
      </div>
      <button className="quiet-button mcp-close" type="button" onClick={onClose}>Cerrar</button>
    </section>
  </div>;
}

export function StudioShell({ active, children }: { active: ViewKey; children: ReactNode }) {
  const { user, checked } = useStudioSession();
  const [theme, setTheme] = useState<Theme>("dark");
  const [search, setSearch] = useState("");
  const [showMcp, setShowMcp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("nex-theme");
    const nextTheme: Theme = saved === "light" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get("q");
    if (query) setSearch(query);
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  function changeTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("nex-theme", nextTheme);
  }

  function searchContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = search.trim();
    window.location.assign(query ? `/biblioteca?q=${encodeURIComponent(query)}` : "/biblioteca");
  }

  async function handleLogout() {
    try { await logoutFn(); } catch {}
    window.location.replace("/login");
  }

  if (!checked || !user) return <SessionShellSkeleton />;

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Navegación principal">
      <Link className="brand" to="/" aria-label="Nex, inicio">
        <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><path d="M9 30 30 9M11 10l19 20M8 20h24" /><circle cx="9" cy="30" r="2.2" /><circle cx="30" cy="9" r="2.2" /><circle cx="30" cy="30" r="2.2" /></svg>
        <span>Nex</span>
      </Link>

      <nav className="primary-nav">
        <p className="nav-label">Espacio</p>
        {navigation.map((item, index) => <Fragment key={item.key}>
          {index === 5 && <p className="nav-label nav-label-spaced">Preferencias</p>}
          <Link to={item.href} className="nav-link" activeProps={{ className: "nav-link active" }} activeOptions={{ exact: true }} aria-label={item.label} title={item.label}>
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{item.icon}</svg>
            <span>{item.label}</span>
          </Link>
        </Fragment>)}
      </nav>

      <div className="sidebar-bottom">
        <div className="user-profile">
          <span className="avatar">{(user.name?.trim()[0] ?? user.email[0] ?? "N").toUpperCase()}</span>
          <span className="user-profile-copy"><strong>{user.name || user.email.split("@")[0]}</strong><small><i />Sesión activa · {user.email}</small></span>
          <button className="profile-logout" type="button" onClick={() => void handleLogout()} title="Cerrar sesión" aria-label="Cerrar sesión"><Icon><path d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-5" /></Icon></button>
        </div>
      </div>
    </aside>

    <main className="main-panel">
      <header className="topbar">
        <div className="breadcrumb"><span>Mi estudio</span><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg><span className="breadcrumb-current">{navigation.find((item) => item.key === active)?.label}</span></div>
        <div className="topbar-actions">
          <form className="search-box" role="search" onSubmit={searchContent}>
            <Icon><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></Icon>
            <input ref={searchRef} aria-label="Buscar en la biblioteca" placeholder="Buscar piezas, videos…" value={search} onChange={(event) => setSearch(event.target.value)} />
            <kbd>Ctrl K</kbd>
          </form>
          <button className="topbar-action-button" type="button" onClick={() => setShowMcp(true)} aria-label="Conectar Hermes con Nex"><Icon><circle cx="8" cy="8" r="3" /><circle cx="16" cy="16" r="3" /><path d="m10 10 4 4M19 5h2v2M3 17v2h2" /></Icon><span>Conectar MCP</span></button>
          <button className="icon-button theme-toggle" type="button" onClick={changeTheme} aria-label={`Cambiar a modo ${theme === "dark" ? "claro" : "oscuro"}`} title={`Modo ${theme === "dark" ? "claro" : "oscuro"}`}>
            {theme === "dark" ? <Icon><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></Icon> : <Icon><path d="M20.5 15.5A8.5 8.5 0 0 1 8.5 3.5 8.5 8.5 0 1 0 20.5 15.5Z" /></Icon>}
          </button>
        </div>
      </header>
      <div className="content-wrap">{children}</div>
    </main>
    {showMcp && <McpConnectionDialog onClose={() => setShowMcp(false)} />}
  </div>;
}

export function PageIntro({ title, subtitle, note }: { title: string; subtitle: string; note?: string }) {
  return (
    <section className="page-intro" aria-labelledby="page-title">
      <div><h1 id="page-title">{title}</h1><p className="welcome-subtitle">{subtitle}</p></div>
      {note && <span className="sample-note-inline">{note}</span>}
    </section>
  );
}

export function Icon({ children, className = "icon" }: { children: ReactNode; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
}

export function PrototypeNotice({ children }: { children: string }) {
  return <p className="prototype-notice"><span className="status-dot" />{children}</p>;
}
