---
phase: v2.2-close-audit
reviewed: 2026-05-16T00:00:00Z
depth: standard
head: b830cc44b65f56ebdc2ebacd789e93df481788d8
scope: packages/{auth,email,i18n,observability}/src/**
files_reviewed: 6
files_reviewed_list:
  - packages/auth/src/index.ts
  - packages/auth/package.json
  - packages/email/src/EmailSender.ts
  - packages/email/src/index.ts
  - packages/i18n/src/index.ts
  - packages/i18n/package.json
  - packages/observability/src/redact.ts
findings:
  critical: 0
  blocker: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Re-Review v2.2-Close: small-pkgs (auth, email, i18n, observability)

**Reviewed:** 2026-05-16
**Depth:** standard
**HEAD:** `b830cc4` (docs(41): close phase 41)
**Prior review:** `.planning/review/small-pkgs.md` (branch main @ 1832f28)

## Summary

Pre-publication audit verifying that the three HIGH findings from the prior small-pkgs review are closed by Phase 41.g + Phase 38. Two of three close cleanly. One (HI-02 redact/byok parity) closes **only for the original 8 env-key surface** but **regresses against the actual code base** — six provider env-keys read by production code at HEAD are **not** in `REDACT_PATHS`. Stance: not-publishable as-is without either tightening `REDACT_PATHS` or shipping the parity contract test the original HI-02 fix called for.

## Closure delta (prior review → HEAD b830cc4)

| Prior ID | Severity | Status at HEAD | Evidence |
|---|---|---|---|
| **CR-01** auth = publicly-named placeholder | CRITICAL | **CLOSED** | `packages/auth/package.json:2` → `"@openwhispr/auth-stub"`; `:4` → `"private": true`. Comment at `src/index.ts:2-5` documents the Phase 38 retirement and points at `apps/api/src/auth.ts` as the real Better Auth wiring. The load-bearing name `@openwhispr/auth` is no longer claimed by this monorepo and cannot be published. |
| **HI-01** i18n shipped as 37-byte placeholder bundles | HIGH | **CLOSED** | `packages/i18n/package.json:2` → `"@openwhispr/i18n-stub"`; `:4` → `"private": true`. `packages/i18n/locales/` directory deleted. `src/index.ts` reduced to a single `isPlaceholder()` Stryker target with a "DO NOT IMPORT" notice pointing at `apps/api/src/i18n/init.ts` + `apps/web/src/locales/{en,ru}/`. The `readFileSync`/`JSON.parse` surface is gone, so MD-04 (no error handling) closes by virtue of code removal. |
| **HI-02** redact ↔ byok-guard drift, no parity test | HIGH | **NOT CLOSED → REGRESSED** | See BL-01 below. The original 8 env-key surface in `redact.ts:73-89` is unchanged, but production code at HEAD reads **six additional** secret env vars that are not in `REDACT_PATHS`. No parity test was added. |
| **HI-03** `SMTP_SECURE` strict `=== "true"` | HIGH | **CLOSED** | `packages/email/src/EmailSender.ts:67-69` adds `parseBoolEnv()` accepting `1|true|yes|on` case-insensitive with `.toLowerCase().trim()`. Wired at `:125` for `SMTP_SECURE`. **Partial gap, tracked as WR-01:** `SMTP_REJECT_UNAUTHORIZED` at `:129` still uses strict `!== "false"` — the asymmetric handling the original HI-03 explicitly flagged as a footgun is still there. |

## BLOCKER

### BL-01 — REDACT_PATHS missing six in-use secret env vars; HI-02 regression

**File:** `packages/observability/src/redact.ts:73-89`
**Severity:** BLOCKER (pre-OSS-release: shippable redaction policy must cover every secret the codebase actually reads)
**Issue:** Pre-publication grep across `apps/**/src/**` for `process.env.*` matching `*(API_KEY|SECRET|TOKEN|PASSWORD)` surfaces these secret-bearing env names that are **not** in `REDACT_PATHS`:

| Env var | Read at | In REDACT_PATHS? |
|---|---|---|
| `OIDC_CLIENT_SECRET` | `apps/api/src/routes/desktop-signin.ts:61`, `apps/api/src/lib/mint-bearer.ts` (referenced) | NO |
| `BETTER_AUTH_SECRET` | `apps/api/src/auth.ts:325` | NO |
| `DEEPGRAM_API_KEY` | `apps/api/src/routes/tokens/deepgram.ts:42,57` | NO |
| `ASSEMBLYAI_API_KEY` | `apps/api/src/routes/tokens/assemblyai.ts:72,87`, `apps/api/src/lib/settings-resolver.ts:63` | NO |
| `YANDEX_SEARCH_API_KEY` | `apps/api/src/lib/web-search/yandex-adapter.ts:243,257` | NO — list has `YANDEX_API_KEY` (different name) |
| `SMTP_PASSWORD` | `packages/email/src/EmailSender.ts:119` (via `env.SMTP_PASSWORD`) | NO |
| `VALKEY_PASSWORD` | `apps/worker/src/index.ts:161` | NO |

Two distinct failure modes:

1. **Direct redaction holes.** If any code path logs an env-snapshot object (`log.info({ env: process.env })` patterns, OpenTelemetry resource attributes, or a future `/api/admin/env` debug route) these seven keys reach Loki / CloudWatch / stdout in cleartext. The Phase 6 D-T4 sentinel sweep does NOT catch this because the test only asserts each *listed* path redacts — never that each *in-use* secret env var is listed (this is exactly the gap the original review MD-02 called out, also still un-fixed).
2. **Naming drift.** `YANDEX_API_KEY` is in the list but the production code reads `YANDEX_SEARCH_API_KEY` (different env var name — `apps/api/src/lib/web-search/yandex-adapter.ts:243`). Either the list is stale or the adapter is reading the wrong env var; either way, redaction misses the key the code actually uses.

The original HI-02 fix proposal was:
> Extract the canonical provider-env-key list into a single `const SECRET_ENV_KEYS = [...] as const` … Add a contract test in `tests/contract/` that asserts every entry in `SECRET_ENV_KEYS` appears in the pino redact `paths` AND is treated as credential-bearing by `redactUrl`/byok-guard logging.

Neither half landed. The list is the same 8 entries it was at 1832f28, and Phases 5–13 have introduced new secret-bearing env vars in the meantime without anyone updating this file.

**Fix:**
1. Add to `REDACT_PATHS` (both top-level and `*.` wildcard variants, matching the existing pattern at lines 81-89): `OIDC_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, `DEEPGRAM_API_KEY`, `ASSEMBLYAI_API_KEY`, `YANDEX_SEARCH_API_KEY`, `SMTP_PASSWORD`, `VALKEY_PASSWORD`.
2. Resolve the `YANDEX_API_KEY` vs `YANDEX_SEARCH_API_KEY` naming: either keep both for backward-compat or delete the unused one. Verify against the deployed `.env.*.example` files.
3. Add the parity test the original HI-02 explicitly demanded — a grep over `apps/**/src/**` for `process.env.([A-Z_]*KEY|[A-Z_]*SECRET|[A-Z_]*TOKEN|[A-Z_]*PASSWORD)` patterns that asserts every match is in `REDACT_PATHS` (or has an explicit allowlist exception). Without this, the next provider added in v2.3 will silently re-open the same hole.

## WARNING

### WR-01 — `SMTP_REJECT_UNAUTHORIZED` asymmetric parsing (HI-03 partial close)

**File:** `packages/email/src/EmailSender.ts:129`
**Issue:** HI-03 fix added `parseBoolEnv()` and wired it to `SMTP_SECURE` (line 125), but left `SMTP_REJECT_UNAUTHORIZED` on the original strict-string compare:
```ts
const rejectUnauthorized = env.SMTP_REJECT_UNAUTHORIZED !== "false";
```
`SMTP_REJECT_UNAUTHORIZED=FALSE`, `=0`, `=no`, `=off` all keep verification ON. The original HI-03 finding explicitly named this as part of the issue (verbatim: "Same fragility applies to `SMTP_REJECT_UNAUTHORIZED`… the asymmetric handling between the two env vars is a footgun.").

This direction is fail-safe (operator who meant to disable verification gets verification anyway, so no plaintext-on-the-wire risk), but the inconsistency is the user-facing bug the original review called out and it remains uncorrected.

**Fix:** Apply the same `parseBoolEnv()` helper — invert the polarity:
```ts
const rejectUnauthorized =
  env.SMTP_REJECT_UNAUTHORIZED !== undefined
    ? parseBoolEnv(env.SMTP_REJECT_UNAUTHORIZED)
    : true;
```
…or factor a `parseBoolEnvWithDefault(value, default)` helper to avoid the inversion footgun.

### WR-02 — `phase: phase-0-placeholder` manifest marker likely stale on observability

**File:** `packages/observability/package.json` (not re-read — original review §128 flagged this)
**Issue:** Original review's architectural note flagged that three of the four packages carry `"phase": "phase-0-placeholder"` while `observability` has shipped real Phase 6 D-T4 code. Confirming the marker is updated to reflect current state (or removed) was not part of the Phase 41.g closure tasks. If `auth` and `i18n` still carry it after the `-stub` rename, that is now correct (they ARE placeholders); but `observability` claiming `phase-0-placeholder` while exporting `makePino()` used by both `apps/api` and `apps/worker` is misleading metadata.
**Fix:** `grep '"phase"' packages/*/package.json`; either remove the field everywhere or update each to the highest implemented phase. Pre-OSS hygiene only — not blocking, but visible to anyone reading the manifests on GitHub.

### WR-03 — No CI gate keeping the REDACT_PATHS / byok-guard parity from re-drifting

**File:** `packages/observability/src/redact.ts:32-90` + `packages/byok-guard/src/**`
**Issue:** Even if BL-01 is fixed by adding the seven missing keys to `REDACT_PATHS`, nothing prevents v2.3 Phase 42+ from adding a new provider env-key in one place and forgetting the other. This is the exact "drift is silent" failure mode the original HI-02 finding's title called out. Confirming again at HEAD: no test exists at `packages/observability/tests/` or `tests/contract/` that scans for new env-key shapes.
**Fix:** Land the contract test described in BL-01 step 3 as part of the same v2.2-close commit. Treat the parity test as a LOCKER-class invariant (similar to LOCKER-01..08 in CLAUDE.md): adding a `*_API_KEY` / `*_SECRET` / `*_TOKEN` / `*_PASSWORD` env read anywhere under `apps/**/src/**` must REFUSE the PR unless `REDACT_PATHS` (or an explicit allowlist comment) covers it.

### WR-04 — `process.env["LOG_LEVEL"] as pino.LevelWithSilent` cast unchanged (MD-03 carry-over)

**File:** `packages/observability/src/redact.ts:114`
**Issue:** Prior review MD-03 flagged this `as` cast as a parser-shaped-like-a-type-assertion. Still present verbatim at HEAD. Not strictly a regression — original was MEDIUM — but pre-OSS release is the right moment to land a 5-line `VALID_LEVELS` allowlist + `log.warn` on invalid `LOG_LEVEL`, which would also clear an `as` cast from a file that is the project's canonical secret-redaction layer (where `as` is exactly the wrong signal to send to contributors reading for style).
**Fix:** As proposed in original MD-03:
```ts
const VALID = ["trace","debug","info","warn","error","fatal","silent"] as const;
const raw = process.env.LOG_LEVEL;
const level = raw && (VALID as readonly string[]).includes(raw)
  ? (raw as pino.LevelWithSilent)
  : "info";
```

## INFO

### IN-01 — `SMTP_FROM` default still `no-reply@openwhispr.local` (MD-01 carry-over)

**File:** `packages/email/src/EmailSender.ts:80`
**Issue:** Prior MD-01 unchanged. `.local` is mDNS-reserved and `openwhispr.local` is unroutable; a production deploy that forgets `SMTP_FROM` will still send from this domain and hit SPF/DKIM-alignment rejections at receivers. The production loud-fail at line 87 still covers only `SMTP_HOST`.
**Fix:** Extend the line-87 throw to also enforce `SMTP_FROM` in production, OR change the dev fallback to `dev-no-reply@invalid` (RFC 6761 reserved-TLD — unmistakable "this is dev").

### IN-02 — `env: NodeJS.ProcessEnv` accepted raw without Zod validation (LO-01 carry-over)

**File:** `packages/email/src/EmailSender.ts:60`
**Issue:** Prior LO-01 unchanged. Every env access is `string | undefined`. A Zod schema parsed once at construction would surface misconfig earlier and document the contract in code. Non-blocking; quality-of-life.

## Dead code

- `packages/auth/src/index.ts` — entire package is intentionally a Stryker target now. Comment at lines 2-5 documents this correctly. Not a finding.
- `packages/i18n/src/index.ts` — same shape and same correct documentation.

## Suppressed warnings

- No new `@ts-ignore` / `@ts-expect-error` / `eslint-disable` introduced since the prior review.
- One `as` cast persists at `packages/observability/src/redact.ts:114` (tracked as WR-04).

## Notes

- **Phase 41.g closure is real on 2 of 3 HIGH findings.** The `-stub` rename + `private: true` on both `auth` and `i18n` is the correct, minimal, enterprise-grade fix the original review proposed in CR-01 fix-path (b) and HI-01 fix-path (1). The Stryker mutation target survives, the namespace cannot be squatted, the locale-bundle lie is gone, and there is now a clear documentation pointer from each retired package to the real wiring location.
- **`parseBoolEnv()` is correctly localized to the email package.** Not extracted to a shared `packages/*-env` helper, but at 3 lines it does not need to be — and given LOCKER-04's ban on `as` / `@ts-ignore` plus the project's preference against premature factoring, leaving it in-file is the right call.
- **The HI-02 regression is the only thing standing between this set of packages and "publishable."** It is a 7-line addition to `REDACT_PATHS` plus one contract test. Once that lands, the four packages clear the v2.2 close audit.

---

_Reviewed: 2026-05-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_HEAD: b830cc44b65f56ebdc2ebacd789e93df481788d8_
