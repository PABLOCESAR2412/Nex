import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import "../styles.css";

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
        content: "Nex, el espacio para organizar campañas, videos y publicaciones.",
      },
      { title: "Nex — Tu estudio de contenido" },
    ],
    links: [{ rel: "icon", href: "/assets/nex-mark.svg", type: "image/svg+xml" }],
  }),
  component: RootDocument,
});
