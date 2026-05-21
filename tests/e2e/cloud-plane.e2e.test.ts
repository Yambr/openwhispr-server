// SPDX-License-Identifier: FSL-1.1-ALv2
// tests/e2e/cloud-plane — R26 regression e2e for the Cloud plane.
//
// THE TEST THAT WOULD HAVE CAUGHT R24.
//
// R24: every Cloud-plane route (/api/transcribe, /api/reason,
// /api/agent/stream) returned HTTP 500 with `SsrfDispatcherNotInstalledError`
// in the real container — yet the in-memory `buildApp` unit/integration
// suite stayed green. The reason: `buildApp` tests never run
// `installGlobalSSRF()` (that is an `index.ts` entrypoint side-effect),
// and the litellm-client's `assertSsrfInstalled()` gate is skipped under
// the `opts.request` test seam. The SSRF-marker absence was therefore
// structurally invisible to every non-containerised test.
//
// This e2e closes that gap: it boots the REAL `docker compose` stack
// (hermetic mock LiteLLM — a mock at the network boundary, not a mock of
// internal logic, per CLAUDE.md), authenticates a fixture user, then
// drives all three Cloud-plane routes through Traefik+TLS and asserts
// NONE of them returns the R24 signature: HTTP 500 carrying
// `SsrfDispatcherNotInstalledError`.
//
// Acceptable outcomes per route (the round-trip is PROVEN by any of them):
//   * 200 — mock LiteLLM honored end-to-end.
//   * 502 — route registered, LiteLLM client invoked, upstream error
//     mapped to the canonical 502 envelope (mock LiteLLM does not honor
//     `mock_response` on the audio passthrough — see transcribe.e2e).
// What is NEVER acceptable:
//   * 500 + `SsrfDispatcherNotInstalledError` — the R24 blocker.
//   * 401 — the Cloud routes must accept the real session (Pitfall #8).
//
// It also asserts GET /api/ready returns 200 `{status:"ready"}` (R25):
// the readiness probe must agree the container is Cloud-capable.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { audioMultipartBody, BACKEND_URL } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

/**
 * Assert a Cloud-plane response is NOT the R24 blocker. The R24 failure
 * is specifically HTTP 500 whose JSON error envelope names the
 * `SsrfDispatcherNotInstalledError`. We read the body text once and
 * check both the status and the marker so a generic 500 from an
 * unrelated cause still fails the test loudly (no false green).
 */
async function assertNotSsrfBlocker(label: string, res: Response): Promise<string> {
  const bodyText = await res.text();
  expect(
    res.status,
    `${label}: expected NOT 401 — Cloud routes must accept the real session (body: ${bodyText})`,
  ).not.toBe(401);
  if (res.status === 500) {
    expect(
      bodyText,
      `${label}: HTTP 500 must NOT carry SsrfDispatcherNotInstalledError (R24 blocker)`,
    ).not.toMatch(/SsrfDispatcherNotInstalledError/i);
  }
  // A 500 from any other cause is still a Cloud-plane failure.
  expect(res.status, `${label}: unexpected HTTP 500 (body: ${bodyText})`).not.toBe(500);
  return bodyText;
}

const ReadyBody = z.object({
  status: z.literal("ready"),
  checks: z.object({
    ssrf_dispatcher: z.object({ ok: z.literal(true) }),
    litellm_client: z.object({ ok: z.literal(true) }),
    litellm_upstream: z.object({ ok: z.boolean() }),
  }),
});

describe("e2e — R26: Cloud plane survives the real container (R24 regression)", () => {
  it("GET /api/ready reports the container is Cloud-ready (R25)", async () => {
    const res = await fetch(`${BACKEND_URL}/api/ready`, { redirect: "manual" });
    expect(res.status).toBe(200);
    const body = ReadyBody.parse(await res.json());
    // SSRF dispatcher marker present at request time + LiteLLM client
    // constructed at boot — the two invariants R24/R25 protect.
    expect(body.checks.ssrf_dispatcher.ok).toBe(true);
    expect(body.checks.litellm_client.ok).toBe(true);
  });

  it("POST /api/transcribe does not return the R24 SSRF blocker", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const { body, contentType } = audioMultipartBody();
    const res = await jar.fetch(`${BACKEND_URL}/api/transcribe`, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    await assertNotSsrfBlocker("/api/transcribe", res);
    // 200 (mock honored) or 502 (upstream error) — both prove the
    // SSRF-wrapped LiteLLM client fired without the R24 gate rejecting.
    expect([200, 502]).toContain(res.status);
  });

  it("POST /api/reason does not return the R24 SSRF blocker", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/reason`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    await assertNotSsrfBlocker("/api/reason", res);
    expect([200, 502]).toContain(res.status);
  });

  it("POST /api/agent/stream does not return the R24 SSRF blocker", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/agent/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    const bodyText = await assertNotSsrfBlocker("/api/agent/stream", res);
    // On 200 the route streams NDJSON (one JSON object per line). On the
    // mock-LiteLLM upstream-error path it is the canonical 502 envelope.
    expect([200, 502]).toContain(res.status);
    if (res.status === 200) {
      const firstLine = bodyText.split("\n").find((l) => l.trim().length > 0) ?? "";
      // Each NDJSON frame is a standalone JSON object — parse must not throw.
      expect(() => JSON.parse(firstLine)).not.toThrow();
    }
  });
});
