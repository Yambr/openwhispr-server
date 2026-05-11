// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-09 / 06-12 per 06-VALIDATION.md.
//
// Behavior locked by D-RL1, D-RL2, D-RL3 (SCALE-04 anti-abuse e2e):
//   - One user exceeds /api/transcribe 20/min/user → 429 with X-RateLimit-
//     Remaining: 0 (user-tier, per D-RL2).
//   - Many sessions from same IP exceed 60/min/IP on /api/transcribe →
//     429 (IP-tier triggered, per D-RL2).
//   - Polling carve-out /api/auth/verification-status 30/min/(IP,email)
//     still works concurrently (Phase 2 D-* carve-out preserved by D-RL3).
//
// Gated on E2E=1.
import { beforeAll, describe, expect, it } from "vitest";

const NOT_YET =
  "not yet implemented — Plan 06-09 lands layered rate-limit; Plan 06-12 wires this e2e (SCALE-04, D-RL1..3)";

describe.skipIf(process.env.E2E !== "1")("layered rate-limit e2e (SCALE-04, D-RL2, D-RL3)", () => {
  beforeAll(async () => {
    throw new Error(NOT_YET);
  }, 180_000);
  it("exceeds /api/transcribe 20/min/user as one user → 429 with X-RateLimit-Remaining: 0 per D-RL2", () => {
    expect.fail(NOT_YET);
  });

  it("exceeds 60/min/IP from many sessions on same IP → 429 (IP-tier) per D-RL2", () => {
    expect.fail(NOT_YET);
  });

  it("polling carve-out /api/auth/verification-status remains at 30/min/(IP,email) per D-RL3 (Phase 2 carve-out preserved)", () => {
    expect.fail(NOT_YET);
  });
});
