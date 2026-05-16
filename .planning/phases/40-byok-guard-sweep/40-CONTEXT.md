# Phase 40: byok-guard + contract-tests HIGH sweep — Context

**Source:** ROADMAP Phase 40 + `.planning/review/byok-guard-contract-tests.md` HI-1..3
**Closes:** HIGH-FIX-BYOK-01, -02, -03

## Three sub-fixes

### 40.a — HIGH-FIX-BYOK-01: package-boundary inversion

Current bug: `apps/api/src/routes/**` import schemas from `@openwhispr/contract-tests` (a test-helper package). Shipping contract-tests publicly drags a test harness into prod deps + couples API release cadence to a test package.

Fix:
1. Identify every schema imported by `apps/api/src/routes/**` from `@openwhispr/contract-tests` (grep `from "@openwhispr/contract-tests"`).
2. Move each schema source into `@openwhispr/wire-schemas` (extending Phase 39's clean schemas).
3. Update `apps/api/src/routes/**` imports to point at `@openwhispr/wire-schemas`.
4. Flip `packages/contract-tests/package.json` `private: true` (if not already).
5. Verify `pnpm --filter @openwhispr/api test` GREEN after refactor.

### 40.b — HIGH-FIX-BYOK-02: redactUrl completeness

Current bug: `redactUrl` only masks `URL.password`. Query-string credentials, AWS SigV4, bearer-in-path all pass through.

Fix:
1. Extend `packages/byok-guard/src/redact-url.ts` to also mask:
   - Query-string keys: `api_key`, `apikey`, `token`, `access_token`, `refresh_token`, `key`, `code`, `secret`, `X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Security-Token`, `signature`, `password`
   - URL userinfo `username` (not just password)
   - Bearer-token-shaped path segments: `/sk-[A-Za-z0-9_-]{20,}`, `/sk-ant-[A-Za-z0-9_-]{20,}`, `/AIza[A-Za-z0-9_-]{35,}`, `/AKIA[A-Z0-9]{16}`
2. Property test: 50 synthetic URLs covering each variant; all masked correctly.
3. **Drift-as-failure parity test:** at test time, grep `apps/**/src/**` + `packages/**/src/**` for every `process.env.*_API_KEY` reference; for each env var name, construct a synthetic URL containing the var name + a fake key shape; assert `redactUrl` masks it. New env var added to code without locker update → test fails.

### 40.c — HIGH-FIX-BYOK-03: fetchAndParse envelope enforcement

Current bug: `fetchAndParse` silently skips envelope validation when non-2xx + `text/plain` / empty / non-JSON body (`typeof body === "object"` guard short-circuits).

Fix:
1. In `packages/contract-tests/src/helpers/` (or wherever `fetchAndParse` lives), remove the `typeof body === "object"` guard.
2. Always run `ErrorEnvelope.parse()` on non-2xx; non-JSON/empty body → throw a typed `MalformedUpstreamEnvelopeError`.
3. Tests: non-JSON body (e.g., HTML 500 page) → raises typed error. Empty body → raises. Valid JSON envelope → parses.

## Approach

Three sub-fixes can be combined into 2-3 atomic commits. Coverage ≥ 90/90/90/90 on each diff. Phase 31 lockers active. Pre-flight stash user-side edits.

## Scope (out)

- Adding new redact patterns beyond the listed ones.
- Phase 41 residual sweep.
