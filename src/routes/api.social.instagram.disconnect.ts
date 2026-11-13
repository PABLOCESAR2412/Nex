import { createFileRoute } from "@tanstack/react-router";
import { getCurrentSession } from "../lib/auth";
import { getDb } from "../lib/db";

export const Route = createFileRoute("/api/social/instagram/disconnect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getCurrentSession();
        if (!session) return Response.json({ error: "Inicia sesión para gestionar las cuentas." }, { status: 401 });
        let input: { accountId?: unknown };
        try { input = await request.json(); } catch { return Response.json({ error: "Solicitud no válida." }, { status: 400 }); }
        if (typeof input.accountId !== "string") return Response.json({ error: "Falta la cuenta." }, { status: 400 });

        const db = getDb();
        const result = await db
          .prepare("UPDATE social_accounts SET status = 'desconectada', token_ciphertext = NULL, token_iv = NULL, token_expires_at = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND platform = 'Instagram'")
          .bind(input.accountId, session.userId)
          .run();
        if (!result.meta.changes) return Response.json({ error: "No se encontró la cuenta." }, { status: 404 });
        await db.batch([
          db.prepare("DELETE FROM instagram_media_grants WHERE user_id = ? AND content_id IN (SELECT content_id FROM instagram_publish_jobs WHERE account_id = ? AND status IN ('creating', 'processing', 'publishing'))")
            .bind(session.userId, input.accountId),
          db.prepare("UPDATE instagram_publish_jobs SET status = 'failed', error = 'Cuenta desconectada durante la publicación.', updated_at = datetime('now') WHERE account_id = ? AND user_id = ? AND status IN ('creating', 'processing', 'publishing')")
            .bind(input.accountId, session.userId),
        ]);
        return Response.json({ ok: true });
      },
    },
  },
});
