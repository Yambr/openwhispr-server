# Phase 08.5 — Deferred Items (out-of-scope discoveries)

Captured during the Wave 1+2 execution per CLAUDE.md scope boundary
("only auto-fix issues DIRECTLY caused by the current task's changes").

## 1. profile-lint.test.sh — stale service-name assertions

`tools/load-test/scripts/profile-lint.test.sh` queries
`services.mock-litellm` and `services.pgbouncer-1` but the actual
docker-compose.load-test.yml service names are `litellm` (mock override
of the base service) and `pgbouncer` (the base service re-stated). The
five failing assertions are:

- `load-test-mock MISSING service 'mock-litellm'`
- `load-test-mock MISSING service 'pgbouncer-1'`
- `pgbouncer-1 missing alias 'pgbouncer'`
- `pgbouncer-1 DEFAULT_POOL_SIZE=__MISSING__`
- `mock-litellm missing alias 'litellm'`

These predate Phase 08.5 (verified by `git stash && sh
profile-lint.test.sh` before any Wave-1 changes — same 7 failures, 5 of
which survive our targeted fixes). The test rewrite belongs in a
Phase 08-08 cleanup or an isolated documentation/test plan; rewriting
it inside Phase 08.5 would expand scope beyond the realistic-profile
deliverable and is forbidden by the scope-boundary rule.

Recommended next action: open Plan 08-08 (or a successor) task to align
the test against the canonical service names that have stood since
Phase 08-05.
