// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 53 / Plan 53-10 — disable zod 4 JIT-compilation globally.
//
// Zod 4 (≥ 4.0) ships a JIT compiler that turns schemas into `new
// Function(...args, body)` for speed. Browsers under a strict CSP
// (`script-src 'self' 'nonce-...' 'strict-dynamic' 'wasm-unsafe-eval'`
// — see apps/web/src/middleware.ts) block this at runtime with
// `CSP_VIOLATION blockedURI=eval`, and the schema falls back to the
// recursive walker AFTER a console-visible error.
//
// `z.config({ jitless: true })` is the documented zod-4 escape hatch
// for CSP-strict environments (zod core.d.ts: "Disable JIT schema
// compilation. Useful in environments that disallow `eval`."). It
// uses the same recursive walker the JIT path would have fallen back
// to — same semantics, slightly slower, zero CSP noise.
//
// This module has the side-effect of calling `z.config()` at import
// time. It MUST be imported once at the top of every entry point
// that boots zod schemas in a browser context (RSC root layout +
// client provider tree). Server-only code paths don't need it, but
// the import is cheap (a single `config()` call) so we apply it
// universally to avoid environment drift.

import { z } from "zod";

z.config({ jitless: true });
