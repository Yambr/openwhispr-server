// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 04 / Plan 03 / Task 1 — shared undici provider-mint helper.
//
// Source of truth: 04-RESEARCH.md §2.5 (lines 441–484) + 04-CONTEXT.md
// D-18 (missing-key gating) + D-20 (3s connect / 5s total timeouts).
//
// Behavior:
//   * Single dedicated `Agent` with `connect: { timeout: 3000 }` so the
//     TCP-handshake stage cannot hang past 3s. Total budget enforced by an
//     `AbortController` armed for 5000ms — covers both connect-stall and
//     slow-body paths in one ceiling.
//   * Status mapping (D-18):
//       401 / 403  → 503 "<Label> not configured (set <ENV> in .env)"
//       429 / >=500 → 503 "<Label> token mint upstream error"
//       JSON parse fail → 503 "<Label> token mint malformed response"
//       any thrown / aborted → 503 "<Label> token mint timed out"
//   * Helper NEVER throws — every failure is encoded in the discriminated
//     union so route handlers can switch without try/catch ceremony.
//
// CLAUDE.md compliance: undici is the network process boundary; tests
// inject MockAgent at that exact boundary (allowed). No internal logic
// is mockable here — the helper has no DI seams beyond `opts`.
//
// undici is bundled with Node 24 as a global `fetch`, but we import
// explicitly so the dispatcher injection path used by tests
// (setGlobalDispatcher) is also reachable in production for tracing
// instrumentation later.

import { Agent, fetch, getGlobalDispatcher, setGlobalDispatcher } from "undici";

/** Bundled-default total per-call budget (connect + body). 5s per D-20.
 *
 *  D-20 also calls for a 3s connect-only ceiling. We install a process-wide
 *  `Agent({connect:{timeout:N}})` as the global dispatcher EXACTLY ONCE
 *  on first call (idempotent — re-entrant calls leave any test-injected
 *  MockAgent in place). The fetch call below then uses the global
 *  dispatcher rather than passing a per-call dispatcher, so vitest tests
 *  using `setGlobalDispatcher(mockAgent)` continue to intercept correctly.
 *  In production this gives connect-stalls a 3s ceiling and total-stalls a
 *  5s ceiling (AbortController).
 *
 *  Both ceilings are operator-tunable: production threads
 *  `PROVIDER_TOTAL_TIMEOUT_MS` / `PROVIDER_CONNECT_TIMEOUT_MS` from
 *  `apps/api/src/index.ts` (the env-reading boundary — LOCKER-01) into the
 *  per-call `opts.totalTimeoutMs` / `opts.connectTimeoutMs`. These literals
 *  stay ONLY as the fallback when no operator value is injected (test
 *  isolation or a deployment that never sets the env vars). */
const DEFAULT_TOTAL_TIMEOUT_MS = 5000;
const DEFAULT_CONNECT_TIMEOUT_MS = 3000;

let dispatcherInstalled = false;
function ensureProviderDispatcher(connectTimeoutMs: number): void {
  if (dispatcherInstalled) return;
  // Detect a real default Agent (no MockAgent / test override). Heuristic:
  // we own the global dispatcher only if its constructor name is "Agent"
  // (undici's default). Tests installing MockAgent leave dispatcherInstalled
  // false, but their MockAgent's name is "MockAgent" — we skip overwriting.
  const current = getGlobalDispatcher();
  if (current?.constructor?.name === "Agent") {
    setGlobalDispatcher(new Agent({ connect: { timeout: connectTimeoutMs } }));
  }
  dispatcherInstalled = true;
}

export interface CallProviderOptions {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  /** Env var name surfaced in the 503-not-configured message. */
  envVarName: string;
  /** Human-readable provider name surfaced in every 503 message. */
  providerLabel: string;
  /**
   * Operator-tunable total per-call budget (connect + body) in
   * milliseconds. Production threads `PROVIDER_TOTAL_TIMEOUT_MS` here from
   * the index.ts env-reading boundary; omitted callers fall back to
   * `DEFAULT_TOTAL_TIMEOUT_MS` (5000ms / D-20).
   */
  totalTimeoutMs?: number;
  /**
   * Operator-tunable TCP-handshake ceiling in milliseconds, applied when
   * this is the FIRST `callProvider` invocation that installs the
   * process-wide undici `Agent`. Production threads
   * `PROVIDER_CONNECT_TIMEOUT_MS` here; omitted callers fall back to
   * `DEFAULT_CONNECT_TIMEOUT_MS` (3000ms / D-20). Subsequent calls cannot
   * change the connect ceiling — the dispatcher is installed once.
   */
  connectTimeoutMs?: number;
}

export type CallProviderResult =
  | { ok: true; json: unknown }
  | { ok: false; status: 503; message: string }
  // Phase 56 / Plan 56-07 (R3 / D-2) — surface upstream 400 so callers
  // can choose to propagate the rejection instead of masking it as a
  // generic 503. Used by openai-realtime.ts to honor the contract that
  // an invalid `language` returned by OpenAI MUST reach the client as
  // a 400 (not get rewritten to a confusing "upstream error" 503). All
  // other 4xx statuses (401, 403) keep their existing 503 mapping.
  | { ok: false; status: 400; upstreamBody: unknown };

/**
 * Build the canonical 503 message for a given failure category. Centralized
 * so the four envelope strings (asserted by tests + acceptance criteria)
 * cannot drift across providers.
 */
function buildMessage(
  providerLabel: string,
  envVarName: string,
  kind: "not-configured" | "upstream-error" | "timed-out" | "malformed",
): string {
  switch (kind) {
    case "not-configured":
      return `${providerLabel} not configured (set ${envVarName} in .env)`;
    case "upstream-error":
      return `${providerLabel} token mint upstream error`;
    case "timed-out":
      return `${providerLabel} token mint timed out`;
    case "malformed":
      return `${providerLabel} token mint malformed response`;
  }
}

export async function callProvider(opts: CallProviderOptions): Promise<CallProviderResult> {
  ensureProviderDispatcher(opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
  try {
    // Phase 52 / Plan 52-04b — `exactOptionalPropertyTypes: true`
    // refuses `body: undefined` (RequestInit's body is optional, must
    // be omitted entirely when not present). Conditional spread keeps
    // the call shape clean.
    //
    // AUDIT-LIB-03 (LIB-5) — `AbortSignal.timeout()` is the Node 24
    // builtin for "abort after N ms"; it replaces a hand-rolled
    // AbortController + setTimeout + clearTimeout trio. The signal's
    // timer is internally unref'd, so no process-exit handle leaks and
    // there is nothing to clear in a `finally`.
    const res = await fetch(opts.url, {
      method: opts.method,
      headers: opts.headers,
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      signal: AbortSignal.timeout(opts.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS),
    });

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        status: 503,
        message: buildMessage(opts.providerLabel, opts.envVarName, "not-configured"),
      };
    }
    if (res.status === 429 || res.status >= 500) {
      return {
        ok: false,
        status: 503,
        message: buildMessage(opts.providerLabel, opts.envVarName, "upstream-error"),
      };
    }

    // Phase 56 / Plan 56-07 (R3 / D-2) — upstream 400 surfaces as a
    // first-class result so the caller can propagate it (e.g. invalid
    // `language` on OpenAI's session.create). Body is read best-effort:
    // on JSON parse failure we still emit a 400 variant carrying the
    // raw text so the caller can shape the client envelope without a
    // separate malformed branch.
    if (res.status === 400) {
      let upstreamBody: unknown;
      try {
        upstreamBody = await res.json();
      } catch {
        try {
          upstreamBody = await res.text();
        } catch {
          upstreamBody = null;
        }
      }
      return { ok: false, status: 400, upstreamBody };
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return {
        ok: false,
        status: 503,
        message: buildMessage(opts.providerLabel, opts.envVarName, "malformed"),
      };
    }
    if (json === null || typeof json !== "object") {
      return {
        ok: false,
        status: 503,
        message: buildMessage(opts.providerLabel, opts.envVarName, "malformed"),
      };
    }
    return { ok: true, json };
  } catch {
    // AbortError, undici dispatcher errors, DNS failures, connect refusals —
    // every reachable network failure surfaces as a transient 503 (D-20).
    return {
      ok: false,
      status: 503,
      message: buildMessage(opts.providerLabel, opts.envVarName, "timed-out"),
    };
  }
}

// Exported for branch-coverage tests if needed.
export const __test = { buildMessage };
