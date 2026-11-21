import { describe, expect, it } from "vitest";
import { safeInternalDestination } from "./safe-next";

describe("safe internal login destination", () => {
  it("preserves a same-origin OAuth path and query", () => {
    expect(safeInternalDestination("/oauth/authorize?client_id=abc&state=opaque", "https://nex.example"))
      .toBe("/oauth/authorize?client_id=abc&state=opaque");
  });

  it.each([
    "https://attacker.example/",
    "//attacker.example/",
    "/\\attacker.example/",
  ])("rejects external redirect input %s", (input) => {
    expect(safeInternalDestination(input, "https://nex.example")).toBe("/");
  });

  it("uses the home page when next is absent or malformed", () => {
    expect(safeInternalDestination(null, "https://nex.example")).toBe("/");
    expect(safeInternalDestination("not-a-path", "https://nex.example")).toBe("/");
  });
});
