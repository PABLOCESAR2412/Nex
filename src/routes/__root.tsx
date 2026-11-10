import { HeadContent, Outlet, Scripts, createRootRoute, type ErrorComponentProps } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import "../styles.css";

function NotFound() {
  return (
    <main className="not-found">
      <h1>404</h1>
      <p>Esta vista no existe en Nex.</p>
      <Link to="/">Volver al inicio</Link>
    </main>
  );
}

function RootError({ error }: ErrorComponentProps) {
  return (
    <main className="root-error">
      <h1>Algo salió mal</h1>
      <p>{error instanceof Error ? error.message : String(error)}</p>
      <Link to="/">Volver al inicio</Link>
    </main>
  );
}

function RootDocument() {
  return (
    <html lang="es">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#101a14" },
      {
        name: "description",
        content: "Nex, el espacio para organizar piezas, videos y publicaciones.",
      },
      { title: "Nex — Tu estudio de contenido" },
    ],
    links: [{ rel: "icon", href: "/assets/nex-mark.svg", type: "image/svg+xml" }],
  }),
  component: RootDocument,
  notFoundComponent: NotFound,
  errorComponent: RootError,
});
