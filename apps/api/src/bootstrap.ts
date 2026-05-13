// SPDX-License-Identifier: Apache-2.0
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

import { setGlobalDispatcher } from "undici";
import { loadSSRFConfig, type SSRFConfig } from "./config/ssrf.js";
import { makeSSRFDispatcher, type SSRFBlockContext } from "./lib/ssrf-dispatcher.js";

/**
 * Default audit hook — emits a structured WARN line per D-S5. The
 * audit_log INSERT (action='security.ssrf_blocked') is wired by the
 * caller of the outbound request via the global error handler when
 * SSRFBlockedError surfaces; warn-mode rows are recorded by the same
 * pathway from a follow-up route-level hook in Wave 1.
 */
export function defaultOnBlock(ctx: SSRFBlockContext): void {
  // biome-ignore lint/suspicious/noConsole: bootstrap-time structured event; pino unavailable here
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "security.ssrf_blocked",
      target_url_host: ctx.host,
      ip: ctx.ip,
      rule: ctx.rule,
      mode: ctx.mode,
    }),
  );
}

/**
 * Install the SSRF dispatcher as the global undici dispatcher.
 * Idempotent — safe to call from tests that re-import the module.
 *
 * @param overrides Test-only injection point for config + onBlock.
 */
export function installGlobalSSRF(overrides?: {
  config?: SSRFConfig;
  onBlock?: (ctx: SSRFBlockContext) => void;
}): void {
  const cfg = overrides?.config ?? loadSSRFConfig();
  const dispatcher = makeSSRFDispatcher({
    allowedHosts: cfg.OUTBOUND_ALLOWED_HOSTS,
    privateHostAllowlist: cfg.OUTBOUND_PRIVATE_HOST_ALLOWLIST,
    allowLoopback: cfg.OUTBOUND_ALLOW_LOOPBACK,
    mode: cfg.OUTBOUND_SSRF_MODE,
    onBlock: overrides?.onBlock ?? defaultOnBlock,
  });
  setGlobalDispatcher(dispatcher);
}
