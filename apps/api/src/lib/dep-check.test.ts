// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-06 per 06-VALIDATION.md.
//
// Production module (not yet created): apps/api/src/lib/dep-check.ts
//
// Behaviors locked by D-P2:
//   - 5s TTL cache via lru-cache (or equivalent), keyed by dep name
//   - Promise-dedup: concurrent probes share a single upstream call per dep
//   - Three dep names: 'postgres', 'valkey', 'litellm'
//   - checkPostgres uses cheap SELECT 1
//   - checkValkey uses PING
//   - checkLitellm uses /health with 2s timeout
import { describe, it } from "vitest";

const NOT_YET = "not yet implemented — Plan 06-06 implements apps/api/src/lib/dep-check.ts (D-P2)";

describe("dep-check (D-P2)", () => {
  it("caches each dep result for 5s TTL", () => {
    throw new Error(NOT_YET);
  });

  it("dedupes concurrent probes — one upstream call per cache window", () => {
    throw new Error(NOT_YET);
  });

  it("exposes checkPostgres, checkValkey, checkLitellm", () => {
    throw new Error(NOT_YET);
  });

  it("checkPostgres runs SELECT 1 (cheap roundtrip)", () => {
    throw new Error(NOT_YET);
  });

  it("checkValkey runs PING", () => {
    throw new Error(NOT_YET);
  });

  it("checkLitellm calls /health with 2s timeout", () => {
    throw new Error(NOT_YET);
  });

  it("returns unhealthy on upstream timeout (does not hang the probe)", () => {
    throw new Error(NOT_YET);
  });

  it("returns unhealthy on upstream error", () => {
    throw new Error(NOT_YET);
  });

  it("re-checks after TTL expiry (single re-check, not stampede)", () => {
    throw new Error(NOT_YET);
  });
});
