# Nex

Prototipo visual del espacio para organizar campañas, videos y publicaciones. Esta entrega usa HTML y CSS estáticos; no contiene lógica de producto, cuentas conectadas, base de datos, cargas, publicaciones ni autenticación.

## Vista previa local

Abre `public/index.html` en un navegador. Para probarlo en el runtime de Cloudflare, usa `npx wrangler dev` desde la raíz del repositorio.

## Cloudflare

La captura muestra que el proceso se detiene en **Clonando repositorio**. El repositorio `PABLOCESAR2412/Nex` existe y es público, pero GitHub responde que está vacío (`size: 0`; la API de contenidos devuelve `This repository is empty`). No hay commit ni referencia que Cloudflare pueda clonar. Por eso falla antes del comando de despliegue; el registro no indica todavía un error de token ni de Wrangler.

El proyecto incluye `wrangler.jsonc` con `assets.directory` apuntando a `public/`, adecuado para servir el prototipo estático desde Workers Static Assets. Cloudflare documenta el despliegue de assets con Wrangler y el comando `npx wrangler deploy` [en su guía oficial](https://developers.cloudflare.com/workers/static-assets/get-started/).

Cuando haya un primer commit en `main`, la configuración de Workers Builds para esta versión puede ser:

- Directorio raíz: `/`
- Comando de compilación: vacío
- Comando de despliegue: `npx wrangler deploy`

El nombre de proyecto y la conexión de GitHub que aparecen en la captura no bastan si el repositorio no tiene contenido. Después de subir el primer commit, vuelve a ejecutar la compilación; si aparece un nuevo error, será una etapa posterior y habrá que leer su registro específico.

## Estructura recomendada para la siguiente fase

Esta entrega mantiene solo los archivos necesarios para el diseño. Para añadir lógica después, la propuesta es separar la aplicación web del trabajo asíncrono:

```text
apps/
  web/                 # React + TypeScript + Vite; vistas y componentes
  api/                 # Worker para sesiones, campañas y metadatos
  publisher/           # Worker consumidor de cola y tareas programadas
packages/
  domain/              # Tipos y reglas de campañas independientes del proveedor
  integrations/        # Adaptadores de Cloudflare, Vercel y redes sociales
infra/
  migrations/          # Migraciones de D1
public/                # Archivos estáticos y portada de marca
DESIGN.md              # Tokens y reglas visuales
PRODUCT.md             # Propósito y límites del producto
wrangler.jsonc         # Configuración Cloudflare
```

### Servicios previstos, aún no creados

- **D1:** campañas, cuentas, publicaciones, estados y metadatos.
- **R2:** videos, imágenes y archivos finales; no guardar binarios grandes en D1.
- **Queues + Cron Triggers:** ejecutar publicaciones programadas y reintentar fallos fuera de la petición web.
- **Secrets / almacenamiento cifrado:** credenciales OAuth, nunca en el frontend ni en Git.
- **Harness local:** crear y renderizar video; luego enviar el archivo a Nex para organizarlo y programarlo.

El diseño no implica que una plataforma social permita cualquier forma de publicación: cada integración deberá respetar OAuth, permisos y requisitos vigentes del servicio.

