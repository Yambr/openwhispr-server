// SPDX-License-Identifier: FSL-1.1-ALv2
// tests/e2e/agent-stream-first-line-latency.test.ts
//
// Phase 04 / Plan 09 / Task 2 — closes WIRE-07 SC#1 through the FULL
// real Traefik chain (api.localhost:443 → Traefik → Fastify api → undici
// → LiteLLM contract config → mock_response → SSE → NDJSON line-flush).
//
// LOAD-BEARING ASSERTIONS:
//   1. (t_first - t0) < 500ms ROUND-TRIP — Phase Goal SC#1.
//      t0 is taken IMMEDIATELY BEFORE fetch(); t_first is the first
//      response body byte. Headers-relative timing is logged for
//      diagnostics ONLY (NOT a pass/fail gate).
//   2. status === 200 + content-type === 'application/x-ndjson'.
//   3. Per-line cadence: max(delta_i) < 200ms (no end-of-response
//      bunching that would indicate proxy buffering).
//   4. Last line parses to {type: 'finish', ...}.
//   5. X-Accel-Buffering response header preserved through Traefik = 'no'.
//
// Test setup notes:
//   * Bearer obtained via signInFixture (cookie-based — Better Auth's
//     trustedOrigins allow https://api.localhost; the route's dualAuth
//     hook accepts cookie OR bearer).
//   * Self-signed Traefik cert: process.env.NODE_TLS_REJECT_UNAUTHORIZED
//     = '0' is set in tests/e2e/setup.ts globalSetup. This file does
//     NOT need any cert wiring of its own.
//   * Streaming model = 'qwen3.6-plus-streaming' (Plan 08 D-29 mock
//     entry mirrored into litellm_config.e2e-realtime.yaml — emits 3
//     SSE chunks at LiteLLM's default ~50ms cadence).
//
// CLAUDE.md `no mocks of internal logic`: this test mocks NOTHING.
// Every hop is real (Traefik, Fastify, undici, LiteLLM, mock_response).

import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { BACKEND_URL } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

interface ParsedNdjsonLine {
  raw: string;
  parsed: Record<string, unknown>;
  observedAtMs: number;
}

describe("e2e — POST /api/agent/stream first-line latency (WIRE-07 SC#1)", () => {
  it("first NDJSON byte arrives < 500ms ROUND-TRIP through real Traefik chain", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const cookie = await jar.jar.getCookieString(BACKEND_URL);
    expect(cookie.length).toBeGreaterThan(0);

    // ── LOAD-BEARING TIMING START ───────────────────────────────────
    // t0 captured IMMEDIATELY BEFORE fetch() so the assertion measures
    // the full client-perceived round-trip (TLS hop + Traefik routing
    // + Fastify handler + undici → LiteLLM → first SSE frame → NDJSON
    // emit → first TCP segment back to client). NOT t_headers-relative.
    const t0 = performance.now();
    const res = await fetch(`${BACKEND_URL}/api/agent/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hi" }],
        model: "qwen3.6-plus-streaming",
      }),
    });
    const tHeaders = performance.now();

    // Wire-shape assertions — fail loudly BEFORE the timing check so
    // a misconfigured route doesn't masquerade as a slow first byte.
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("application/x-ndjson");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    // Read the body via getReader() so we can mark t_first at the
    // EXACT moment the first byte arrives (no .text() / .json()
    // buffering layer in between).
    const reader = res.body!.getReader();
    const { value: firstChunk, done: doneEarly } = await reader.read();
    const tFirst = performance.now();
    expect(doneEarly).toBe(false);
    expect(firstChunk).toBeDefined();
    expect(firstChunk!.byteLength).toBeGreaterThan(0);

    const roundTripMs = tFirst - t0;
    const headersRelMs = tFirst - tHeaders;
    // Diagnostic log only — headers-relative is NOT load-bearing.
    // eslint-disable-next-line no-console
    console.log(
      `[WIRE-07 SC#1] round-trip(t_first - t0)=${roundTripMs.toFixed(2)}ms ` +
        `headers-rel(t_first - t_headers)=${headersRelMs.toFixed(2)}ms`,
    );
    expect(roundTripMs).toBeLessThan(500);

    // ── Per-line cadence assertion (Test 2 in plan behavior) ────────
    // Decode every NDJSON line as it arrives, capturing observedAt
    // for each. Computes deltas after the read loop finishes.
    const decoder = new TextDecoder();
    let buffer = decoder.decode(firstChunk, { stream: true });
    const lines: ParsedNdjsonLine[] = [];
    const harvest = (now: number) => {
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const raw = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (raw.length > 0) {
          try {
            lines.push({ raw, parsed: JSON.parse(raw), observedAtMs: now });
          } catch {
            // Per Plan 08 contract: every NDJSON line MUST parse —
            // a parse failure is a WIRE-07 violation, surface it.
            throw new Error(`NDJSON line did not parse: ${raw.slice(0, 200)}`);
          }
        }
        nl = buffer.indexOf("\n");
      }
    };
    harvest(tFirst);
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const now = performance.now();
      buffer += decoder.decode(value, { stream: true });
      harvest(now);
    }
    // Flush any trailing partial.
    buffer += decoder.decode();
    const tEnd = performance.now();
    harvest(tEnd);

    expect(lines.length).toBeGreaterThanOrEqual(1);

    // Per-line gap deltas — first line baseline is observedAt - tFirst
    // (which is 0 by construction); subsequent gaps are i to i-1.
    const deltas: number[] = [];
    for (let i = 1; i < lines.length; i += 1) {
      deltas.push(lines[i]!.observedAtMs - lines[i - 1]!.observedAtMs);
    }
    const maxDelta = deltas.length === 0 ? 0 : Math.max(...deltas);
    // eslint-disable-next-line no-console
    console.log(`[WIRE-07 SC#1] lines=${lines.length} max-per-line-gap=${maxDelta.toFixed(2)}ms`);
    expect(maxDelta).toBeLessThan(200);

    // ── Terminal finish chunk (Test 3) ──────────────────────────────
    const last = lines[lines.length - 1]!;
    expect(last.parsed.type).toBe("finish");
  }, 60_000); // if the global testTimeout ever changes. // this test only exercises one POST). Keeps regression noise low // Per-test override: 60s is plenty (compose stack is already up;
});
