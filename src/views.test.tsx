/// <reference types="vitest/globals" />
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { beforeEach, vi } from "vitest";
import { routeTree } from "./routeTree.gen";
import { SessionShellSkeleton } from "./components/loading-skeletons";
import { meFn } from "./lib/auth";
import { listContentFn } from "./lib/content";
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
vi.mock("./lib/content", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/content")>(),
  listContentFn: vi.fn(),
}));

function renderRoute(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history });
  return render(<RouterProvider router={router} />);
}

describe("Nex views smoke", () => {
  beforeEach(() => {
    vi.mocked(meFn).mockReset().mockResolvedValue({ id: "test-user", name: "Pablo", email: "pablo@example.test", password_change_required: false });
    vi.mocked(listRegisteredUsersFn).mockReset().mockResolvedValue({ status: "not_configured" });
    vi.mocked(listSocialAccountsFn).mockReset().mockResolvedValue({ configured: { Instagram: false, TikTok: false, Buffer: false }, accounts: [] });
    vi.mocked(listContentFn).mockReset().mockResolvedValue([]);
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
    const summary = { provider: "nex" as const, status: "conectada", connected_at: null, token_expires_at: null };
    vi.mocked(listSocialAccountsFn).mockResolvedValue({
      configured: { Instagram: true, TikTok: true, Buffer: false },
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
  it("imports Buffer channels on request and keeps them separate from direct accounts", async () => {
    const summary = { status: "conectada", connected_at: null, token_expires_at: null };
    const configured = { Instagram: true, TikTok: false, Buffer: true };
    const direct = { ...summary, platform: "Instagram", provider: "nex", id: "ig-direct", handle: "@estudio" } as const;
    vi.mocked(listSocialAccountsFn)
      .mockResolvedValueOnce({ configured, accounts: [direct] })
      .mockResolvedValueOnce({
        configured,
        accounts: [
          direct,
          { ...summary, platform: "Instagram", provider: "buffer", id: "ig-buffer", handle: "@estudio" },
          { ...summary, platform: "TikTok", provider: "buffer", id: "tt-buffer", handle: "@otra-cuenta", status: "requiere_atencion" },
        ],
      });
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, synced: 2 }));
    vi.stubGlobal("fetch", fetch);
    try {
      renderRoute("/cuentas");
      const buffer = within(await screen.findByRole("region", { name: "Cuentas de Buffer" }));
      expect(fetch).not.toHaveBeenCalled();
      fireEvent.click(buffer.getByRole("button", { name: "Sincronizar canales" }));
      expect(await buffer.findByText("Instagram · Buffer")).toBeInTheDocument();
      expect(buffer.getByText("TikTok · Buffer")).toBeInTheDocument();
      expect(buffer.getByText("Requiere atención")).toBeInTheDocument();
      const instagram = within(screen.getByRole("region", { name: "Cuentas de Instagram" }));
      expect(instagram.getByText("Instagram · Conexión directa")).toBeInTheDocument();
      expect(instagram.queryByText("Instagram · Buffer")).not.toBeInTheDocument();
      expect(fetch).toHaveBeenCalledWith("/api/social/buffer/sync", { method: "POST" });
      expect(screen.getByText("Se sincronizaron 2 canales de Buffer.")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("requires confirmation and checks the specific Buffer destination selected in the library", async () => {
    const account = { status: "conectada", connected_at: null, token_expires_at: null };
    vi.mocked(listSocialAccountsFn).mockResolvedValue({
      configured: { Instagram: true, TikTok: false, Buffer: true },
      accounts: [
        { ...account, id: "ig-direct", platform: "Instagram", handle: "@estudio", provider: "nex" },
        { ...account, id: "ig-buffer", platform: "Instagram", handle: "@estudio", provider: "buffer" },
        { ...account, id: "tt-buffer", platform: "TikTok", handle: "@otra-cuenta", provider: "buffer" },
      ],
    });
    vi.mocked(listContentFn).mockResolvedValue([{
      id: "video-id", title: "Video aprobado", description: "Texto guardado", script: null, type: "video",
      state: "aprobada", channels: null, asset_key: "private-key", asset_name: "video.mp4",
      asset_content_type: "video/mp4", asset_size: 100, scheduled_at: null,
      created_at: "2026-11-26T10:00:00Z", updated_at: "2026-11-26T10:00:00Z",
    }]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ jobId: "buffer-job", status: "awaiting_user", detail: "Aprueba esta publicación en Buffer." }))
      .mockResolvedValueOnce(Response.json({ jobId: "buffer-job", status: "published" }));
    vi.stubGlobal("fetch", fetch);
    try {
      renderRoute("/biblioteca");
      const destination = await screen.findByRole("combobox", { name: "Cuenta de destino" });
      expect(within(destination).getByRole("option", { name: "Instagram · @estudio · Conexión directa" })).toBeInTheDocument();
      expect(within(destination).getByRole("option", { name: "Instagram · @estudio · Buffer" })).toBeInTheDocument();
      expect(within(destination).getByRole("option", { name: "TikTok · @otra-cuenta · Buffer" })).toBeInTheDocument();

      fireEvent.change(destination, { target: { value: "ig-buffer" } });
      const send = screen.getByRole("button", { name: "Enviar a Buffer" });
      fireEvent.click(send);
      expect(fetch).not.toHaveBeenCalled();
      fireEvent.click(send);
      expect(await screen.findByText("Aprueba esta publicación en Buffer.")).toBeInTheDocument();
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Video aprobado"));
      expect(fetch).toHaveBeenNthCalledWith(1, "/api/social/buffer/publish", expect.objectContaining({
        body: JSON.stringify({ action: "start", contentId: "video-id", accountId: "ig-buffer" }),
      }));

      fireEvent.click(screen.getByRole("button", { name: "Consultar estado" }));
      expect(await screen.findByText("Video publicado para @estudio en Instagram.")).toBeInTheDocument();
      expect(fetch).toHaveBeenNthCalledWith(2, "/api/social/buffer/publish", expect.objectContaining({
        body: JSON.stringify({ action: "check", jobId: "buffer-job" }),
      }));
      expect(confirm).toHaveBeenCalledTimes(2);
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
