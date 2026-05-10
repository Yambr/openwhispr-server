# Phase 04 — Deferred Items (out-of-scope discoveries during execution)

## From Plan 04-08 execution (2026-05-11)

### Pre-existing apps/api typecheck errors (out-of-scope per scope-boundary rule)

The following typecheck errors existed BEFORE Plan 04-08 work began (verified via
`pnpm --filter @openwhispr/api typecheck` against base commit f6f5715). None are
caused by the new test files added by this plan.

1. `src/routes/realtime.ts` — `wsReconnect: false` typing incompatibility with
   `@fastify/http-proxy`'s `WebSocketReconnectOptions` (the lib added a richer
   reconnect-options shape; passing `false` no longer matches). Suggested fix:
   omit the field (false is the default behavior) or upgrade the consumer to
   the new options shape.
2. `src/routes/test-only.test.ts:240,399` — `exactOptionalPropertyTypes` violations
   on `litellm: LitellmClient | undefined` and an arity mismatch on a factory call.
3. `src/routes/tokens/_call-provider.ts:99` — `body: string | undefined` not
   assignable to `BodyInit` under `exactOptionalPropertyTypes`. Wrap as
   `{ ...(body !== undefined ? { body } : {}) }`.
4. `src/routes/tokens/openai-realtime.test.ts:157,310-311` — `secrets[0]` possibly
   undefined (TS strict-index signature). Add non-null assertion or guard.

These items belong in a future debt-closure phase (analogous to Phase 02.4 / Phase-2
coverage debt back-fill). Plan 04-08 ships only NEW files which all typecheck clean.
