# Nex

Nex es un espacio de trabajo para preparar, revisar y organizar contenido. La biblioteca guarda piezas, guiones, estados y fechas en D1; los videos, imágenes y PDF se almacenan en R2. El calendario y el panel de Inicio muestran esos datos. Instagram se puede conectar con OAuth y publicar Reels confirmados desde la biblioteca; TikTok, YouTube y la publicación automática de fechas programadas siguen pendientes.

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
3. Sube el resultado a Nex, donde queda guardado con su guion, descripción, plataforma y estado.
4. Lo revisas y apruebas.
5. Nex lo programa para las cuentas conectadas y muestra su estado.

### Qué hace cada parte
- **Harness:** crear y editar contenido mediante agentes y skills; conectarse a Nex por MCP.
- **Nex:** organizar piezas, guiones, archivos, estados de revisión y fechas en el calendario. El endpoint MCP permite listar, crear y programar piezas para la sesión autenticada.
- **Instagram:** conectar una cuenta profesional con Instagram Login y publicar un Reel desde una pieza aprobada.
- **Cloudflare:** alojar la aplicación y su API en Workers, guardar información en D1, almacenar videos y archivos en R2, y ejecutar tareas programadas.
- **GitHub, Cloudflare y Vercel:** conectar repositorios y gestionar despliegues desde Nex.

El render de video se ejecuta en el equipo donde corre el harness (Workers no es adecuado para renderizar videos pesados con HyperFrames y FFmpeg). Luego el resultado se sube a R2.

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
      social.*.ts    # OAuth, cuentas y publicación de Reels
  router.tsx         # configuración de TanStack Router
  styles.css         # Tailwind y tokens visuales conservados
public/assets/       # marca e ilustración SVG
wrangler.jsonc       # entrada del Worker y configuración de Cloudflare
migrations/          # esquema inicial, contenido e Instagram
DESIGN.md            # sistema visual y reglas para futuras vistas
PRODUCT.md           # alcance del producto y límites de esta fase
```

Las fechas programadas se organizan dentro de Nex, pero todavía no disparan publicaciones automáticas. Para publicar en Instagram, la pieza debe estar aprobada, tener un video MP4 o MOV de hasta 1 GB y la persona debe confirmar la publicación en la biblioteca. La API está orientada a cuentas profesionales Business o Creator; consulta la [documentación de Instagram de Meta](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/). El acceso a Nex y al MCP usa la sesión web existente; la autenticación específica para un harness externo aún debe definirse.

## Instagram

En Meta Developers, configura Instagram API with Instagram Login, registra como OAuth redirect URI https://&lt;dominio-publico&gt;/api/social/instagram/callback y habilita los permisos <code>instagram_business_basic</code> e <code>instagram_business_content_publish</code>. La publicación de contenido está disponible para cuentas profesionales Business y Creator, con límites de formato definidos por Meta.

Configura estas variables para cada entorno:

- <code>INSTAGRAM_APP_ID</code>: ID público de la app de Meta.
- <code>INSTAGRAM_GRAPH_VERSION</code>: versión Graph vigente habilitada para esa app, por ejemplo v27.0.
- <code>PUBLIC_APP_URL</code>: URL HTTPS pública base de Nex, sin ruta adicional.
- <code>INSTAGRAM_APP_SECRET</code>: secreto de Worker; no lo guardes en el repositorio.
- <code>INSTAGRAM_TOKEN_ENCRYPTION_KEY</code>: secreto aleatorio de al menos 32 bytes para cifrar tokens antes de guardarlos en D1.

En Cloudflare, guarda app secret y clave de cifrado como Worker secrets (<code>wrangler secret put INSTAGRAM_APP_SECRET</code> y <code>wrangler secret put INSTAGRAM_TOKEN_ENCRYPTION_KEY</code>). Para desarrollo local, define las mismas variables en <code>.dev.vars</code>, que está excluido de Git. Si cambias la clave de cifrado después de conectar cuentas, Nex ya no podrá descifrar sus tokens y será necesario volver a conectar cada cuenta.

En Cuentas, conecta la cuenta profesional. En Biblioteca, aprueba una pieza con video y pulsa Publicar Reel; Nex pedirá confirmación, entregará a Meta una URL temporal con acceso limitado al archivo R2 y revisará el estado del contenedor antes de publicar. La URL temporal vence en ocho horas. La publicación programada automáticamente se implementará aparte.
