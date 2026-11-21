/// <reference types="vitest/globals" />
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { beforeEach, vi } from "vitest";
import { routeTree } from "./routeTree.gen";
import { SessionShellSkeleton } from "./components/loading-skeletons";
import { meFn } from "./lib/auth";
import { listRegisteredUsersFn } from "./lib/user-admin-client";

vi.mock("./lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/auth")>();
  return {
    ...actual,
    meFn: vi.fn().mockResolvedValue({ id: "test-user", name: "Pablo", email: "pablo@example.test" }),
  };
});

vi.mock("./lib/user-admin-client", () => ({
  listRegisteredUsersFn: vi.fn().mockResolvedValue({ status: "not_configured" }),
}));

function renderRoute(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history });
  return render(<RouterProvider router={router} />);
}

describe("Nex views smoke", () => {
  beforeEach(() => {
    vi.mocked(meFn).mockReset().mockResolvedValue({ id: "test-user", name: "Pablo", email: "pablo@example.test" });
    vi.mocked(listRegisteredUsersFn).mockReset().mockResolvedValue({ status: "not_configured" });
  });
  it("checks the session only once while navigating between studio views", async () => {
    renderRoute("/");
    await screen.findByRole("heading", { name: /tu estudio de contenido/i });
    expect(meFn).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("link", { name: "Biblioteca" }));
    await screen.findByRole("heading", { name: "Biblioteca" });
    expect(meFn).toHaveBeenCalledTimes(1);
  });
  it("shows a labeled shell skeleton while the session is loading", () => {
    render(<SessionShellSkeleton />);
    expect(screen.getByRole("status", { name: "Cargando tu estudio" })).toBeInTheDocument();
  });
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
  it("shows the registered-users section in settings", async () => {
    renderRoute("/ajustes");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Usuarios registrados" })).toBeInTheDocument());
  });
  it("shows registered-user details for an authorized administrator", async () => {
    vi.mocked(listRegisteredUsersFn).mockResolvedValue({
      status: "ready",
      total: 1,
      truncated: false,
      users: [{ name: "Ana", email: "ana@example.test", created_at: "2026-11-14 10:00:00", active_sessions: 1 }],
    });
    renderRoute("/ajustes");
    expect(await screen.findByText("ana@example.test")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Sesiones activas" })).toBeInTheDocument();
  });
  it("renders 404 for unknown route", async () => {
    renderRoute("/no-existe");
    await waitFor(() => expect(screen.getByText(/esta vista no existe/i)).toBeInTheDocument());
  });
});
