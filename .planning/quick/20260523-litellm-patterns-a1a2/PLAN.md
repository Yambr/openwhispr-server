---
quick_id: 260523-a1a2
slug: litellm-patterns-a1a2
date: 2026-05-23
status: planned
---

# litellm-patterns A1 + A2 — two server-hardening fixes

Harvested from the LiteLLM v1.83.14 source study (clone at
`/Users/nick/ref-clones/litellm`). Both server-side, strict TDD.

## A1 — meaningful WS close code on a realtime upstream handshake failure

`apps/api/src/routes/realtime.ts` — the relay's `upstreamSocket.on("error")`
handler unconditionally `clientSocket.close(1011, "realtime upstream error")`
for every upstream failure class. The desktop client cannot tell a 401
(bad key) from a 503 (down) from a 429 (rate-limited).

Fix: add `upstreamSocket.on("unexpected-response", (req, res) => ...)` —
the `ws` client emits this on a rejected WS handshake with the HTTP
response. Map `res.statusCode` → a client-facing WS close code via a
pure extracted mapper:
- 401 / 403 → `1008` (policy violation), reason "realtime upstream unauthorized"
- 429 → `1013` (try again later), reason "realtime upstream rate limited"
- 5xx / other → `1011`, reason "realtime upstream unavailable"
Reason strings are FIXED per class, ≤120 chars, NEVER echo the upstream
body. Reuse the existing `closeBoth`/`safeCode` clamp. Keep the generic
`on("error")` 1011 fallback for non-handshake errors. Document a
T-03-07 close-behavior refinement in the realtime.ts file header.

## A2 — shape-based secret redaction BEFORE error-body truncation

`packages/litellm-client/src/errors.ts` — `LitellmUpstreamError`'s
constructor `bodyText.slice(0, 200)` truncates but does not redact; a
credential-shaped token in the first 200 chars survives into
`Error.message`.

Fix: new pure helper `redactSecretShapes(s: string): string` (new file
`packages/litellm-client/src/redact.ts`) replacing credential-shape
substrings with `[redacted]`. Shapes: `sk-…`, `sk-ant-…`, `AIza…`,
`AKIA…` + AWS secret, `Bearer ey…` JWT, PEM private-key blocks. Run
`bodyText` AND the optional `message` override through it BEFORE the
`.slice(0, 200)` in the constructor. Truncation stays — redaction is
additive, strengthening LOCKER-05.

## TDD (RED→GREEN, tests in the same atomic commit as each fix)

- A1: unit-test the pure status→close-code mapper; `realtime.test.ts`
  in-memory ws-pair gets a case per rejection class (401/503/429).
- A2: unit-test `redactSecretShapes` against the gitleaks fake-secret
  corpus (each shape redacted, a benign string untouched); a test
  pinning `LitellmUpstreamError.message` carries `[redacted]` not the
  `sk-…` when a secret is in the first 200 chars.

## Constraints

- LOCKER lints green. The secret-shape regexes in `redact.ts` are
  detection patterns — if LOCKER-03 (no-hardcode) trips on them, the
  file needs a tools/-style exemption; check and handle.
- tsc zero new errors (baseline 5: routes/index.ts FastifyPluginAsync
  ×3 + tokens/{assemblyai,deepgram}.ts).
- Two atomic commits (A1, A2) or one — executor's call.
