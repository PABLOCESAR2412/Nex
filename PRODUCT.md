# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
TanStack Start, React, TypeScript, Vite, Bun, Tailwind CSS, Cloudflare Workers, D1, and R2. Nex implements a content library, private media storage, review states, internal scheduling, MCP content tools, multiple Instagram and TikTok accounts through OAuth, Instagram Reel publishing, and TikTok draft uploads. YouTube, automatic scheduled publishing, deployment management, and preference persistence remain future work.

## Users
The primary user is Pablo, working across personal and project social accounts to plan and manage AI-assisted content.

## Product Purpose
Nex provides one place to organize video and campaign assets, review work, plan publication dates, publish approved Reels to connected Instagram professional accounts, and send videos to TikTok for final editing and publication.

Nex is a cloud hub to prepare, review and schedule content, and to manage publications and deployments. The web application organizes the work; the harness (Hermes, OpenCode, etc.) provides the agents and tools that create the materials.

## Content flow
1. You ask the agent for a video with a topic, style and goal.
2. The harness uses scripting, design and video skills to prepare the material and render it.
3. The result is uploaded to Nex, where it is stored with its title, description, script, target platform and state.
4. You review and approve it.
5. You choose a connected account and confirm the action. Nex can publish an approved Reel to Instagram or deliver the approved TikTok video as a draft. Scheduled dates organize work in the calendar.

## Responsibilities
- **Harness:** create and edit content through agents and skills; connect to Nex via MCP.
- **Nex:** organize campaigns, videos, calendar, connected accounts, reviews, Instagram Reel publication, TikTok draft delivery, and deployments.
- **Cloudflare:** host the application and its API on Workers, store data in D1, store videos and files in R2, and run scheduled tasks.
- **GitHub, Cloudflare and Vercel:** connect repositories and manage deployments from Nex.

## Rendering
Video rendering keeps running on the machine where the harness runs, because Workers is not the right place to render heavy videos with HyperFrames and FFmpeg. The result is then uploaded to R2. This avoids keeping a VPS running for storage and scheduling; only the machine running the harness needs to be available to generate content.

## Positioning
Content generation can happen in a local or external harness; Nex is the cloud workspace for organizing the outputs and coordinating publication and related deployments.

## Operating Context
The user expects to create videos with DeepSeek Harness and local tools, then store and manage the finished material in a web application. A dedicated VPS is not part of the initial hosting plan.

## Capabilities and Constraints
- Inicio reflects saved content and dates. Biblioteca supports content creation, editing, deletion, scripts, planned channels, review states, scheduling, and authenticated media uploads to R2. Calendario reads those dates and supports monthly navigation. Authorized MCP clients can create content with a title and description, upload video parts to R2, list connected accounts, and send confirmed videos to the selected account.
- Instagram and TikTok connections require developer app credentials and provider approval for the relevant permissions. YouTube, automatic scheduled social publishing, deployment provider actions, settings persistence, and global search remain unconnected.
- Instagram publishing requires an approved piece with an MP4 or MOV video no larger than 1 GB and an Instagram professional account. It creates a short-lived public capability URL for Meta to fetch the private R2 asset; the URL expires after eight hours.
- TikTok uploads require `video.upload` authorization and a verified public media URL under Nex's domain. Nex sends the video to the chosen account's inbox and keeps its title and description available for the user to edit and publish in TikTok.
- Cloudflare Workers, D1, and R2 are configured for the current product flow. Queues and external integrations remain future work.
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
1. Apply pending migrations in each D1 environment. `bun run deploy` applies remote migrations before publishing.
2. Connect YouTube and add automatic publishing for scheduled social posts.
3. Add deployment-provider connections and saved workspace preferences.

## Design evolution
Las vistas de biblioteca, cuentas, calendario, ajustes y despliegues heredan esta paleta, tipografía y espaciado. Cada integración debe mostrar su estado (conectada, requiere atención o no configurada) en texto y en color, mantener las credenciales fuera de la interfaz pública y conservar la misma jerarquía entre pieza, archivo y destino.
