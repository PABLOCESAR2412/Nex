# Nex

Nex es un espacio visual para organizar campañas, videos y publicaciones. Esta fase reemplaza el HTML estático por la base de aplicación elegida, conservando el diseño aprobado y los datos ilustrativos. Todavía no conecta cuentas, no carga archivos, no programa publicaciones ni guarda información.

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

## Organización

```text
src/
  components/
    home-page.tsx    # composición React del dashboard de muestra
    studio-shell.tsx # navegación compartida y cabecera
    studio-pages.tsx # calendario, biblioteca, cuentas, despliegues y ajustes
  routes/
    __root.tsx       # documento HTML, metadatos y estilos globales
    index.tsx        # Inicio
    calendario.tsx   # Calendario
    biblioteca.tsx   # Biblioteca
    cuentas.tsx      # Cuentas
    despliegues.tsx  # Despliegues
    ajustes.tsx      # Ajustes
  router.tsx         # configuración de TanStack Router
  styles.css         # Tailwind y tokens visuales conservados
public/assets/       # marca e ilustración SVG
wrangler.jsonc       # entrada del Worker y configuración de Cloudflare
DESIGN.md            # sistema visual y reglas para futuras vistas
PRODUCT.md           # alcance del producto y límites de esta fase
```

El calendario, los contadores y las campañas visibles son contenido de muestra, no información de redes conectadas. D1, R2, colas, OAuth, publicación social y despliegues desde Nex quedan para una fase posterior.
