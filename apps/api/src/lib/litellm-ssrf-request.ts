// SPDX-License-Identifier: FSL-1.1-ALv2
// R24 — explicit per-client SSRF-wrapped dispatcher for the LiteLLM client.
//
// `buildLitellmClient` exposes an `opts.request` injection seam. Binding it
// at boot, in trusted code, to a `request` call that always passes the
// SSRF-wrapped Agent as the `dispatcher` means the LiteLLM client NEVER
// consults the mutable process-global dispatcher — so a stray
// `setGlobalDispatcher(new Agent())` from any other component (Better Auth,
// web-search adapters, tests) can no longer silently strip the SSRF marker
// and degrade every Cloud-plane route to a 500.
//
// This is NOT the per-call-dispatcher bypass that T-08.2-01 warns against:
// that warning is about exposing a `dispatcher` knob on the LitellmClient
// *public method surface*. Here the dispatcher is captured once by trusted
// boot code (the SSRF Agent built by `buildSsrfDispatcher`) and is never
// derived from user input — it is the sanctioned boot-time injection seam,
// the same one the test suite already uses.

import { type Dispatcher, request as undiciRequest } from "undici";

/**
 * Build a `request` function — shape-compatible with undici's `request` —
 * that pins every call to the supplied SSRF-wrapped `dispatcher`. Pass the
 * result as `buildLitellmClient(config, { request: makeSsrfBoundRequest(d) })`.
 */
export function makeSsrfBoundRequest(dispatcher: Dispatcher): typeof undiciRequest {
  return ((url, opts) =>
    undiciRequest(url, {
      ...opts,
      dispatcher,
    })) as typeof undiciRequest;
}
