import { useState } from "react";
import { useStudioSession } from "./studio-session";
import { changePasswordFn, logoutFn } from "../lib/auth";
import { safeInternalDestination } from "../lib/safe-next";

export function PasswordChangePage() {
  const { user, checked } = useStudioSession();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mustChange = user?.password_change_required === true;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    try {
      await changePasswordFn({ data: { newPassword: password } });
      const requestedPath = new URLSearchParams(window.location.search).get("next");
      const destination = safeInternalDestination(requestedPath, window.location.origin);
      window.location.replace(destination === "/password" ? "/" : destination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la contraseña.");
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await logoutFn();
    window.location.replace("/login");
  }

  if (!checked || !user) return <main className="auth-page"><p role="status">Verificando sesión…</p></main>;

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1>{mustChange ? "Crea tu contraseña" : "No hay cambios pendientes"}</h1>
        <p className="auth-subtitle">
          {mustChange
            ? "El acceso temporal es solo para esta entrada. Define una contraseña propia para continuar."
            : "Tu cuenta ya tiene una contraseña personal."}
        </p>
        {mustChange && <>
          <label>
            <span>Nueva contraseña</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" />
          </label>
          <label>
            <span>Confirma la nueva contraseña</span>
            <input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" />
          </label>
        </>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {mustChange
          ? <button className="primary-button" type="submit" disabled={loading}>{loading ? "Guardando…" : "Guardar y continuar"}</button>
          : <button className="primary-button" type="button" onClick={() => window.location.replace("/")}>Ir a Nex</button>}
        <button className="quiet-button" type="button" onClick={() => void signOut()}>Cerrar sesión</button>
      </form>
    </main>
  );
}
