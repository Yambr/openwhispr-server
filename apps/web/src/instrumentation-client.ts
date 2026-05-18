// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 53 / Plan 53-10 — Next.js 15 client bootstrap hook.
//
// `instrumentation-client.{js,ts}` is loaded synchronously BEFORE any
// other client code evaluates (documented in
// https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client).
// That ordering guarantee is exactly what we need to disable zod 4's
// JIT compiler before any schema chunk evaluates and triggers the
// `allowsEval` lazy feature-detector that probes `new Function("")`.
//
// Without this hook, zod-compiled schemas in shared chunks (e.g.
// chunk 6616) evaluate during the first React hydration tick — BEFORE
// theme-provider mounts and runs the side-effect import. The lazy
// detector caches `allowsEval === true` (or fires the CSP violation
// trying to find out) and the JIT path is locked in for the lifetime
// of the page.
//
// Importing `@/lib/zod-config` here calls `z.config({ jitless: true })`
// at the earliest possible moment in the client lifecycle. The
// `allowsEval` cache then short-circuits to `return false` without
// probing — no CSP violation, no JIT compile path.

import "@/lib/zod-config";
