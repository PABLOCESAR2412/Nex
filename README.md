# Nex

Nex es un espacio de trabajo para preparar, revisar y publicar contenido. La biblioteca guarda piezas, guiones, estados y fechas en D1; los videos, imágenes y PDF se almacenan en R2. Un agente (Hermes, Claude, ChatGPT u otro cliente MCP) puede subir y programar piezas por MCP. Nex publica en Instagram (Reels) y envía videos a la bandeja de TikTok como borrador, a la hora programada y por cuenta, con un Cron Trigger de Cloudflare. YouTube sigue pendiente.

## Tecnologías

- **Aplicación:** TanStack Start, React y TypeScript.
- **Desarrollo y compilación:** Vite.
- **Paquetes y scripts:** Bun (`bun@1.4.0`, fijado en `package.json`).
- **Estilos:** Tailwind CSS 4 por su plugin de Vite; los tokens y reglas existentes siguen en `src/styles.css` para conservar la identidad visual.
- **Alojamiento:** Cloudflare Workers mediante `@cloudflare/vite-plugin` y Wrangler.

Bun se usa para instalar y compilar. El runtime publicado es Cloudflare Workers.

## Desarrollo local

```sh
bun install
bun run dev
```

Después de descargar cambios con nuevas migraciones, aplícalas a la base local antes de usar la aplicación:

```sh
bunx wrangler d1 migrations apply nex-db --local
```

Para aplicar migraciones en Cloudflare, usa `--remote` y confirma que el comando apunta a la base correcta. Wrangler solicita confirmación y genera una copia de seguridad al aplicar una migración remota.

Comprobaciones y vista previa:

```sh
bun run typecheck
bun run test
bun run build
bun run preview
```

Las pruebas usan una base D1 real de Wrangler con las migraciones aplicadas, un R2 en memoria y las APIs de Instagram y TikTok simuladas; no llaman a ninguna red social.

Despliegue manual desde una sesión autenticada con Wrangler:

```sh
bunx wrangler login
bun run deploy:local
```

## Workers Builds

El Worker existente se llama `nex` y está conectado al repositorio `PABLOCESAR2412/Nex`, rama `main`, con raíz `/`. En **Workers & Pages → nex → Settings → Builds**, configura:

- **Build command:** `bun run build`
- **Deploy command:** `bun run deploy`
- **Root directory:** `/`

El comando de build es necesario para que TanStack Start y Vite generen el Worker y los assets. Si queda vacío, `wrangler deploy` no tendrá una compilación válida que publicar. La conexión y el token de Workers Builds siguen gestionándose desde Cloudflare; no se guardan secretos en este repositorio.

## Visión del producto

Nex es un centro en la nube para preparar, revisar y programar contenido, además de gestionar publicaciones y despliegues. La aplicación web organiza el trabajo; el harness (Hermes, OpenCode, etc.) aporta los agentes y herramientas que crean los materiales.

### Flujo de contenido
1. Le pides al agente un video con un tema, estilo y objetivo.
2. El harness usa las skills de guion, diseño y video para preparar el material y renderizarlo.
3. Sube el resultado a Nex, donde queda guardado con su guion, descripción, plataforma y estado.
4. Lo revisas y apruebas.
5. Eliges las cuentas y la hora: Nex publica en Instagram o deja el borrador en la bandeja de TikTok y muestra el estado de cada publicación.

### Qué hace cada parte
- **Harness:** crear y editar contenido mediante agentes y skills; conectarse a Nex por MCP.
- **Nex:** organizar piezas, guiones, archivos, estados de revisión y fechas en el calendario, y publicar por cuenta. El endpoint MCP permite listar, crear, subir archivos, programar y cancelar publicaciones según los permisos de cada clave.
- **Instagram:** conectar cuentas profesionales con Instagram Login y publicar Reels de piezas aprobadas.
- **TikTok:** conectar una cuenta y subir el video a su bandeja como borrador; la persona lo revisa y lo publica desde la app de TikTok.
- **Cloudflare:** alojar la aplicación y su API en Workers, guardar información en D1, almacenar videos y archivos en R2, y ejecutar tareas programadas.
- **GitHub, Cloudflare y Vercel:** conectar repositorios y gestionar despliegues desde Nex.

El render de video se ejecuta en el equipo donde corre el harness (Workers no es adecuado para renderizar videos pesados con HyperFrames y FFmpeg). Luego el resultado se sube a R2.

## Organización

```text
src/
  components/
    home-page.tsx           # resumen desde piezas y fechas guardadas
    studio-shell.tsx        # navegación, cabecera y diálogo de conexión MCP
    studio-pages.tsx        # calendario, biblioteca y cuentas (Instagram y TikTok)
    publications-panel.tsx  # programar, seguir y cancelar publicaciones por cuenta
  lib/
    mcp.ts                  # claves MCP y sus permisos
    oauth.ts                # OAuth 2.1 para conectores (registro, código + PKCE, tokens)
    publications.ts         # publicaciones por cuenta y ciclo del cron
    instagram*.ts           # OAuth, publicación y renovación de tokens de Instagram
    tiktok.ts               # OAuth, subida por trozos y estado de TikTok
    token-crypto.ts         # cifrado de tokens y hashes
  routes/
    __root.tsx, index.tsx, calendario.tsx, biblioteca.tsx, cuentas.tsx, despliegues.tsx, ajustes.tsx
    api/
      mcp.ts                # herramientas MCP
      content.*.ts          # carga multipart y acceso autenticado a R2
    api.social.*.ts         # OAuth, cuentas y publicación de Instagram y TikTok
    oauth.*.ts              # registro, autorización y token de OAuth
    [.]well-known.*.ts      # metadatos de OAuth para conectores
  server.ts                 # entrada del Worker: fetch y Cron Trigger
  router.tsx                # configuración de TanStack Router
  styles.css                # Tailwind y tokens visuales conservados
public/nex-upload.mjs       # script para subir archivos locales con una clave MCP
public/assets/              # marca e ilustración SVG
wrangler.jsonc              # entrada del Worker, bindings y cron
migrations/                 # esquema: contenido, Instagram, MCP, publicaciones, TikTok, OAuth
DESIGN.md                   # sistema visual y reglas para futuras vistas
PRODUCT.md                  # alcance del producto y límites de esta fase
```

## Acceso y seguridad

- **Registro cerrado:** solo se puede crear el primer usuario (el propietario). Después, el registro se rechaza. Para abrirlo otra vez, define `ALLOW_REGISTRATION=true`.
- **Tokens de redes sociales:** se cifran antes de guardarse en D1 con `TOKEN_ENCRYPTION_KEY` (o `INSTAGRAM_TOKEN_ENCRYPTION_KEY`, que tiene prioridad si existe). Si cambias esa clave, hay que volver a conectar las cuentas.
- **Aprobación:** solo se publican piezas que tú aprobaste; un agente no puede saltarse ese paso.

## Conectar un agente por MCP

El servidor MCP está en `https://<dominio-publico>/api/mcp` (JSON-RPC sobre POST). Hay dos formas de autenticarse:

1. **Clave Bearer:** en Nex, abre el diálogo de conexión, elige los permisos y crea la clave (`nex_live_…`, se muestra una sola vez). El cliente la envía como `Authorization: Bearer <clave>`. Se puede revocar desde el mismo diálogo.
2. **OAuth 2.1 (conectores):** los clientes que inician sesión por su cuenta descubren Nex por `/.well-known/oauth-protected-resource`, se registran en `/oauth/register`, y la persona aprueba el acceso en una pantalla de consentimiento (con PKCE S256). Las claves emitidas duran una hora y se renuevan con un refresh token rotativo; aparecen en el mismo diálogo y se revocan igual. Esta parte sigue el estándar y está probada con pruebas y en workerd, pero **no se ha probado con claude.ai ni con ChatGPT reales**: pueden aparecer diferencias propias de cada cliente.

Permisos de una clave:

| Permiso | Permite |
| --- | --- |
| `content:read` | Listar piezas, cuentas conectadas y publicaciones. |
| `content:write` | Crear piezas, subir archivos y colocarlas en el calendario. |
| `publish` | Programar publicaciones en cuentas, cancelarlas y publicar Reels. |

Las claves creadas antes de que existieran los permisos conservan los tres. `tools/list` solo muestra lo que la clave puede usar.

Herramientas principales: `list_content`, `create_content`, `upload_content_from_url`, `schedule_content` (con `account_ids` programa en cuentas), `list_social_accounts`, `list_publications`, `cancel_publication`, `publish_instagram_reel` y `check_instagram_publish`.

**Subir un archivo local.** Un agente en otra máquina puede subir un video con el script sin dependencias que Nex sirve en `/nex-upload.mjs` (Node 18 o superior):

```sh
NEX_URL=https://<dominio-publico> NEX_TOKEN=nex_live_... node nex-upload.mjs <content_id> <archivo>
```

Sube el archivo por partes con reintentos y imprime un JSON con el resultado. Si el video ya está en una URL pública, `upload_content_from_url` lo copia sin pasar por el agente (HTTPS directo, con `Content-Length`, hasta 1 GB).

## Publicación programada

Una publicación es una fila por pieza y cuenta (`programada`, `en_curso`, `publicada`, `borrador_enviado`, `fallida`, `requiere_revision` o `cancelada`). En Biblioteca, o con `schedule_content` y `account_ids`, eliges las cuentas y la hora; solo se pueden programar piezas aprobadas.

Un Cron Trigger (`wrangler.jsonc`, cada minuto, disponible en el plan gratuito de Workers) lanza las publicaciones vencidas, consulta las que están en curso y, a la hora en punto, renueva los tokens de Instagram que vencen en menos de 14 días. Cada publicación se reclama con una actualización condicional para no publicarse dos veces. Si una publicación queda más de dos horas sin resolverse pasa a `requiere_revision`: revisa la red social antes de reintentar.

Para publicar en Instagram a la hora programada, `PUBLIC_APP_URL` es obligatorio: Meta descarga el video desde una URL temporal de Nex.

## Instagram

En Meta Developers, configura Instagram API with Instagram Login, registra como OAuth redirect URI https://&lt;dominio-publico&gt;/api/social/instagram/callback y habilita los permisos <code>instagram_business_basic</code> e <code>instagram_business_content_publish</code>. La publicación de contenido está disponible para cuentas profesionales Business y Creator, con límites de formato definidos por Meta.

Configura estas variables para cada entorno:

- <code>INSTAGRAM_APP_ID</code>: ID público de la app de Meta.
- <code>INSTAGRAM_GRAPH_VERSION</code>: versión Graph vigente habilitada para esa app, por ejemplo v27.0.
- <code>PUBLIC_APP_URL</code>: URL HTTPS pública base de Nex, sin ruta adicional.
- <code>INSTAGRAM_APP_SECRET</code>: secreto de Worker; no lo guardes en el repositorio.
- <code>INSTAGRAM_TOKEN_ENCRYPTION_KEY</code> o <code>TOKEN_ENCRYPTION_KEY</code>: secreto aleatorio de al menos 32 bytes para cifrar tokens antes de guardarlos en D1.

En Cloudflare, guarda app secret y clave de cifrado como Worker secrets (<code>wrangler secret put INSTAGRAM_APP_SECRET</code> y <code>wrangler secret put INSTAGRAM_TOKEN_ENCRYPTION_KEY</code>). Para desarrollo local, define las mismas variables en <code>.dev.vars</code>, que está excluido de Git. Si cambias la clave de cifrado después de conectar cuentas, Nex ya no podrá descifrar sus tokens y será necesario volver a conectar cada cuenta.

En Cuentas, conecta la cuenta profesional. En Biblioteca, aprueba una pieza con video y pulsa Publicar Reel; Nex pedirá confirmación, entregará a Meta una URL temporal con acceso limitado al archivo R2 y revisará el estado del contenedor antes de publicar. La URL temporal vence en ocho horas. Para publicar a una hora programada, usa el panel de publicaciones de la pieza (ver Publicación programada).

## TikTok

Nex usa la Content Posting API en modo «subir»: envía el video a la bandeja de TikTok como borrador y **la persona lo revisa, escribe la descripción y lo publica desde la app**. No usa Direct Post, que exige una auditoría de TikTok. Por eso, una publicación de TikTok termina en `borrador_enviado` y la pieza no se marca como publicada.

En TikTok for Developers, crea la app, activa Login Kit y Content Posting API con el permiso `video.upload`, y registra esta URI de redirección exacta: `https://<dominio-publico>/api/social/tiktok/callback`. Si la app está en modo sandbox, añade tu cuenta de TikTok como usuario de prueba.

Variables:

- `TIKTOK_CLIENT_KEY`: client key de la app.
- `TIKTOK_CLIENT_SECRET`: secreto de Worker (`wrangler secret put TIKTOK_CLIENT_SECRET`).
- `TOKEN_ENCRYPTION_KEY`: la misma clave de cifrado de arriba (si ya usas `INSTAGRAM_TOKEN_ENCRYPTION_KEY`, no hace falta otra).
- `PUBLIC_APP_URL`: origen HTTPS público de Nex.

El token de acceso de TikTok dura 24 horas: Nex lo renueva solo con el refresh token (365 días) y guarda el par rotado, cifrado. Los videos se suben desde R2 por trozos de hasta 64 MB; cada ciclo del cron sube alrededor de 128 MB y continúa en el siguiente, así que un video grande puede tardar varios minutos. El enlace de subida de TikTok dura una hora. Según la documentación de TikTok, solo puede haber 5 borradores pendientes cada 24 horas por cuenta: si se supera, la publicación falla con un mensaje claro. El conector está probado con la API simulada y la subida por trozos con el runtime real de Workers, pero **no se ha probado contra una cuenta real de TikTok**.
