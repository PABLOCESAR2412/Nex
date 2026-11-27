# Nex

Nex es un espacio de trabajo para preparar, revisar y organizar contenido. La biblioteca guarda piezas, guiones, estados y fechas en D1. Los videos, imágenes y PDF se almacenan en R2. Puedes conectar varias cuentas de Instagram y TikTok, publicar Reels confirmados en Instagram y enviar videos a la bandeja de TikTok para editarlos y publicarlos allí.

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

En producción, Workers Builds aplica las migraciones D1 antes de publicar Nex. Las migraciones `0007_tiktok_uploads.sql` y `0008_instagram_job_media_grants.sql` conservan las cuentas existentes y añaden los datos para administrar envíos y permisos de archivos por cuenta.

Comprobaciones y vista previa:

```sh
bun run typecheck
bun run build
bun run preview
```

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
3. Sube el resultado a Nex, donde queda guardado con su título, descripción, guion, plataforma y estado.
4. Lo revisas y apruebas.
5. Eliges la cuenta y confirmas el envío. Nex inicia la publicación del Reel en Instagram o envía el video a la bandeja de TikTok. El calendario organiza fechas de trabajo y Nex muestra por separado el estado de cada envío.

### Qué hace cada parte
- **Asistentes:** crear borradores, cargar videos, consultar contenido y cuentas, programar fechas y publicar mediante MCP con autorización OAuth.
- **Nex:** organizar piezas, guiones, archivos, estados de revisión y fechas en el calendario. El endpoint MCP permite listar, crear y programar piezas para la sesión autenticada.
- **Instagram:** conectar cuentas profesionales con Instagram Login y publicar Reels desde piezas aprobadas.
- **TikTok:** conectar cuentas con Login Kit y enviar el video aprobado a la bandeja de la cuenta elegida.
- **Cloudflare:** alojar la aplicación y su API en Workers, guardar información en D1, almacenar videos y archivos en R2, y ejecutar tareas programadas.
- **GitHub, Cloudflare y Vercel:** conectar repositorios y gestionar despliegues desde Nex.

El render de video se ejecuta en el equipo donde corre el harness (Workers no es adecuado para renderizar videos pesados con HyperFrames y FFmpeg). El harness puede transferir el video a R2 mediante las herramientas MCP multipart, sin que Nex descargue URLs de terceros.

## Organización

```text
src/
  components/
    home-page.tsx    # resumen desde piezas y fechas guardadas
    studio-shell.tsx # navegación compartida y cabecera
    studio-pages.tsx # calendario y biblioteca funcionales; cuentas, despliegues y ajustes
  routes/
    __root.tsx       # documento HTML, metadatos y estilos globales
    index.tsx        # Inicio
    calendario.tsx   # Calendario
    biblioteca.tsx   # Biblioteca
    cuentas.tsx      # Cuentas
    despliegues.tsx  # Despliegues
    ajustes.tsx      # Ajustes
    api/
      mcp.ts         # herramientas MCP de contenido
      content.*.ts   # carga multipart y acceso autenticado a R2
      social.*.ts    # OAuth, cuentas y envíos de video
  router.tsx         # configuración de TanStack Router
  styles.css         # Tailwind y tokens visuales conservados
public/assets/       # marca e ilustración SVG
wrangler.jsonc       # entrada del Worker y configuración de Cloudflare
migrations/          # esquema, flujos de contenido e integraciones sociales
DESIGN.md            # sistema visual y reglas para futuras vistas
PRODUCT.md           # alcance del producto y límites de esta fase
```

Las fechas programadas se organizan dentro de Nex, pero todavía no disparan publicaciones automáticas. Para publicar en Instagram, la pieza debe estar aprobada, tener un video MP4 o MOV de hasta 1 GB y la persona debe confirmar la publicación. La API está orientada a cuentas profesionales Business o Creator; consulta la [documentación de Instagram de Meta](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/).

## Conectar asistentes por MCP

El endpoint remoto es <code>https://&lt;dominio-publico-de-nex&gt;/api/mcp</code>. El servidor implementa MCP sobre HTTP, OAuth 2.1 con PKCE, registro dinámico de clientes, autorización por permisos y renovación/revocación de tokens. Los tokens se guardan como hashes en D1 y cada cliente muestra una pantalla de consentimiento al usuario. Los refresh tokens renuevan su vigencia por 30 días cada vez que se usan.

- En la cabecera de Nex, abre **Conectar MCP**, selecciona tu cliente o **Personalizada** y sigue las instrucciones. El cliente abre la pantalla de Nex para autorizar la conexión.
- `nex:read` consulta piezas y cuentas, `nex:write` crea borradores, programa fechas y carga videos, y `nex:publish` aprueba videos, los envía a redes y consulta su estado. `get_profile` devuelve la identidad estable de la cuenta Nex.

### Enviar un video desde un asistente

1. Usa `create_content` con `title` y `description`. En Instagram la descripción será el texto del Reel. Si está vacía, se usará el título.
2. Llama a `start_video_upload` con el ID, nombre, tipo MIME y tamaño exacto del archivo MP4 o MOV. Nex acepta hasta 1 GiB y devuelve el tamaño de cada parte (8 MiB, salvo la última), cuántas partes enviar, `upload_id`, `upload_url` y un `upload_token` válido durante una hora.
3. Desde el equipo que tiene el archivo, envía las partes binarias con `PUT` a `upload_url?part_number=N`, numeradas desde 1. Usa el encabezado `Authorization: Bearer <upload_token>` y el `Content-Length` de cada parte. Pasa los pares `part_number` y `etag` en orden a `complete_video_upload`. Los clientes que ya automatizan base64 pueden usar `upload_video_part`. Una carga incompleta se puede cancelar con `abort_video_upload`.
4. Usa `list_social_accounts` para identificar la cuenta y plataforma elegidas. Tras la aprobación del usuario, llama a `approve_video_content` con `confirm_approve: true`. Para enviar el video a esa cuenta llama a `publish_social_video` con `confirm_publish: true`, después de que el usuario confirme el destino.
5. Usa `check_social_publish` con `platform` y el `job_id` recibido. En Instagram la consulta finaliza la publicación al quedar listo el Reel. En TikTok, `awaiting_user` indica que el usuario debe abrir la notificación en TikTok, añadir el texto que devuelve Nex y completar la publicación.

ChatGPT habilita las conexiones MCP personalizadas desde web; las acciones de escritura requieren Business, Enterprise o Edu. Pro permite herramientas de lectura. Consulta los [requisitos actuales de ChatGPT](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) antes de configurar la conexión.

El despliegue configurado usa `bun run deploy`, que aplica las migraciones D1 remotas antes de publicar el Worker. La migración OAuth `0005_mcp_oauth.sql` también revoca los tokens Bearer antiguos para que las nuevas conexiones usen OAuth.

## Instagram

En Meta Developers, configura Instagram API with Instagram Login, registra como OAuth redirect URI https://&lt;dominio-publico&gt;/api/social/instagram/callback y habilita los permisos <code>instagram_business_basic</code> e <code>instagram_business_content_publish</code>. La publicación de contenido está disponible para cuentas profesionales Business y Creator, con límites de formato definidos por Meta.

Configura estas variables para cada entorno:

- <code>INSTAGRAM_APP_ID</code>: ID público de la app de Meta.
- <code>INSTAGRAM_GRAPH_VERSION</code>: versión Graph vigente habilitada para esa app, por ejemplo v27.0.
- <code>PUBLIC_APP_URL</code>: URL HTTPS pública base de Nex, sin ruta adicional.
- <code>INSTAGRAM_APP_SECRET</code>: secreto de Worker; no lo guardes en el repositorio.
- <code>INSTAGRAM_TOKEN_ENCRYPTION_KEY</code>: secreto aleatorio de al menos 32 bytes para cifrar tokens antes de guardarlos en D1.

En Cloudflare, guarda app secret y clave de cifrado como Worker secrets (<code>wrangler secret put INSTAGRAM_APP_SECRET</code> y <code>wrangler secret put INSTAGRAM_TOKEN_ENCRYPTION_KEY</code>). Para desarrollo local, define las mismas variables en <code>.dev.vars</code>, que está excluido de Git. Si cambias la clave de cifrado después de conectar cuentas, Nex ya no podrá descifrar sus tokens y será necesario volver a conectar cada cuenta.

En **Cuentas**, usa **Añadir cuenta** para cada perfil profesional. Si Instagram vuelve a mostrar la cuenta anterior, cambia a la cuenta que quieres añadir en Instagram antes de continuar. En **Biblioteca**, aprueba la pieza con video, elige la cuenta de destino y confirma el Reel. Nex da a Meta acceso temporal al archivo R2 y revisa el estado del contenedor antes de publicar. La URL temporal vence en ocho horas. Instagram usa un único texto para el Reel. Nex envía la descripción de la pieza y usa el título cuando falta la descripción.

## TikTok

En TikTok for Developers, habilita **Login Kit** para web y **Content Posting API** para carga de borradores. Registra `https://<dominio-publico>/api/social/tiktok/callback` como URL de retorno y solicita los permisos `user.info.basic` y `video.upload`. Verifica en **URL properties** el dominio o el prefijo raíz de Nex para que TikTok pueda descargar el video. Para verificar un prefijo, sirve el archivo de comprobación de TikTok en la ubicación que indica el portal. Prueba con las cuentas autorizadas en el entorno configurado en TikTok. [Registro y verificación de la app](https://developers.tiktok.com/docs/en/getting-started-create-an-app)

Variables del Worker:

- `TIKTOK_CLIENT_KEY` identifica la app de TikTok.
- `TIKTOK_CLIENT_SECRET` guarda el secreto de la app como Worker secret.
- `TIKTOK_TOKEN_ENCRYPTION_KEY` guarda como Worker secret una clave aleatoria de al menos 32 bytes. Conserva la misma clave para poder descifrar las conexiones existentes.
- `PUBLIC_APP_URL` es el origen HTTPS de Nex que verificaste ante TikTok. Define el origen sin añadir ninguna ruta.

En **Cuentas**, pulsa **Añadir cuenta** en TikTok y autoriza la cuenta que quieres usar. Cambia a otro perfil en TikTok antes de repetir la autorización. En **Biblioteca**, elige el destino y confirma el envío del MP4, MOV o WebM. Desde MCP puedes seleccionar la misma cuenta por su ID. El video aparece como una notificación en la bandeja de TikTok. Abre el borrador, copia el texto que Nex conserva junto a la pieza, ajusta la descripción y publica en TikTok. La API de borradores de video recibe el archivo y la edición final del título y la descripción sucede en TikTok. [Carga de videos en TikTok](https://developers.tiktok.com/docs/en/content-posting-api-reference-upload-video)
