import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../lib/auth";
import { getDb } from "../lib/db";
import { parseScopes } from "../lib/mcp";
import { authorizeErrorPage, consentPage, createAuthorizationCode, publicOrigin, readAuthorizeRequest, redirectWith } from "../lib/oauth";

async function emailOf(userId: string) {
  return (await getDb().prepare("SELECT email FROM users WHERE id = ?").bind(userId).first<{ email: string }>())?.email ?? "tu cuenta";
}

export const Route = createFileRoute("/oauth/authorize")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = publicOrigin(request);
        const parsed = await readAuthorizeRequest(url.searchParams, origin);
        if (!parsed.ok) return authorizeErrorPage(parsed.message);
        const session = await getCurrentSession();
        if (!session) {
          return Response.redirect(new URL("/login?next=" + encodeURIComponent(url.pathname + url.search), url.origin).toString(), 302);
        }
        return consentPage(parsed.request, url.searchParams, await emailOf(session.userId));
      },
      POST: async ({ request }) => {
        // La cookie de sesión es SameSite=Lax, así que un formulario de otro sitio no la lleva; además exigimos el mismo origen.
        const origin = request.headers.get("origin");
        if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) {
          return authorizeErrorPage("La solicitud no vino de Nex.");
        }
        const session = await getCurrentSession();
        if (!session) return authorizeErrorPage("Tu sesión venció. Vuelve a empezar desde la aplicación.");
        const form = new URLSearchParams(await request.text());
        const parsed = await readAuthorizeRequest(form, publicOrigin(request));
        if (!parsed.ok) return authorizeErrorPage(parsed.message);
        if (form.get("decision") !== "approve") {
          return Response.redirect(redirectWith(parsed.request, { error: "access_denied" }), 303);
        }
        const granted = parseScopes(form.getAll("grant").join(" ")).filter((scope) => parsed.request.requestedScopes.includes(scope));
        if (granted.length === 0) return authorizeErrorPage("Elige al menos un permiso o cancela la conexión.");
        return Response.redirect(await createAuthorizationCode(session.userId, parsed.request, granted), 303);
      },
    },
  },
});
