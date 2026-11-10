# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
TanStack Start, React, TypeScript, Vite, Bun, Tailwind CSS, and Cloudflare Workers. The current delivery remains a visual prototype without application logic or external integrations.

## Users
The primary user is Pablo, working across personal and project social accounts to plan and manage AI-assisted content.

## Product Purpose
Nex is intended to provide one place to organize video and campaign assets, review work, plan publication dates, and eventually publish to connected social accounts.

Nex is a cloud hub to prepare, review and schedule content, and to manage publications and deployments. The web application organizes the work; the harness (Hermes, OpenCode, etc.) provides the agents and tools that create the materials.

## Content flow
1. You ask the agent for a video with a topic, style and goal.
2. The harness uses scripting, design and video skills to prepare the material and render it.
3. The result is uploaded to Nex, where it is stored with its script, description, target platform and state.
4. You review and approve it.
5. Nex schedules it for the connected accounts and shows its status.

## Responsibilities
- **Harness:** create and edit content through agents and skills; connect to Nex via MCP.
- **Nex:** organize campaigns, videos, calendar, accounts, reviews, publications and deployments.
- **Cloudflare:** host the application and its API on Workers, store data in D1, store videos and files in R2, and run scheduled tasks.
- **GitHub, Cloudflare and Vercel:** connect repositories and manage deployments from Nex.

## Rendering
Video rendering keeps running on the machine where the harness runs, because Workers is not the right place to render heavy videos with HyperFrames and FFmpeg. The result is then uploaded to R2. This avoids keeping a VPS running for storage and scheduling; only the machine running the harness needs to be available to generate content.

## Positioning
Content generation can happen in a local or external harness; Nex is the cloud workspace for organizing the outputs and coordinating publication and related deployments.

## Operating Context
The user expects to create videos with DeepSeek Harness and local tools, then store and manage the finished material in a web application. A dedicated VPS is not part of the initial hosting plan.

## Capabilities and Constraints
- The current delivery is a visual prototype only. Navigation between Inicio, Calendario, Biblioteca, Cuentas, Despliegues and Ajustes works; search, account connections, uploads, scheduling, publishing, deployment actions and preference saving are not connected.
- Cloudflare Workers is the intended initial host. Database, object storage, queues, social APIs, and deployment integrations remain future work.
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
1. Connect storage and persistence (D1 + R2).
2. Add MCP integration, account authorization and real scheduling.
3. Respect official API permissions and requirements for Instagram, TikTok and YouTube.

## Design evolution
Las vistas de biblioteca, cuentas, calendario, ajustes y despliegues heredan esta paleta, tipografía y espaciado. Cada integración debe mostrar su estado (conectada, requiere atención o no configurada) en texto y en color, mantener las credenciales fuera de la interfaz pública y conservar la misma jerarquía entre pieza, archivo y destino.