---
phase: 33-envelope-encrypt-credentials
status: closed
closed: 2026-05-16
requirements_closed:
  - CRIT-FIX-02
  - LOCKER-PLAINTEXT-COLS
plans:
  - 33-01 (additive sidecars + fp indexes)
  - 33-02 (lens + boot validator)
  - 33-03 (Node-side backfill)
  - 33-04 (wrap-adapter wiring + 0019b SQL fn drop + oauth_state codec)
  - 33-05 (atomic closure — drop plaintext + LOCKER-PLAINTEXT-COLS + Rule 15)
---

# Phase 33 — Envelope encryption wired to Better Auth credential columns

**Source.** CRIT-FIX-02 (`.planning/review/data.md` CR-02) — the 8 Better Auth + OAuth credential columns (`account.{access_token, refresh_token, id_token, password}`, `verification.value`, `sessions.{token, previous_token}`, `oauth_state.code_verifier`) were stored as plaintext text columns at rest. Phase 33 closes that exposure by envelope-encrypting each column under a per-row AES-256-GCM data key (DEK), itself wrapped under a deploy-scoped master key (`MASTER_KEK`).

## Plans landed

| Plan | Subject | Atomic commits |
|---|---|---|
| 33-01 | Migration `0019_envelope_encrypt_secret_columns_add.sql` (48 nullable bytea sidecars + 2 sessions SHA-256 fingerprint columns + partial-unique indexes) | RED + GREEN |
| 33-02 | Encryption lens (`packages/data/src/encryption/lens.ts`) + boot validator (`validate-boot.ts`) | RED + GREEN |
| 33-03 | Node-side backfill migrator (`packages/data/src/encryption/backfill.ts`) | RED + GREEN |
| 33-04 | Wrap-adapter wiring in `apps/api/src/auth.ts`, `validateEncryptionBoot()` in api + worker entries, `oauth-state-codec.ts` at 3 sql-fragment sites, Node-side fp lookup, migration `0019b` drops `lookup_session_by_previous_token(text)` | 4 commits |
| 33-05 | **Atomic closure** — migration 0020 drops the 8 plaintext columns + plaintext indexes; flips `sessions.token_fp` to NOT NULL; promotes `sessions_token_fp_unique` to full UNIQUE. Drizzle schemas flipped to bytea-only. LOCKER-PLAINTEXT-COLS (DISCIPLINE Rule 15) introduced. `docs/security.md` §12 added. 5 Phase-32-deferred-Category-A tests deleted. | RED + GREEN |

## End-state invariants

- **Schema layer.** All 8 credential columns are envelope-encrypted bytea sidecars only. Plaintext column declarations refused by `tools/lint-no-plaintext-secret-columns.ts` (DISCIPLINE Rule 15 / LOCKER-PLAINTEXT-COLS / LOCKER-08 — BLOCKING from day one, no `--warn-only`, no allowlist).
- **Lookup.** `sessions.token_fp` is NOT NULL + full UNIQUE INDEX (`sessions_token_fp_unique`). `previous_token_fp` is nullable with a partial index for the AUTH-04 5-minute overlap window. The dropped SQL function `lookup_session_by_previous_token(text)` is replaced by `packages/data/src/sessions/lookup-by-previous-token.ts`.
- **Boot gate.** `validateEncryptionBoot()` runs from `apps/api/src/index.ts` and `apps/worker/src/index.ts`; exits 78 (BSD `EX_CONFIG`) on missing/short `MASTER_KEK` or unsupported `OPENWHISPR_KEY_PROVIDER`.
- **Defence-in-depth.** LOCKER-PLAINTEXT-COLS catches any future attempt to reintroduce plaintext columns at the schema layer.
- **Operator runbook.** `docs/security.md` §12 documents encryption scope, `MASTER_KEK` setup, KEK rotation, AWS / GCP / Azure / Vault KMS provisioning, rollback rescue.

## Atomic-invariant note (LOCKER-07 precedent)

Plan 33-05 ships its closure as a single atomic commit per the LOCKER-07 atomic-invariant established in Plan 31-07. The bundled artefacts (locker source + Rule 15 + CLAUDE.md mirror + lefthook/CI wiring + schema flip + migration + docs + e2e + obsolete-test deletions) cannot drift apart because they ride one commit boundary. The RED test (locker fixture assertions) lands in a paired prior commit per DISCIPLINE Rule 1 — the verifier accepts this two-commit RED + atomic-GREEN cadence per Phase 31 Plan 31-07 §D-2.

## What ships next

Phase 34 (`tenantPlugin` retirement / CR-1 closure) is now unblocked. Phase 33's bytea schema does not change the multi-tenant invariant; Phase 32's fail-closed RLS already guards every query under `withTenant()`. Phase 34 closes the residual `apps/api/src/middleware/tenant.ts` header-based escalation surface.

## Verification

Phase verifier (`gsd-verify-work 33`) should confirm:

- Both atomic commits (`99c00d8` RED + `f7fea28` GREEN-closure) on HEAD.
- `pnpm lint:lockers` exits 0 against `main`.
- `pnpm test:lint-no-plaintext-secret-columns` coverage ≥ 90/90/90/90.
- `E2E=1 vitest run tests/e2e/encryption-at-rest.test.ts` 3/3 GREEN.
- `.planning/REQUIREMENTS.md` CRIT-FIX-02 row Closed + LOCKER-PLAINTEXT-COLS row Complete.
- `.planning/ROADMAP.md` Phase 33 line `[x]`.
- DISCIPLINE.md Rule 15 + CLAUDE.md mirror prose present (grep for `LOCKER-PLAINTEXT-COLS`).

## Self-Check: PASSED
