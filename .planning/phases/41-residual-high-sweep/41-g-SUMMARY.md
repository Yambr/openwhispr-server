---
phase: 41
sub_plan: g
title: Residual small-package HIGH sweep
status: complete
date_completed: 2026-05-16
---

# Phase 41.g — Residual small-package HIGH sweep

Closes three residual HIGH findings from the pre-publication review that
clustered in small / leaf packages, none of which justified a phase of their
own.

## Tasks

### Task 1 — HI-01: retire `@openwhispr/i18n` (commit `d7e7df7`)

The package was a Phase 0 placeholder that never grew beyond the
`isPlaceholder()` stub. Real i18n lives in `apps/api/src/i18n/init.ts`
(server-side, mounted in bootstrap) and `apps/web/src/locales/{en,ru}/`
(Phase 10 closure).

- Renamed `@openwhispr/i18n` → `@openwhispr/i18n-stub`, `private: true`.
- Deleted `locales/` from the package.
- Aligned `vitest.config.ts` to the stub name.
- Audited zero non-self importers under `apps/` and `packages/`.

Mirrors the Phase 38 `@openwhispr/auth` → `@openwhispr/auth-stub` precedent:
the load-bearing namespace is locked so a future squat cannot publish under
the name our codebase still references in the workspace tree.

### Task 2 — HI-02: byok-guard ↔ observability/redact parity test (commit `be0f5b6`)

Drift-as-failure parity test added at
`packages/observability/tests/unit/redact-providers-parity.test.ts`. Walks
`apps/{api,web,worker}/src` for every
`process.env.*_(API_KEY|SECRET|TOKEN|PASSWORD)` reference at test time and
asserts each surfaced env-var name appears in `REDACT_PATHS` (or is
family-covered by `api_key` / `password` / `secret` / `token` /
`bearer_token`).

Mirrors Phase 40.b's `redactUrl` drift test on the byok-guard side — the
two together close the loop without a shared-constants refactor.

**Implementation note:** the original draft used `git grep`; the pathspec
resolved differently under the vitest CWD vs. CLI shells in this monorepo
and returned silent zero matches. Replaced with a node `fs/promises`
recursive walk — CWD-independent, ~30 ms slower (irrelevant), zero stash
needed for resume. Documented in the test header so the next person to
touch the file does not re-introduce git-grep.

GREEN: 2 passed.

### Task 3 — HI-03: `SMTP_SECURE` strict-string parser (commit `dd444cb`)

`packages/email/src/EmailSender.ts:115` used `env.SMTP_SECURE === "true"`,
which silently rejected `1`, `TRUE`, `True`, `yes`, `on`, and any
whitespace-padded variant — exactly the spellings operators commonly
write in `.env` files. When `SMTP_SECURE` was provided as one of those
forms and the port heuristic (`port === 465`) said `false`, the transport
went out plaintext while the operator believed they had opted into TLS.

Replaced with `parseBoolEnv()` accepting `1` / `true` / `yes` / `on`
case-insensitive and trimmed. Added 15 new test cases (8 truthy × 7 falsy)
covering the full matrix. RED → GREEN cleanly.

GREEN: 41/41 passed (was 33/33 pre-fix + 8 new truthy + 7 new falsy − overlap).

## Verification

- `pnpm exec vitest run packages/observability/tests/unit/redact-providers-parity.test.ts` → 2 passed
- `pnpm exec vitest run packages/email/tests/unit/EmailSender.test.ts` → 41 passed
- `git log --oneline -5` on main confirms `d7e7df7`, `be0f5b6`, `dd444cb` are HEAD-reachable.
- `pnpm exec tsx tools/lint-no-hardcode.ts` (LOCKER-03) — clean (no shifts).

## Files touched

- `packages/i18n/package.json` (Task 1, `d7e7df7`)
- `packages/i18n/src/index.ts` (Task 1, `d7e7df7`)
- `packages/i18n/vitest.config.ts` (Task 1, `d7e7df7`)
- `packages/observability/tests/unit/redact-providers-parity.test.ts` (Task 2, `be0f5b6`)
- `packages/email/src/EmailSender.ts` (Task 3, `dd444cb`)
- `packages/email/tests/unit/EmailSender.test.ts` (Task 3, `dd444cb`)

## Decisions

See `41-g-DECISIONS.md` for the Task 1 rename rationale (D-41g-01).
Tasks 2 + 3 had no grey-area decisions; the bug and fix were both obvious
post-discovery.
