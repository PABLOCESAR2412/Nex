import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ env: { nex_db: null, nex_assets: null } }));
if (typeof window !== "undefined") {
  window.scrollTo = () => {};
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, String(value)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });
}
