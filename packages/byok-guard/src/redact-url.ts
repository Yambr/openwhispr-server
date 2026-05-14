// SPDX-License-Identifier: Apache-2.0
// Phase 14 / Plan 04 / Task 1 — Vendored copy of apps/api/src/lib/redact-url.ts
// (Phase 13 HI-02 helper). Vendored rather than imported to keep
// `packages/byok-guard/` self-contained — the package is consumed by BOTH
// `apps/api` and `apps/worker` and a reverse `apps/api → packages/byok-guard`
// dependency would violate workspace boundaries (the `apps/*` <- `packages/*`
// import direction is one-way per the monorepo conventions).
//
// SOURCE OF TRUTH: apps/api/src/lib/redact-url.ts. If the helper is ever
// fixed there, port the change here. The helper is < 30 LoC and dependency-
// free, so this duplication is genuine vendoring (not a "mock of internal
// logic" per CLAUDE.md — both implementations exercise the real WHATWG URL
// parser; neither stubs the other).
//
// The redactor runs from the boot-time loud-fail path (assertBYOKConfig)
// where no observability is wired yet, so it must be tiny, synchronous,
// and infallible.

/**
 * Mask the `password` component of a URL-string to "***" before logging.
 *
 * @param raw - candidate URL string. Typical inputs are credential-bearing
 *   `S3_ENDPOINT`, `DATABASE_URL`, etc.
 * @returns the URL with `password=***` if parseable and credential-bearing,
 *   the URL unchanged if parseable and credential-free, or
 *   `"<unparseable-url>"` if `new URL(raw)` throws. Never throws.
 */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.password) {
      u.password = "***";
    }
    return u.toString();
  } catch {
    return "<unparseable-url>";
  }
}
