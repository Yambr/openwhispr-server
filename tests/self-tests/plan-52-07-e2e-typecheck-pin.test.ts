// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 52 / Plan 52-07 — pin the tests/e2e + mock-realtime typecheck
// fixes that surface under vitest 4.x + TS strict modes.
//
//   phase-05-*.spec.ts (TS1308) — `expect(() => ErrorEnvelope.parse(
//   await stt.json()))` uses `await` inside a non-async arrow.
//   Switching to `expect(async () => ...)` resolves the diagnostic
//   without changing test behaviour (vitest unwraps the async return).
//
//   tenant-isolation.test.ts (TS2307) — `await import("../../apps/api/
//   src/middleware/tenant.js")` references a module deleted in
//   Phase 34. The runtime try/catch handles the ENOENT; TS sees the
//   path statically and reports TS2307. Add `@ts-expect-error issue-
//   52-07-deleted-module` so the diagnostic is acknowledged.
//
//   mock-realtime/vitest.config.ts (TS2769) — vitest v4 removed the
//   `coverage.all: true` flag (now controlled by include/exclude only).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

describe("Plan 52-07 — e2e + mock-realtime typecheck", () => {
  const phase05Files = [
    "e2e/phase-05-config-endpoints.spec.ts",
    "e2e/phase-05-folders.spec.ts",
    "e2e/phase-05-notes.spec.ts",
    "e2e/phase-05-transcriptions.spec.ts",
  ];

  it.each(phase05Files)("%s uses async arrow on ErrorEnvelope.parse(await)", (rel) => {
    const src = readFileSync(resolve(ROOT, rel), "utf8");
    expect(src).toMatch(/expect\(async\s*\(\)\s*=>\s*ErrorEnvelope\.parse\(await/);
    // Pre-fix non-async form must not return.
    expect(src).not.toMatch(/expect\(\(\)\s*=>\s*ErrorEnvelope\.parse\(await/);
  });

  it("tenant-isolation.test.ts carries @ts-expect-error for deleted tenant.js", () => {
    const src = readFileSync(resolve(ROOT, "e2e/tenant-isolation.test.ts"), "utf8");
    expect(src).toMatch(/@ts-expect-error\s+issue-52-07-deleted-module/);
  });

  it("mock-realtime/vitest.config.ts dropped the removed coverage.all flag", () => {
    const src = readFileSync(resolve(ROOT, "e2e/mock-realtime/vitest.config.ts"), "utf8");
    expect(src).not.toMatch(/^\s*all:\s*true,/m);
  });
});
