import handler from "@tanstack/react-start/server-entry";
import { runPublicationCycle } from "./lib/publications";

export default {
  // Igual que la entrada por defecto de Start: Workers llama fetch(request, env, ctx) y Start lo recibe tal cual.
  fetch: handler.fetch as unknown as ExportedHandlerFetchHandler<Env>,
  // Cron Trigger (wrangler.jsonc): lanza las publicaciones vencidas y consulta las que están en curso.
  async scheduled(_controller, _env, ctx) {
    ctx.waitUntil(runPublicationCycle().catch((error) => console.error("publication cycle failed", error)));
  },
} satisfies ExportedHandler<Env>;
