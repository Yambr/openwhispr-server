// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 / Plan 06-12b — debug-only outbound-fetch helper.
//
// Wire shape: POST /__test/fetch  body={url:string}  →  200 {status:number}
//             on success; 502 {error:"Upstream blocked by SSRF policy"} when
//             the global SSRF dispatcher (apps/api/src/bootstrap.ts) refuses
//             the connection; 404 in any non-test NODE_ENV.
//
// Purpose: the SSRF-block e2e (tests/e2e/ssrf-block.test.ts) needs an
//          in-process surface that drives `globalThis.fetch(url)` so the
//          process-wide undici dispatcher fires.  Production code paths
//          (Better Auth OIDC, LiteLLM client, web-search adapters, etc.)
//          all exercise the dispatcher indirectly; for an e2e that proves
//          the gate by pointing at AWS IMDS we need a direct, parameterised
//          entry point.  This route is THAT entry point.
//
// Security posture:
//   * Production veto (REVIEW api-core HIGH HI-02 / Phase 62): registration
//     is REFUSED outright when `NODE_ENV === 'production'`, regardless of
//     `OPENWHISPR_TEST_ROUTES`. A misset env flag copied from a dev `.env`
//     into a production deployment can no longer mount this route.
//   * Otherwise gated on `NODE_ENV === 'test'` OR the explicit
//     `OPENWHISPR_TEST_ROUTES=true` flag (the non-production compose
//     contract-test stack uses the env flag). The `apps/api/src/index.ts`
//     registration carries the SAME production veto + gate (defense in
//     depth, matches the pattern from apps/api/src/routes/test-only.ts).
//   * No auth.  No rate-limit.  The route exists exclusively for the
//     hermetic e2e stack which sets NODE_ENV=test on the api service.
//   * The fetched URL is NEVER returned to the caller — only the upstream
//     status code is echoed.  Response bodies are discarded.
//   * On SSRFBlockedError the global error handler (apps/api/src/error-
//     handler.ts) emits the canonical 502 envelope; the buildApp onError
//     hook (Plan 06-12b wiring in apps/api/src/index.ts) writes the
//     `security.ssrf_blocked` audit row alongside.
//
// CLAUDE.md "no mocks of internal logic": the route hits the REAL
// globalThis.fetch (which routes through the REAL SSRF dispatcher); the
// only injection seam is the optional `fetchImpl` parameter used by unit
// tests to verify control flow without standing up an HTTP server.

import type { FastifyInstance } from "fastify";
import { z } from "zod";

export interface DebugFetchDeps {
  /**
   * Override the fetch implementation. Defaults to `globalThis.fetch`
   * (which is wired to the SSRF-gated undici dispatcher via
   * setGlobalDispatcher in apps/api/src/bootstrap.ts).  Tests inject a
   * deterministic stub so they can assert routing/control flow without
   * a real network round-trip.
   */
  fetchImpl?: typeof globalThis.fetch;
}

const FetchBody = z.object({ url: z.string().min(1) });

const TEST_NODE_ENVS = new Set<string>(["test"]);

export function buildDebugFetchRoutes(deps: DebugFetchDeps = {}) {
  return async function debugFetchRoutes(app: FastifyInstance): Promise<void> {
    // Belt-and-suspenders gate at registration time: if a future caller
    // wires this plugin unconditionally (e.g. forgets the index.ts
    // gate), the registration becomes a no-op so production bundles
    // cannot accidentally expose the route. Plan 51-25 — also accept
    // the explicit `OPENWHISPR_TEST_ROUTES=true` env flag so the
    // non-production compose contract-test stack can drive this route.
    //
    // HI-02 (Phase 62): the `NODE_ENV !== "production"` term is an
    // absolute veto — it short-circuits the env-flag branch so a misset
    // `OPENWHISPR_TEST_ROUTES=true` in production never registers the
    // route. Same veto as apps/api/src/routes/test-only.ts (Phase 57
    // Track C) and the parallel gate in apps/api/src/index.ts.
    const gated =
      process.env.NODE_ENV !== "production" &&
      (TEST_NODE_ENVS.has(process.env.NODE_ENV ?? "") ||
        process.env.OPENWHISPR_TEST_ROUTES === "true");
    if (!gated) {
      return;
    }
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;

    app.route({
      method: "POST",
      url: "/__test/fetch",
      // Production safety is upheld by the registration-time NODE_ENV
      // gate above (and the parallel gate in apps/api/src/index.ts) —
      // by the time we're inside the handler, the route was registered
      // under NODE_ENV='test'.  We deliberately do NOT re-check
      // process.env per-request: it would be unreachable defensive code
      // that drags coverage on this file below the 90% floor.
      config: { auth: false, rateLimit: false },
      schema: { body: FetchBody },
      handler: async (req) => {
        const { url } = req.body as z.infer<typeof FetchBody>;
        // Drive the SSRF dispatcher via globalThis.fetch.  Any block
        // raises SSRFBlockedError synchronously from the connect.lookup
        // hook; Fastify routes that error to the global onError chain
        // (Plan 06-12b audit emission) and the error handler (Plan 06
        // 502 envelope).  We do NOT swallow the error here.
        // codeql[js/request-forgery] — intentional: this is a test-only
        // route whose SOLE purpose is to drive globalThis.fetch with a
        // caller-supplied URL so the process-wide SSRF dispatcher
        // (apps/api/src/bootstrap.ts) fires and tests/e2e/ssrf-block.test.ts
        // can prove the gate blocks AWS IMDS. The route is REFUSED outright
        // when NODE_ENV==='production' (registration-time veto above + the
        // parallel veto in apps/api/src/index.ts), so it is unreachable in
        // any production bundle. The real SSRF defence is the global undici
        // dispatcher — validating the URL here would defeat the test's intent.
        const res = await fetchImpl(url);
        // Read+discard the body so the upstream socket is released
        // promptly; we don't echo upstream content (would be a metadata
        // leak in the rare event of a successful response).
        await res.arrayBuffer().catch(() => undefined);
        return { status: res.status };
      },
    });
  };
}

export default buildDebugFetchRoutes;
