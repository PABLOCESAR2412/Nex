/// <reference types="vitest/globals" />
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { vi } from "vitest";
import { routeTree } from "./routeTree.gen";

vi.mock("./lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/auth")>();
  return {
    ...actual,
    meFn: vi.fn().mockResolvedValue({ id: "test-user", name: "Pablo", email: "pablo@example.test" }),
  };
});

function renderRoute(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history });
  return render(<RouterProvider router={router} />);
}

describe("Nex views smoke", () => {
  it("renders home", async () => {
    renderRoute("/");
    await waitFor(() => expect(screen.getByRole("heading", { name: /tu estudio de contenido/i })).toBeInTheDocument());
  });
  it("renders calendar", async () => {
    renderRoute("/calendario");
    await waitFor(() => expect(screen.getByRole("heading", { name: /calendario/i })).toBeInTheDocument());
  });
  it("renders library", async () => {
    renderRoute("/biblioteca");
    await waitFor(() => expect(screen.getByRole("heading", { name: /biblioteca/i })).toBeInTheDocument());
  });
  it("renders accounts", async () => {
    renderRoute("/cuentas");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Cuentas" })).toBeInTheDocument());
  });
  it("renders deployments", async () => {
    renderRoute("/despliegues");
    await waitFor(() => expect(screen.getByRole("heading", { name: /despliegues/i })).toBeInTheDocument());
  });
  it("renders settings", async () => {
    renderRoute("/ajustes");
    await waitFor(() => expect(screen.getByRole("heading", { name: /ajustes/i })).toBeInTheDocument());
  });
  it("renders 404 for unknown route", async () => {
    renderRoute("/no-existe");
    await waitFor(() => expect(screen.getByText(/esta vista no existe/i)).toBeInTheDocument());
  });
});
