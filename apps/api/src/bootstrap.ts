// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 / Plan 06 / SCALE-04 — process-wide SSRF dispatcher bootstrap.
//
// Imported by apps/api/src/index.ts AFTER `./otel-bootstrap.js` (so the
// OTel undici instrumentation sees the SSRF Agent as the upstream) and
// BEFORE any route registers or any outbound fetch fires.
//
// Side-effect: `setGlobalDispatcher(...)` registers the SSRF agent as
// the globalThis.fetch / undici default — every subsequent `fetch()`
// call from Better Auth OIDC redirects, the LiteLLM client, Tavily/
// Yandex web-search adapters, pyannote.ai, and any future user-URL
// fetching feature goes through the gate.

import { makePino } from "@openwhispr/observability";
import { type Dispatcher, setGlobalDispatcher } from "undici";
import { loadSSRFConfig, type SSRFConfig } from "./config/ssrf.js";
import {
  makeSSRFDispatcher,
  SSRF_WRAPPED_MARKER,
  type SSRFBlockContext,
} from "./lib/ssrf-dispatcher.js";

// Phase 51 / Plan 51-13b (REVIEW api-core HIGH HI-02) — bootstrap pino
// logger. `makePino()` applies the canonical REDACT_PATHS policy so any
// accidental credential-shaped field in the SSRF block context is
// scrubbed before it reaches Loki.
const ssrfLog = makePino({ base: { name: "ssrf.guard" } });

/**
 * Default audit hook — emits a structured WARN line per D-S5. The
 * audit_log INSERT (action='security.ssrf_blocked') is wired by the
 * caller of the outbound request via the global error handler when
 * SSRFBlockedError surfaces; warn-mode rows are recorded by the same
 * pathway from a follow-up route-level hook in Wave 1.
 */
export function defaultOnBlock(ctx: SSRFBlockContext): void {
  ssrfLog.warn(
    {
      event: "security.ssrf_blocked",
      target_url_host: ctx.host,
      ip: ctx.ip,
      rule: ctx.rule,
      mode: ctx.mode,
    },
    "outbound request blocked by SSRF guard",
  );
}

/**
 * Build (but do NOT install) an SSRF-wrapped undici `Dispatcher` from the
 * same config-loading path used by `installGlobalSSRF`. This is the SINGLE
 * construction site for the SSRF Agent.
 *
 * R24 — the returned dispatcher carries the non-enumerable
 * `SSRF_WRAPPED_MARKER` and can be bound explicitly to the LiteLLM client's
 * `opts.request` seam at boot, so the LiteLLM client never consults the
 * mutable process-global dispatcher (which a stray `setGlobalDispatcher`
 * call after boot could silently clobber).
 *
 * Throws if `makeSSRFDispatcher` somehow returns a dispatcher that does NOT
 * carry the marker — `installGlobalSSRF` is a non-optional bootstrap step
 * and a marker-less dispatcher would silently degrade every Cloud-plane
 * route to a 500 (R25 fail-fast: crash-loop instead of serving 500s).
 *
 * @param overrides Test-only injection point for config + onBlock.
 */
export function buildSsrfDispatcher(overrides?: {
  config?: SSRFConfig;
  onBlock?: (ctx: SSRFBlockContext) => void;
}): Dispatcher {
  const cfg = overrides?.config ?? loadSSRFConfig();
  const dispatcher = makeSSRFDispatcher({
    allowedHosts: cfg.OUTBOUND_ALLOWED_HOSTS,
    privateHostAllowlist: cfg.OUTBOUND_PRIVATE_HOST_ALLOWLIST,
    allowLoopback: cfg.OUTBOUND_ALLOW_LOOPBACK,
    mode: cfg.OUTBOUND_SSRF_MODE,
    onBlock: overrides?.onBlock ?? defaultOnBlock,
  });
  // R25 boot fail-fast — refuse to proceed on a non-installable state.
  // Single `as` narrow (LOCKER-02 clean) mirrors `assertSsrfInstalled`.
  const marked = dispatcher as Dispatcher & { [k: symbol]: unknown };
  if (!marked[SSRF_WRAPPED_MARKER]) {
    throw new Error(
      "bootstrap: makeSSRFDispatcher returned a dispatcher missing SSRF_WRAPPED_MARKER",
    );
  }
  return dispatcher;
}

/**
 * Install the SSRF dispatcher as the global undici dispatcher.
 * Idempotent — safe to call from tests that re-import the module.
 *
 * Returns the installed `Dispatcher` so `index.ts` can bind it explicitly
 * to the LiteLLM client's `opts.request` seam (R24) while ALSO keeping it
 * registered as the process-global for Better Auth / web-search adapters.
 *
 * @param overrides Test-only injection point for config + onBlock.
 */
export function installGlobalSSRF(overrides?: {
  config?: SSRFConfig;
  onBlock?: (ctx: SSRFBlockContext) => void;
}): Dispatcher {
  const dispatcher = buildSsrfDispatcher(overrides);
  setGlobalDispatcher(dispatcher);
  return dispatcher;
}
