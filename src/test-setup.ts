import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ env: { nex_db: null, nex_assets: null } }));
if (typeof window !== "undefined") {
  window.scrollTo = () => {};
}
