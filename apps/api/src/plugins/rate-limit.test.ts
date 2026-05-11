// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-08 per 06-VALIDATION.md.
//
// Existing module (Phase 2 baseline): apps/api/src/plugins/rate-limit.ts
//
// Phase 6 extends with:
//   - Layered IP + user keying (D-RL1)
//   - Per-route rpm matrix locked in D-RL2
//   - X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset headers (D-RL3)
//   - Preserve Phase 2 /api/auth/verification-status 30/min/(IP,email) carve-out
//   - 429 envelope {error: "Too many requests"} unchanged (D-RL3)
//   - 429 emits audit_log security.rate_limit_exceeded (D-A6 #17)
//
// NOTE: a Phase 2 test file exists in apps/api/src/__tests__/rate-limit.test.ts; this
// per-plugin sibling file holds the Phase 6 D-RL extensions only.
import { describe, it } from "vitest";

const NOT_YET = "not yet implemented — Plan 06-08 implements layered rate-limit (D-RL1..3)";

describe("rate-limit layered keying (D-RL1)", () => {
  it("registers global IP-tier counter ~600/min/IP", () => {
    throw new Error(NOT_YET);
  });

  it("overlays per-route user-tier counter keyed by req.session.userId", () => {
    throw new Error(NOT_YET);
  });

  it("auto-degrades to IP keying when request is unauthenticated", () => {
    throw new Error(NOT_YET);
  });

  it("fires 429 when EITHER counter is exhausted (D-RL1)", () => {
    throw new Error(NOT_YET);
  });
});

describe("rate-limit per-route matrix (D-RL2 — locked numbers)", () => {
  it("/api/auth/signin: 10/min/IP", () => {
    throw new Error(NOT_YET);
  });

  it("/api/auth/signup: 10/min/IP", () => {
    throw new Error(NOT_YET);
  });

  it("/api/auth/forgot-password: 10/min/IP", () => {
    throw new Error(NOT_YET);
  });

  it("/api/auth/verification-status PRESERVES Phase 2 30/min/(IP,email) carve-out", () => {
    throw new Error(NOT_YET);
  });

  it("/api/transcribe: 20/min/user + 60/min/IP", () => {
    throw new Error(NOT_YET);
  });

  it("/api/reason: 30/min/user + 90/min/IP", () => {
    throw new Error(NOT_YET);
  });

  it("/api/agent/stream: 10/min/user + 30/min/IP", () => {
    throw new Error(NOT_YET);
  });

  it("/api/agent/web-search: 30/min/user + 90/min/IP (Phase 5 D-07 preserved)", () => {
    throw new Error(NOT_YET);
  });

  it("/api/v1/keys/create: 5/min/user + 20/min/IP", () => {
    throw new Error(NOT_YET);
  });

  it("/api/v1/keys/list and /api/v1/keys/revoke: 30/min/user + 90/min/IP", () => {
    throw new Error(NOT_YET);
  });

  it("/api/admin/*: 60/min/user + 300/min/IP", () => {
    throw new Error(NOT_YET);
  });

  it("/api/{notes,folders,conversations,transcriptions}/{create,update,delete}: 60/min/user + 300/min/IP", () => {
    throw new Error(NOT_YET);
  });

  it("/api/{notes,folders,...}/list and /search: 120/min/user + 600/min/IP", () => {
    throw new Error(NOT_YET);
  });

  it("probes /livez /readyz /startupz /api/health: SKIPPED (unlimited)", () => {
    throw new Error(NOT_YET);
  });
});

describe("rate-limit response shape (D-RL3)", () => {
  it("envelope is exactly {error: 'Too many requests'} (unchanged from Phase 2)", () => {
    throw new Error(NOT_YET);
  });

  it("sends X-RateLimit-Limit header (user-tier limit)", () => {
    throw new Error(NOT_YET);
  });

  it("sends X-RateLimit-Remaining header", () => {
    throw new Error(NOT_YET);
  });

  it("sends X-RateLimit-Reset header (epoch seconds)", () => {
    throw new Error(NOT_YET);
  });

  it("sends Retry-After header (Phase 2 preserved)", () => {
    throw new Error(NOT_YET);
  });

  it("emits audit_log row with action=security.rate_limit_exceeded (D-A6 #17)", () => {
    throw new Error(NOT_YET);
  });
});
