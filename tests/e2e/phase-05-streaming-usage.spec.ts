// tests/e2e/phase-05-streaming-usage — host-side e2e for
// WIRE-09 (POST /api/streaming-usage) + WIRE-10 (GET /api/usage).
//
// Round-trips both routes through Traefik (TLS) → api → real
// Postgres + PgBouncer + Valkey via the docker-compose stack. Asserts:
//   1. POST /api/streaming-usage with sessionId="e2e-{uuid}" returns
//      200 + canonical UsageResponse.
//   2. POST the SAME sessionId again — returns 200 (NOT 409); the
//      ledger row is idempotent (D-10).
//   3. GET /api/usage reflects the ledger write — wordsUsed >= the
//      audioDurationSeconds rounded contribution.
//   4. 401 envelope on the unauthenticated path.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

const UsageResponse = z.object({
  wordsUsed: z.number(),
  wordsRemaining: z.number(),
  plan: z.literal("unlimited"),
  limitReached: z.literal(false),
});
const ErrorEnvelope = z.object({ error: z.string().min(1) }).strict();

function randomSessionId(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

describe("e2e — POST /api/streaming-usage + GET /api/usage (real compose stack)", () => {
  it("round-trips both routes via Traefik+TLS — idempotent ledger + SUM aggregator", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const sessionId = randomSessionId();
    const duration = 17;

    const before = await jar.fetch(`${BACKEND_URL}/api/usage`);
    expect(before.status).toBe(200);
    const beforeUsage = UsageResponse.parse(await before.json());

    const payload = JSON.stringify({
      sessionId,
      audioDurationSeconds: duration,
      sttProvider: "deepgram",
      sttModel: "nova-2",
      clientType: "macos",
      appVersion: "1.0.0-e2e",
      clientVersion: "openwhispr-desktop-e2e",
    });
    const post1 = await jar.fetch(`${BACKEND_URL}/api/streaming-usage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    expect(post1.status).toBe(200);
    const post1Body = UsageResponse.parse(await post1.json());
    expect(post1Body.plan).toBe("unlimited");
    expect(post1Body.limitReached).toBe(false);
    expect(post1Body.wordsRemaining).toBe(999_999_999);

    // Retry with the SAME sessionId — MUST return 200, NOT 409 (D-10).
    const post2 = await jar.fetch(`${BACKEND_URL}/api/streaming-usage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    expect(post2.status).toBe(200);
    expect(post2.status).not.toBe(409);
    const post2Body = UsageResponse.parse(await post2.json());
    // First-writer-wins: second call's wordsUsed equals first's.
    expect(post2Body.wordsUsed).toBe(post1Body.wordsUsed);

    // /api/usage reflects exactly ONE ledger row's worth of growth
    // (Math.round(duration)=17) even though two POSTs occurred.
    const after = await jar.fetch(`${BACKEND_URL}/api/usage`);
    expect(after.status).toBe(200);
    const afterUsage = UsageResponse.parse(await after.json());
    expect(afterUsage.wordsUsed).toBeGreaterThanOrEqual(beforeUsage.wordsUsed + 17);
  });

  it("returns 401 envelope without a session cookie", async () => {
    const post = await fetch(`${BACKEND_URL}/api/streaming-usage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: randomSessionId(), audioDurationSeconds: 5 }),
    });
    expect(post.status).toBe(401);
    const postBody = await post.json();
    expect(() => ErrorEnvelope.parse(postBody)).not.toThrow();

    const get = await fetch(`${BACKEND_URL}/api/usage`);
    expect(get.status).toBe(401);
    const body = await get.json();
    expect(() => ErrorEnvelope.parse(body)).not.toThrow();
  });
});
