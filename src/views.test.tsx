/// <reference types="vitest/globals" />
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { beforeEach, vi } from "vitest";
import { routeTree } from "./routeTree.gen";
import { SessionShellSkeleton } from "./components/loading-skeletons";
import { meFn } from "./lib/auth";
import { listSocialAccountsFn } from "./lib/social";
import { listRegisteredUsersFn } from "./lib/user-admin-client";

vi.mock("./lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/auth")>();
  return {
    ...actual,
    meFn: vi.fn().mockResolvedValue({ id: "test-user", name: "Pablo", email: "pablo@example.test", password_change_required: false }),
  };
});

vi.mock("./lib/user-admin-client", () => ({
  listRegisteredUsersFn: vi.fn().mockResolvedValue({ status: "not_configured" }),
}));

vi.mock("./lib/social", () => ({ listSocialAccountsFn: vi.fn() }));

function renderRoute(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history });
  return render(<RouterProvider router={router} />);
}

describe("Nex views smoke", () => {
  beforeEach(() => {
    vi.mocked(meFn).mockReset().mockResolvedValue({ id: "test-user", name: "Pablo", email: "pablo@example.test", password_change_required: false });
    vi.mocked(listRegisteredUsersFn).mockReset().mockResolvedValue({ status: "not_configured" });
    vi.mocked(listSocialAccountsFn).mockReset().mockResolvedValue({ configured: { Instagram: false, TikTok: false }, accounts: [] });
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
  it("keeps both providers and each account independently connectable", async () => {
    const summary = { status: "conectada", connected_at: null, token_expires_at: null };
    vi.mocked(listSocialAccountsFn).mockResolvedValue({
      configured: { Instagram: true, TikTok: true },
      accounts: [
        { ...summary, platform: "Instagram", id: "ig-1", handle: "@ig-primera", token_expires_at: "2020-01-01T00:00:00Z" },
        { ...summary, platform: "Instagram", id: "ig-2", handle: "@ig-segunda" },
        { ...summary, platform: "TikTok", id: "tt-1", handle: "TikTok primera" },
        { ...summary, platform: "TikTok", id: "tt-2", handle: "TikTok segunda" },
      ],
    });
    renderRoute("/cuentas");
    const instagram = within(await screen.findByRole("region", { name: "Cuentas de Instagram" }));
    const tiktok = within(screen.getByRole("region", { name: "Cuentas de TikTok" }));
    expect(instagram.getByRole("link", { name: "Añadir cuenta de Instagram" })).toHaveAttribute("href", "/api/social/instagram/connect");
    expect(tiktok.getByRole("link", { name: "Añadir cuenta de TikTok" })).toHaveAttribute("href", "/api/social/tiktok/connect");
    expect(instagram.getByText("@ig-primera")).toBeInTheDocument();
    expect(instagram.getByText("@ig-segunda")).toBeInTheDocument();
    expect(instagram.getByText("Autorización vencida")).toBeInTheDocument();
    expect(tiktok.getByText("TikTok primera")).toBeInTheDocument();
    expect(tiktok.getByText("TikTok segunda")).toBeInTheDocument();

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    try {
      fireEvent.click(tiktok.getByRole("button", { name: "Desconectar TikTok segunda" }));
      expect(await tiktok.findByText("Desconectada")).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledWith("/api/social/tiktok/disconnect", expect.objectContaining({ body: JSON.stringify({ accountId: "tt-2" }) }));
      expect(tiktok.getByRole("button", { name: "Desconectar TikTok primera" })).toBeEnabled();
      expect(instagram.getByRole("button", { name: "Desconectar @ig-segunda" })).toBeEnabled();
    } finally {
      confirm.mockRestore();
      vi.unstubAllGlobals();
    }
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
