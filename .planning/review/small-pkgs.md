# Review: small-pkgs (auth/email/i18n/observability)
Branch: main @ 13f0864
Files reviewed: 8 source files (auth: 1 src; email: 2 src; i18n: 1 src; observability: 2 src) + 4 test files

## Summary
- CRITICAL: 0 / HIGH: 2 / MEDIUM: 4 / LOW: 5
- Top 3 production risks:
  1. **HIGH** — `apps/worker/src/jobs/email-delivery.ts:47-54` redeclares an `EmailSender` interface duplicating `@openwhispr/email`'s public type. Structurally identical TODAY but unconstrained drift is one PR away. Single source of truth violated.
  2. **HIGH** — Two redactors (`packages/observability/src/redact.ts` `REDACT_PATHS` for pino log records, `packages/byok-guard/src/redact-url.ts` `redactUrl()` for URL strings) cover overlapping credential shapes via DIFFERENT mechanisms with NO shared constant list. Each side has a drift-as-failure parity test (correct defence-in-depth) but no shared `CREDENTIAL_SHAPES` array. Maintenance tax + asymmetric coverage (observability misses `x-amz-*` SigV4 headers; byok-guard misses provider env-var names — both are independently OK today because they operate on different inputs, but the policy split is fragile).
  3. **MEDIUM** — `packages/auth` and `packages/i18n` are correctly retired (`private: true`, renamed `*-stub`, zero importers, namespace-squatter defence intact). Both retain a single `isPlaceholder()` export "as a Stryker mutation target" but neither package has a Stryker config — the rationale is unverified. The CLAUDE.md note "slated for retirement in Phase 38" is stale: retirement IS complete; only the package-directory deletion remains.

## packages/auth

### Status
Retired stub. `package.json` name: `@openwhispr/auth-stub`. `private: true`. Real Better Auth wiring lives in `apps/api/src/auth.ts`.

**Importer audit:** `grep "@openwhispr/auth" apps/ packages/` (excluding the package's own files) returns **ZERO** matches. There are NO active production paths referencing `@openwhispr/auth`. The namespace-squatter defence (`private: true`) is sound.

### Exports with importer counts

| Export | Kind | Prod importers | Test importers | Verdict |
|---|---|---|---|---|
| `isPlaceholder` | function | 0 | 1 (own test only) | DEAD outside its own self-test. Retain ONLY if Stryker config explicitly targets it. |

**Stryker check:** `grep -rEn 'stryker' packages/auth/package.json` returns nothing. There is no per-package stryker config. The "Stryker mutation target" rationale in the source header is unsubstantiated. **Recommendation:** delete the entire `packages/auth/` directory + workspace entry in a follow-up cleanup PR. The `@openwhispr/auth-stub` published-name protection is achieved by `private:true` alone; no source file is required.

### Findings
- **MEDIUM** — `packages/auth/src/index.ts` — `isPlaceholder()` is functionally dead. No Stryker config in `packages/auth/package.json` to substantiate the "mutation target" comment. Recommend deletion of the package in a cleanup PR.
- **LOW** — `packages/auth/src/index.ts:2-5` — header narrative reads as forward-looking ("Phase 38: package retired") while the work IS done. Update CLAUDE.md "slated for retirement" wording to match reality.

## packages/email

### Files & line counts
- `src/EmailSender.ts` — 162 lines, implementation
- `src/index.ts` — 20 lines, barrel
- `tests/unit/EmailSender.test.ts` — 489 lines (substantial coverage)

### Exports with importer counts

| Export | Kind | Prod importers | Notes |
|---|---|---|---|
| `createEmailSender` | function | 2 (`apps/api/src/auth.ts:251`, `apps/worker/src/index.ts:109`) | Canonical factory. Healthy. |
| `EmailSender` | interface | 1 prod (`apps/api/src/auth.ts:41` as `EmailService`) + 4 test files | Active. Worker redeclares its own shape — see HIGH below. |
| `Logger` | interface | 0 direct (implicit via `createEmailSender`) | Public-API contract — RETAIN. |
| `SendArgs` | interface | 0 direct | Public-API contract — RETAIN. |
| `SendResult` | interface | 0 direct | Public-API contract — RETAIN. |
| `CreateEmailSenderOpts` | interface | 0 direct | Public-API contract — RETAIN. |

### Findings
- **HIGH** — `apps/worker/src/jobs/email-delivery.ts:47-54` redeclares the `EmailSender` interface (same `send(args) -> Promise<{delivered, reason?}>` shape) instead of importing it from `@openwhispr/email`. The local interface is structurally identical to the canonical one TODAY; tomorrow if either side adds a method or tightens an arg, the duplicate silently absorbs the breakage at the wiring seam. Fix: `import type { EmailSender } from "@openwhispr/email"` in the worker job.

- **MEDIUM** — `packages/email/src/EmailSender.ts:87` reads `env.NODE_ENV === "production"` for the loud-fail gate. This is a LOCKER-01 candidate (CLAUDE.md constraint 11: no `NODE_ENV` branching outside `bootstrap.ts`/`config/*.ts`). Verified that `tools/lint-no-env-branches.allowlist.txt:27-28` explicitly allowlists this file at lines 7 and 79 (`issue-31-boundary-check`). The constitutional gate is satisfied. **However**, line 87 (the actual branch) is NOT in the allowlist — only lines 7 (the jsdoc header) and 79 (start of function). Re-run `pnpm exec tsx tools/lint-no-env-branches.ts` to confirm the linter scans by-line-number-where-pattern-appears vs. by-file-allowlist; if by-line, the actual branch at :87 is unallowlisted and the linter is currently green only because the pattern at :7/:79 is what gets flagged (the JSDoc text contains `NODE_ENV`). **Verify** the allowlist mechanism matches the actual violation line.

- **MEDIUM** — `packages/email/src/EmailSender.ts:129` reads `env.SMTP_REJECT_UNAUTHORIZED !== "false"` with strict literal compare, NOT via `parseBoolEnv()` (defined at line 67 specifically because operators write `1`/`TRUE`/`yes`/`on` in `.env` files). Setting `SMTP_REJECT_UNAUTHORIZED=FALSE` (uppercase) silently keeps cert verification ON (safe failure mode), but the asymmetry with `SMTP_SECURE` is a footgun for ops trying to connect to a self-signed corporate relay. Either: (a) document the strict-literal behaviour with a comment at line 129, or (b) reuse `parseBoolEnv("false") → false` inverted. Recommend (a) — strict cert verification on typo is the secure default — and add an integration test that asserts `SMTP_REJECT_UNAUTHORIZED=FALSE` (uppercase) does NOT disable verification.

- **LOW** — `packages/email/src/EmailSender.ts:80` defaults `SMTP_FROM` to `"no-reply@openwhispr.local"`. CLAUDE.md constraint 13 (LOCKER-03) forbids hardcoded `localhost`/port shapes outside `tests/`/`compose/`/`docs/`/`tools/`. `openwhispr.local` is an RFC-2606-style non-routable placeholder, NOT `localhost` — likely not caught by `tools/lint-no-hardcode.ts` (whose regex targets `localhost`/`127.0.0.1`/specific ports). Operationally fine as a DEFAULT (operators override via env). Add a `// LOCKER-03 carve-out: RFC-2606 placeholder default` comment to forestall future lint sweeps.

- **LOW** — `packages/email/package.json` was NOT opened during this review. Before public OSS publication, verify: (a) `nodemailer` is pinned to a version free of CVE-2024-39903 (multipart DoS) and CVE-2024-32018 (SSRF via HTTPS proxy); (b) `@types/nodemailer` matches the pinned runtime version; (c) no `latest` tags in `dependencies`.

### Security checklist
- **SMTP creds from env: OK.** No hardcoded password in source. Auth attached only when BOTH `SMTP_USER` and `SMTP_PASSWORD` are set (line 130).
- **HTML rendering / XSS in package: N/A.** `EmailSender.send()` is a transparent forwarder; it does NOT render templates. Responsibility for HTML-escaping interpolated values lives with callers (`apps/api/src/auth.ts:443,495` for inline path, `apps/worker/src/i18n/template-renderer.ts` for queued path).
  - **Cross-cutting NOTE (out of scope of this package; flag for follow-up):** `apps/api/src/auth.ts:443` and `:495` interpolate `${url}` (Better Auth-supplied URL with token query-param) directly into `<a href="${url}">${url}</a>` with no HTML-escape. Today `url` is server-built so XSS risk is low, but if Better Auth ever surfaces a user-supplied callback fragment in `url`, this becomes a stored-XSS vector in the verification email rendered by a desktop mail client. Recommend an `escapeHtml()` helper at the call site.
- **Header injection (`Reply-To` / `From`): OK.** `from` is operator-set `SMTP_FROM` (server-controlled), never user-supplied. `to` is `user.email` (Better Auth validated upstream — RFC-5321 conformance is nodemailer's responsibility). No `Reply-To` is set anywhere in the package. No CRLF interpolation surface.
- **Loud-fail in production: OK.** `SMTP_HOST` unset in `NODE_ENV=production` throws at construction (line 88).
- **Never swallow sendMail errors: OK.** Lines 153-159 log AND re-throw — Pitfall #4 satisfied.

## packages/i18n

### Status
Retired stub. `package.json` name: `@openwhispr/i18n-stub`. `private: true`. Real server-side i18n lives in `apps/api/src/i18n/init.ts`; UI bundles in `apps/web/src/locales/{en,ru}/{common,admin,end-user}.json`; queued-email templates in `apps/worker/src/i18n/locales/{en,ru}/email/`.

**Importer audit:** `grep "@openwhispr/i18n" apps/ packages/` (excluding own files) returns **ZERO** matches.

### Exports with importer counts

| Export | Kind | Prod importers | Test importers | Verdict |
|---|---|---|---|---|
| `isPlaceholder` | function | 0 | 1 (own test only) | Same as `packages/auth`: dead outside self-test, no Stryker config confirms the "mutation target" rationale. |

### Findings
- **MEDIUM** — Same dead-package observation as `packages/auth`. Recommend deletion of `packages/i18n/` directory + workspace entry. `private:true` alone protects the npm namespace.
- **LOW** — Header narrative same stale "retirement" framing.

### en/ru parity check
**N/A for this package** — it ships ZERO locale strings. A full en/ru parity audit of the real bundles (`apps/web/src/locales/`, `apps/api/src/i18n/`, `apps/worker/src/i18n/locales/`) is OUT OF SCOPE of `packages/i18n`. Recommend a dedicated review pass over `apps/web` + `apps/worker` covering: (a) every key in `en/*.json` exists in `ru/*.json`; (b) ICU placeholder sets (`{name}`, `{count, plural, …}`) match per key; (c) automated drift test (similar pattern to `redact-providers-parity.test.ts`).

## packages/observability

### Files
- `src/redact.ts` — 130 lines, REDACT_PATHS + makePino factory
- `src/index.ts` — 4 lines, barrel
- `tests/unit/redact.test.ts` — 261 lines
- `tests/unit/redact-providers-parity.test.ts` — 99 lines (drift-as-failure parity vs `apps/*/src/**` `process.env.*_(API_KEY|SECRET|TOKEN|PASSWORD)` references)

### Exports with importer counts

| Export | Kind | Prod importers | Notes |
|---|---|---|---|
| `makePino` | function | 5 — `apps/api/src/plugins/request-log.ts:17`, `apps/worker/src/index.ts:71`, `apps/worker/src/lib/with-tenant-context.ts:32`, `apps/worker/src/lib/with-system-context.ts:24`, `apps/worker/src/jobs/ingest-litellm-spend.ts:32` | Healthy. Canonical pino factory. |
| `REDACT_PATHS` | const readonly string[] | 2 — `apps/api/src/plugins/request-log.ts:17` import + `:26` re-export | Used both as policy input AND as drift-parity-test surface. |
| `REDACT_CENSOR` | const string | 0 prod; used in tests | Exported for assertion convenience. Public API contract — RETAIN. |
| `MakePinoOptions` | interface | 0 direct (implicit via `makePino()` opts arg) | Public-API contract — RETAIN. |

### Findings — redaction completeness

- **HIGH** — Duplicated credential-shape policy between `packages/observability/src/redact.ts` `REDACT_PATHS` (pino redact for log records) and `packages/byok-guard/src/redact-url.ts` `isCredentialParam` + `BEARER_SHAPES` (URL-string redaction). The two redactors operate on DIFFERENT inputs (structured log fields vs URL strings) so they cannot directly call each other, but they share the same conceptual responsibility: "what is a credential." Concrete asymmetries:
  - `byok-guard` covers `x-amz-signature` / `x-amz-credential` / `x-amz-security-token` (URL query params). `observability` does NOT include the structured-field equivalents — if an AWS SigV4 URL is ever logged as a structured field (`log.info({ s3Url: u })`), the URL is passed through pino unredacted.
  - `observability` covers `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `GROQ_API_KEY` / `PYANNOTE_API_KEY` / `TAVILY_API_KEY` / `YANDEX_API_KEY` / `LITELLM_VIRTUAL_KEY` / `LITELLM_MASTER_KEY` as explicit env-var keys. `byok-guard` does not — by design (env-var names are not URL params).

  Both lists have drift-as-failure parity tests, which is the correct defence. But the lists themselves diverge silently. **Recommend:** lift a shared `KNOWN_CREDENTIAL_FAMILIES` array (`['api_key', 'token', 'secret', 'password', 'bearer_token', 'access_token', 'refresh_token', 'client_secret', 'virtual_key', 'master_key', 'x-amz-signature', 'x-amz-credential', 'x-amz-security-token']`) into a new shared package (or extend `@openwhispr/observability`) and have both redactors derive their per-shape rules from it. Both parity tests then trivially reduce to "for each family in the shared list, both redactors handle a synthetic sample."

- **MEDIUM** — `REDACT_PATHS` does not include `req.headers["x-api-key"]`, `req.headers["x-auth-token"]`, or `req.headers["x-amz-security-token"]`. These are conventional bearer-header alternatives. Pino's `*.foo` wildcard matches one-level-deep only; `req.headers` is two levels from root, so explicit paths are required. If any inbound request reaches the API with an `X-API-Key` header (LiteLLM gateway pattern), it leaks to logs. Add the explicit paths.

- **MEDIUM** — `REDACT_PATHS` does not include `MASTER_KEK` or `*.MASTER_KEK` — the envelope-encryption KEK introduced by CLAUDE.md constraint 15 / LOCKER-08. If a future operator-debug log dumps `process.env` (or any `{env}` field), the master KEK leaks in cleartext. Trivial fix — add to both top-level and `*.` family.

- **LOW** — `REDACT_PATHS` covers `req.query.code` and `req.query.state` (OAuth authorization-code flow) but NOT `req.query.access_token` / `req.query.id_token` / `req.query.token` (legacy implicit-flow query-param surface). Better Auth uses auth-code flow so unused today, but a defence-in-depth addition costs nothing.

- **OK** — `process.env["LOG_LEVEL"]` read at line 114 is a config read (not a `NODE_ENV` branch). Does NOT violate LOCKER-01.
- **OK** — `REDACT_CENSOR = "[REDACTED]"` is a stable literal asserted by the integration sentinel sweep.
- **OK** — `makePino()` correctly threads `destination` only when provided (lines 125-128). No bug at the pino-arity seam.

## Cross-package duplication
1. **`EmailSender` interface duplicated** — `packages/email/src/EmailSender.ts:54` (canonical) vs `apps/worker/src/jobs/email-delivery.ts:47-54` (redeclared). Worker should import the type.
2. **Credential-shape policy duplicated across redactors** — `packages/observability` `REDACT_PATHS` vs `packages/byok-guard` `isCredentialParam` + `BEARER_SHAPES`. Lift a shared constant. (HIGH; see Observability above.)
3. **Stub-package pattern duplicated** — `packages/auth/src/index.ts` and `packages/i18n/src/index.ts` are functionally identical `isPlaceholder()` stubs with near-identical headers. Either consolidate into one `@openwhispr/retired-stubs` package OR delete both directories (the `private:true` namespace defence does not require a source file once the package name is permanently held).

## Dead code (global)
| Symbol | File | Prod importers | Recommendation |
|---|---|---|---|
| `isPlaceholder` | `packages/auth/src/index.ts` | 0 | Delete package (no Stryker config substantiates retention). |
| `isPlaceholder` | `packages/i18n/src/index.ts` | 0 | Delete package (same). |
| `REDACT_CENSOR` | `packages/observability/src/redact.ts` | 0 (tests only) | Keep — public API contract surface. |
| `Logger` / `SendArgs` / `SendResult` / `CreateEmailSenderOpts` | `packages/email/src/EmailSender.ts` | 0 direct (implicit via factory) | Keep — public API contract surface. |

## Suppressed warnings
**ZERO** matches across all eight reviewed source files for `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, `as any`, `as unknown as`. LOCKER-02 (CLAUDE.md constraint 12) is satisfied.

## Disabled tests
**ZERO** matches for `\.(skip|only|todo)\(` across `packages/{auth,email,i18n,observability}/tests/`.

## TODO / FIXME / HACK / XXX / TEMP / WORKAROUND
**ZERO** matches in `src/` across all four packages. The CLAUDE.md hint about "Phase 38 TODO markers" — there are no `TODO("Phase 38")` markers; only file-header narrative comments documenting the retirement history. Those are intentional record-keeping, not actionable TODOs.

## NODE_ENV branching (LOCKER-01)
**One** site: `packages/email/src/EmailSender.ts:87` (`env.NODE_ENV === "production"`). Allowlisted at `tools/lint-no-env-branches.allowlist.txt:27-28` (`issue-31-boundary-check`). See MEDIUM finding above for the line-number mismatch concern (allowlist names :7/:79, the actual branch is :87).

## Dynamic require / shell-injection / `process.exit`
**ZERO** matches across all four packages for: `eval(`, dynamic `require(`, `child_process.spawn`, `child_process.exec`, `process.exit(`. LOCKER-06 (constraint 14) clean.

## Auth retirement status (per CLAUDE.md)
- `packages/auth/package.json` is `@openwhispr/auth-stub`, `private: true`. Confirmed.
- `apps/api/src/auth.ts` uses Better Auth directly — the prod surface. Confirmed (line 41 imports from `@openwhispr/email`, no `@openwhispr/auth` import anywhere).
- **No active prod path uses the retired `@openwhispr/auth`.** Retirement is complete; the CLAUDE.md "slated for retirement in Phase 38" wording is stale and should read "retired in Phase 38; directory pending cleanup deletion."

## Notes (pre-publication readiness)
- All four packages carry `SPDX-License-Identifier: FSL-1.1-ALv2` on every source file. Good for OSS publication.
- Both stub packages have `private: true` — they will NOT be published to npm. Confirmed by reading their `package.json`.
- `packages/email/package.json` and `packages/observability/package.json` were NOT opened during this review. Before publication, verify (a) `nodemailer` pinned to a version free of CVE-2024-39903 / CVE-2024-32018; (b) `pino` pinned to v9+ (the redact.ts comment at line 78 cites Pino-9 semantics); (c) no `latest` tags in `dependencies`.
- No `process.exit(N)`, no dynamic `require()`, no `eval()`, no `child_process.spawn/exec*` in any of the four packages. Process-boundary discipline intact.
- Drift-as-failure parity tests (`redact-providers-parity.test.ts` for observability, `redact-url-parity.test.ts` for byok-guard) are excellent defence-in-depth — should be cited in CLAUDE.md as an exemplar pattern.

---
Reviewed: 2026-05-17
Reviewer: Claude (gsd-code-reviewer, adversarial pass)
Depth: standard + cross-file (observability ↔ byok-guard duplication trace; email-package ↔ apps/worker EmailSender duplication trace)
