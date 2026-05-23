---
slug: codeql-test-route-tree-ignore
created: 2026-05-23
completed: 2026-05-23
status: complete
---

# Summary — CodeQL paths-ignore `**/__test/**`

## What

CodeQL alert #20 (`js/request-forgery` at `apps/api/src/routes/__test/fetch.ts:100`) was a false positive: the route is a test-only Fastify probe refused at production-veto time. The existing `paths-ignore` covered `tests/**`, `**/__tests__/**`, fixtures, and `tools/test-probe/**` but not the singular `__test/` route tree convention.

## Fix

Added `**/__test/**` to `.github/codeql/codeql-config.yml` `paths-ignore`, with an 11-line rationale block explaining the production-veto + e2e SSRF probe role.

## Adjacent findings (no code change needed)

- CodeQL #14/#15/#17/#19 (4× `js/polynomial-redos`) — already mitigated in code with linear-time refactors (commits e8f48962, 186e35e4, prior). Alerts on main are stale, awaiting next CodeQL re-scan.
- CodeQL #21 (`js/clear-text-logging` in `apps/api/src/config/auth.ts:104`) — only `secret.length` (a number) is logged; a taint-flow false positive on the `secret` binding. Will dismiss via GitHub UI on next scan.
- CodeQL #33 (`js/missing-rate-limiting` in `apps/api/src/routes/setup-admin.ts:159`) — route already carries `config.rateLimit: { max: 5, timeWindow: "1 minute" }` (5/min/IP enforced by `@fastify/rate-limit`). LOCKER-04 contract structurally guarantees `rateLimit` on every route. False positive — will dismiss on next scan.

## Files

- `.github/codeql/codeql-config.yml` — +11 lines

## Commit

`<set after commit>`
