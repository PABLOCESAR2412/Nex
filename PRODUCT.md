# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
TanStack Start, React, TypeScript, Vite, Bun, Tailwind CSS, Cloudflare Workers, D1, and R2. The content library, private media storage, review states, MCP content tools with per-key permissions and OAuth for connectors, per-account scheduled publishing driven by a Cron Trigger, Instagram professional-account OAuth with Reel publishing, and TikTok OAuth with draft uploads to the TikTok inbox are implemented. YouTube, deployment management, and preference persistence remain future work.

## Users
The primary user is Pablo, working across personal and project social accounts to plan and manage AI-assisted content.

## Product Purpose
Nex provides one place to organize video and campaign assets, review work, plan publication dates per account, and publish approved Reels to connected Instagram professional accounts or send approved videos to a TikTok inbox as drafts.

Nex is a cloud hub to prepare, review and schedule content, and to manage publications and deployments. The web application organizes the work; the harness (Hermes, OpenCode, etc.) provides the agents and tools that create the materials.

## Content flow
1. You ask the agent for a video with a topic, style and goal.
2. The harness uses scripting, design and video skills to prepare the material and render it.
3. The result is uploaded to Nex, where it is stored with its script, description, target platform and state.
4. You review and approve it.
5. You choose the accounts and the time. At that time Nex publishes the Reel to Instagram, or uploads the video to the TikTok inbox as a draft that you finish and publish in the TikTok app. Only pieces you approved can be scheduled, whether the request comes from the web app or from an agent over MCP.

## Responsibilities
- **Harness:** create and edit content through agents and skills; connect to Nex via MCP with a revocable key or OAuth. Keys carry permissions (read, write, publish).
- **Nex:** organize campaigns, videos, calendar, accounts, reviews, per-account publications (Instagram Reels, TikTok inbox drafts) and deployments.
- **Cloudflare:** host the application and its API on Workers, store data in D1, store videos and files in R2, and run the one-minute Cron Trigger that publishes due posts and renews Instagram tokens.
- **GitHub, Cloudflare and Vercel:** connect repositories and manage deployments from Nex.

## Rendering
Video rendering keeps running on the machine where the harness runs, because Workers is not the right place to render heavy videos with HyperFrames and FFmpeg. The result is then uploaded to R2. This avoids keeping a VPS running for storage and scheduling; only the machine running the harness needs to be available to generate content.

## Positioning
Content generation can happen in a local or external harness; Nex is the cloud workspace for organizing the outputs and coordinating publication and related deployments.

## Operating Context
The user expects to create videos with DeepSeek Harness and local tools, then store and manage the finished material in a web application. A dedicated VPS is not part of the initial hosting plan.

## Capabilities and Constraints
- Inicio reflects saved content and dates. Biblioteca supports content creation, editing, deletion, scripts, planned channels, review states, per-account scheduling with status tracking, and authenticated media uploads to R2. Calendario reads those dates and supports monthly navigation.
- MCP clients authenticate with OAuth 2.1 (PKCE, dynamic client registration, rotating refresh tokens) and the permissions `nex:read`, `nex:write` and `nex:publish`. They can list and create content, upload video parts to R2, list connected accounts, schedule and cancel per-account publications, and publish confirmed Reels. Nex does not download third-party URLs. OAuth has not been tried against real claude.ai or ChatGPT connectors beyond what the standard and the tests cover.
- Publications are one row per piece and account. The Cron Trigger starts due publications once (conditional claim) and polls those in progress; anything unresolved after two hours becomes "requires review" instead of being retried blindly.
- Instagram requires an approved piece with an MP4 or MOV video no larger than 1 GB and an Instagram professional account. Nex creates a short-lived public capability URL for Meta to fetch the private R2 asset (eight hours); scheduled Instagram publishing therefore needs `PUBLIC_APP_URL`. Long-lived tokens are renewed automatically when fewer than 14 days remain.
- TikTok uses the Content Posting API upload flow: the video goes to the creator's inbox as a draft and the person adds the caption and publishes it in the TikTok app. Direct Post is not used because it requires an audit. Uploads are chunked from R2 across cron cycles. Not yet verified against a real TikTok account.
- Access is restricted to the authorized email. Social tokens are encrypted in D1.
- Deployment-provider actions, YouTube, settings persistence and global search are not connected.
- Cloudflare Workers, D1, R2 and Cron Triggers are configured for the current product flow. Queues remain future work.
- Prototype metrics and campaign content are illustrative and must not be represented as live account data.

## Brand Commitments
The product name is Nex. The user prefers a minimal, elegant visual language with restrained deep-green variants, based on the provided content-studio reference.

## Evidence on Hand
The user-provided content-studio reference image is the visual reference. No real campaign assets, account data, or connected services have been provided.

## Product Principles
- Keep the campaign, its assets, review state, and publication plan understandable in one place.
- Make publication state and next actions easy to scan.
- Keep generated media in its own storage workflow; do not assume Workers render videos.
- Clearly distinguish sample data from connected account data.

## Planned views
- Inicio: ongoing campaigns, items to review, upcoming publications.
- Calendario: scheduled publications by date, platform and account.
- Biblioteca: videos, scripts, images and other materials.
- Cuentas: connected networks and their status.
- Despliegues: sites and projects published on Cloudflare or Vercel.
- Ajustes: connections, permissions and preferences.

## Roadmap
1. Apply migrations `0002_content_workflow.sql` through `0008_tiktok.sql` to each D1 environment (`bun run deploy` applies remote migrations before publishing) and set the TikTok and token-encryption secrets.
2. Try the TikTok connector and the OAuth connector flow with real accounts and clients, and fix what only real services reveal.
3. Add YouTube, then deployment-provider connections and saved workspace preferences. Consider TikTok Direct Post once the app is audited.

## Design evolution
Las vistas de biblioteca, cuentas, calendario, ajustes y despliegues heredan esta paleta, tipografía y espaciado. Cada integración debe mostrar su estado (conectada, requiere atención o no configurada) en texto y en color, mantener las credenciales fuera de la interfaz pública y conservar la misma jerarquía entre pieza, archivo y destino.
