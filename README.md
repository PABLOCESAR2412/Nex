# Nex

Nex es un espacio visual para organizar piezas, videos y publicaciones. Esta fase reemplaza el HTML estático por la base de aplicación elegida, conservando el diseño aprobado y los datos ilustrativos. Todavía no conecta cuentas, no carga archivos, no programa publicaciones ni guarda información.

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
- **Nex:** organizar piezas, videos, calendario, cuentas, revisiones, publicaciones y despliegues.
- **Cloudflare:** alojar la aplicación y su API en Workers, guardar información en D1, almacenar videos y archivos en R2, y ejecutar tareas programadas.
- **GitHub, Cloudflare y Vercel:** conectar repositorios y gestionar despliegues desde Nex.

El render de video se ejecuta en el equipo donde corre el harness (Workers no es adecuado para renderizar videos pesados con HyperFrames y FFmpeg). Luego el resultado se sube a R2.

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

El calendario, los contadores y las piezas visibles son contenido de muestra, no información de redes conectadas. D1, R2, colas, OAuth, publicación social y despliegues desde Nex quedan para una fase posterior.
