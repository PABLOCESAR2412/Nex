import handler from "@tanstack/react-start/server-entry";
import { isHourlyTick, refreshInstagramTokens } from "./lib/instagram-refresh";
import { runPublicationCycle } from "./lib/publications";

export default {
  // Igual que la entrada por defecto de Start: Workers llama fetch(request, env, ctx) y Start lo recibe tal cual.
  fetch: handler.fetch as unknown as ExportedHandlerFetchHandler<Env>,
  // Cron Trigger (wrangler.jsonc): cada minuto lanza las publicaciones vencidas y consulta las que están en curso;
  // a la hora en punto renueva los tokens de Instagram que están por vencer.
  async scheduled(controller, _env, ctx) {
    ctx.waitUntil(runPublicationCycle().catch((error) => console.error("publication cycle failed", error)));
    if (isHourlyTick(controller.scheduledTime)) {
      ctx.waitUntil(refreshInstagramTokens().catch((error) => console.error("instagram token refresh failed", error)));
    }
  },
} satisfies ExportedHandler<Env>;
