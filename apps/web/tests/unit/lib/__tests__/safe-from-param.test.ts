// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 68 / Plan 68-01 — REVIEW web HIGH HI-01.
//
// The sign-in middleware sets `?from=<pathname>` on its /sign-in redirect
// so a signed-out deep link can be recovered after authentication. The
// SignInForm previously discarded it and hardcoded `/app`. HI-01 consumes
// the param through a strict same-origin path allowlist:
//   - value MUST start with `/app/` OR equal `/app`
//   - value MUST NOT contain `://`
//   - value MUST NOT contain a backslash
//   - value MUST NOT start with `//` (protocol-relative)
// Any value failing the allowlist falls back to `/app`.

import { describe, expect, it } from "vitest";
import { safeFromParam } from "@/lib/safe-from-param";

describe("HI-01 — safeFromParam open-redirect allowlist", () => {
  it("HI-01: accepts an in-app deep link", () => {
    expect(safeFromParam("/app/notes/123")).toBe("/app/notes/123");
  });

  it("HI-01: accepts the bare /app path", () => {
    expect(safeFromParam("/app")).toBe("/app");
  });

  it("HI-01: rejects an absolute external URL → falls back to /app", () => {
    expect(safeFromParam("https://evil.com")).toBe("/app");
  });

  it("HI-01: rejects a protocol-relative URL → falls back to /app", () => {
    expect(safeFromParam("//evil.com")).toBe("/app");
  });

  it("HI-01: rejects a non-/app path → falls back to /app", () => {
    expect(safeFromParam("/etc/passwd")).toBe("/app");
  });

  it("HI-01: rejects a backslash-containing value → falls back to /app", () => {
    expect(safeFromParam("/app\\..\\evil")).toBe("/app");
  });

  it("HI-01: rejects an embedded scheme → falls back to /app", () => {
    expect(safeFromParam("/app/x?u=javascript://evil")).toBe("/app");
  });

  it("HI-01: absent (null) param → falls back to /app", () => {
    expect(safeFromParam(null)).toBe("/app");
  });

  it("HI-01: empty string → falls back to /app", () => {
    expect(safeFromParam("")).toBe("/app");
  });

  it("HI-01: a value equal to /application (prefix-only) → falls back to /app", () => {
    expect(safeFromParam("/application")).toBe("/app");
  });
});
