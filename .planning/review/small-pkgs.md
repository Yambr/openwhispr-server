# Small-Packages Pre-Publication Review

**Branch:** `main` (HEAD `6e43588`)
**Scope:** `packages/auth/src/**`, `packages/email/src/**`, `packages/i18n/src/**`, `packages/observability/src/**`
**Excluded:** tests, `.planning/`, `docs/`
**Depth:** standard + cross-file consumer tracing
**Status:** issues_found (1 HIGH, 2 MEDIUM, 3 LOW — no CRITICAL, no BLOCKER)

---

## Summary

All four packages are small, well-commented, and broadly fit for public release. Two of the four (`@openwhispr/auth-stub`, `@openwhispr/i18n-stub`) are explicitly retired placeholder shells whose only role is to squat the npm namespace and serve as Stryker mutation targets — they contain no production logic. The two live packages (`@openwhispr/email`, `@openwhispr/observability`) are the production-path artefacts and carry the substantive findings.

Highlights:

- **No CRITICAL findings.** No roll-your-own JWT/auth, no hardcoded credentials, no plaintext secret leaks, no `as any` / `@ts-ignore` / `@ts-expect-error` suppressions in any of the four packages, no TODO/FIXME/HACK/XXX markers.
- **`packages/observability/src/redact.ts`** is the single source of truth for pino log redaction and is comprehensive: D-T4 paths verbatim, top-level fallbacks for the root-key wildcard gap, env-var families (OPENAI/OPENROUTER/GROQ/PYANNOTE/TAVILY/YANDEX/LITELLM/MASTER_KEK/BETTER_AUTH_SECRET), nested axios error shapes, and explicit bracket-keyed inbound headers (`x-api-key`, `x-auth-token`, `x-amz-*`). I found **no duplicate inline redact regex** in any of the four packages (good).
- **One genuine HIGH:** `EmailSender.send()` passes `html` straight through to nodemailer with no escaping of caller-provided variables. The package surface trusts the caller — a defensible choice for a library — but the contract should be documented loudly because the only current production caller (`apps/api/src/auth.ts:493`) interpolates a Better-Auth-generated reset URL into an `<a href="${url}">` tag with no escaping. The URL is server-generated and not user-controlled today, so this is HIGH (latent-injection-risk on future caller drift), not CRITICAL.
- **Two MEDIUM dead-package findings** are the retired `auth-stub` and `i18n-stub` exports themselves. Both have **zero external importers** (`grep` across `apps/**` + `packages/**` returns only the package's own `index.ts` and `vitest.config.ts` workspace registration). Memory's Phase 38 retirement note matches the codebase reality.
- **One LOW:** `observability/package.json` declares `pino: ^9.5.0` while the rest of the monorepo runs on pino 9.x — no version pin, no `engines`, no peer-dep declaration. Fine for an internal workspace package, worth tightening before any future external publish.
- **No OTel SDK wiring lives in `packages/observability/src/`.** The package is pino-only today (despite memory and docs referring to an OTel Collector pipeline). OTel bootstrap lives in `apps/api` / `apps/worker`. Not a finding — it just means the "Trace span attribute names" checklist item is N/A for the package surface in scope.

---

## Findings

### packages/auth/src/

#### MED-AUTH-01 — Retired stub with zero consumers (Phase 38 already executed)

- **File:** `packages/auth/src/index.ts` (whole file, 9 lines)
- **Severity:** MEDIUM (dead export in retired package)
- **Evidence:** `grep -rEn '@openwhispr/auth"' --include="*.ts" --include="*.json"` across the repo (excluding `node_modules`, `.planning`, `.claude`) returns **zero** external importers. Only `packages/auth/src/index.ts` (self), `packages/auth/package.json`, and `vitest.config.ts:63` (workspace registration as `@openwhispr/auth-stub`) reference the namespace.
- **Issue:** `isPlaceholder()` is dead code from any production standpoint. The file header explicitly states this is a namespace-squat to prevent npm hijack and a Stryker mutation target. That is a legitimate role, but the package should not ship to public npm — the rename to `@openwhispr/auth-stub` + `"private": true` in `package.json` correctly enforces this. Confirmed `private: true` is set.
- **Decision needed before publication:** Whether to ship `@openwhispr/auth-stub` to GitHub at all, or strip it from the workspace. Memory says Phase 38 retired it; the placeholder-export rationale is documented in-file. **Note, not blocker.**
- **No CRITICAL roll-your-own JWT/auth concern** — the package contains no auth logic whatsoever.

---

### packages/email/src/

#### HIGH-EMAIL-01 — HTML body passed through verbatim; no escape of interpolated values at the package boundary

- **File:** `packages/email/src/EmailSender.ts:142-150` (the `send({ to, subject, text, html })` implementation)
- **Severity:** HIGH
- **Issue:** The `SendArgs` contract accepts an arbitrary `html?: string` and forwards it unmodified to `transporter.sendMail()`. There is no documented expectation that callers must HTML-escape interpolated variables, no helper exposed from the package for safe interpolation, and no warning in the file header. The only current first-party caller (`apps/api/src/auth.ts:493`) constructs `html: \`<p>Click to reset: <a href="${url}">${url}</a></p>\`` with a server-generated reset URL — safe today, but the moment a caller interpolates a user-controlled value (display name, support message, organization name in a welcome email) into the same shape, this becomes stored-HTML injection delivered over SMTP. The contract surface should make this explicit.
- **Why HIGH not CRITICAL:** Today's known callers interpolate only server-generated tokens / URLs from Better Auth. No user-controlled variable is reaching `html` in the current monorepo. The risk is latent + caller-side.
- **Fix shape (description only):** Either (a) document loudly in the `SendArgs` JSDoc that `html` is the caller's responsibility and add an example pointing at a known-safe template renderer; or (b) expose a `renderEmail({ template, vars })` helper that escapes `vars` via a small, audited escaper, leaving raw `html` only as an escape hatch.

#### MED-EMAIL-02 — i18n locale coverage for subjects + bodies is not the package's concern, but it is also not documented as such

- **File:** `packages/email/src/EmailSender.ts:42-47` (`SendArgs` shape) + `packages/email/src/index.ts` (barrel)
- **Severity:** MEDIUM (documentation/contract gap)
- **Issue:** The checklist requires `en` + `ru` parity for subject + body. The package itself is locale-agnostic — it transports already-rendered strings. The rendering layer lives in `apps/worker/src/i18n/template-renderer.ts` (out of review scope), and `apps/api/src/auth.ts` hand-rolls English-only `subject:` / `text:` / `html:` for the password-reset path that bypasses the worker queue (line 491-493). The package's public README/JSDoc does not state "callers MUST localize before calling `send()`," so a future caller can plausibly miss the convention. Not a package defect; flagging as a contract-documentation gap.

#### LOW-EMAIL-03 — `parseBoolEnv` is defined but not exported

- **File:** `packages/email/src/EmailSender.ts:67-69`
- **Severity:** LOW (style / re-use)
- **Issue:** The truthy-spelling parser was added (Phase 41.g / HI-03) and would be useful to any other package that has to parse `SMTP_REJECT_UNAUTHORIZED`-style flags from `process.env`. It is module-private. Either re-export it or accept that it is intentionally local; today the choice is not documented.

#### Positive notes (no finding)

- SMTP credentials (`SMTP_USER`, `SMTP_PASSWORD`) are read from `env` and threaded into the nodemailer transporter; they are **never logged**. The only log lines (`email.smtp_not_configured`, `email.skipped`, `email.sent`, `email.failed`) carry `{ to, subject, messageId, err }` — no credential surface. OK.
- Production loud-fail gate (`NODE_ENV === "production"` + missing `SMTP_HOST` throws) is in place. This is one of the documented exceptions to the "no NODE_ENV branches in runtime" locker (Rule 11) and is correct for boot-time config validation. See LOCKER-01 row below for the contingent caveat.
- `try/catch` around `transporter.sendMail()` re-throws after logging. No swallow. OK.

---

### packages/i18n/src/

#### MED-I18N-01 — Retired stub with zero consumers (Phase 41.g already executed)

- **File:** `packages/i18n/src/index.ts` (whole file, 14 lines)
- **Severity:** MEDIUM (dead export in retired package)
- **Evidence:** `grep -rEn '@openwhispr/i18n"' --include="*.ts" --include="*.json"` across the repo returns zero external importers; only the package's own `index.ts`, its `package.json`, its own unit-test file, and `vitest.config.ts:71` (workspace registration as `@openwhispr/i18n-stub`).
- **Issue:** Identical disposition to MED-AUTH-01. Namespace-squat + Stryker target, no production role. `package.json` correctly sets `"private": true` + renames to `@openwhispr/i18n-stub`.
- **Checklist items N/A because no real implementation exists in this package:**
  - `i18next` / `i18next-http-middleware` / `i18next-icu` / `accept-language-parser` are not imported here. Real wiring lives in `apps/api/src/i18n/init.ts` (out of scope, file header confirms).
  - "Hardcoded fallback strings" — the file has zero strings.
  - "Missing locale keys (cross-check `en` vs `ru` JSON)" — no JSON bundles in this package; bundles live in `apps/web/src/locales/{en,ru}/*.json` (out of scope).

---

### packages/observability/src/

#### LOW-OBS-01 — Pino dep declared as `^9.5.0` with no engines/peer pin

- **File:** `packages/observability/package.json`
- **Severity:** LOW
- **Issue:** `dependencies.pino: "^9.5.0"`. For an internal workspace package this is fine — pnpm hoists the monorepo's canonical pino. If this package is ever extracted or published to npm separately, the caret range across pino major boundaries could produce a redact-config regression (pino 8 → 9 changed wildcard semantics). Either pin to `~9.5` or move pino to `peerDependencies` so consuming apps own the version contract.

#### Positive notes (no finding)

- **Redact-path coverage is exhaustive and matches the byok-guard URL-shape complement.** I diffed the two single-source-of-truth lists:
  - `packages/observability/src/redact.ts` covers log-object key paths: bearer/cookie headers, OAuth callback query params (`code`, `state`), env-var families (OpenAI, OpenRouter, Groq, Pyannote, Tavily, Yandex, LiteLLM virtual + master, MASTER_KEK, BETTER_AUTH_SECRET), nested axios error shapes (`err.response.config.headers.Authorization`, etc.), and bracket-keyed inbound headers (`x-api-key`, `x-auth-token`, `x-amz-signature|credential|security-token`).
  - `packages/byok-guard/src/redact-url.ts` covers URL-string shapes: query-string credential params (api_key/apikey/api-key/`*_api_key`/`*_apikey`, token/access_token/refresh_token/id_token, key/code/secret/signature/password, AWS SigV4 x-amz-*), URL userinfo, bearer-shaped path segments (sk-/sk-ant-/AIza/AKIA), JWT path segments, hash-fragment OAuth2 implicit-flow tokens.
  - **No gap and no overlap.** The two surfaces are complementary, not duplicative. OK.
- **No inline redact regex in `packages/email/**`, `packages/auth/**`, `packages/i18n/**`.** The duplication risk called out in the brief does not exist anywhere in the four packages under review (confirmed by `grep -rEn 'redact|REDACT|\[REDACTED\]|Bearer.*\*' packages/*/src/`).
- **No hardcoded endpoints.** `makePino()` reads `process.env["LOG_LEVEL"]` as its only env read. No `localhost`, no `:3000`, no OTel exporter URL. The OTel collector wiring lives elsewhere (`apps/api/src/bootstrap.ts`, `otel-bootstrap.ts`), correctly outside this package.
- **No trace span attributes constructed in this package.** The "secret-shape span attribute" checklist item is N/A — there are no `span.setAttribute()` calls here.
- **`NODE_ENV` is not branched in this package.** Only `process.env["LOG_LEVEL"]` is read, which is a runtime-level dial, not an environment branch. LOCKER-01 boundary not crossed.

---

## Dead Code

| File | Symbol | External Importers | Status |
|---|---|---|---|
| `packages/auth/src/index.ts` | `isPlaceholder()` | 0 (only own package + vitest workspace registration) | Dead in any production sense; intentional Stryker mutation target per file header. MED-AUTH-01. |
| `packages/i18n/src/index.ts` | `isPlaceholder()` | 0 (only own package + vitest workspace registration) | Identical disposition to AUTH. MED-I18N-01. |
| `packages/email/src/EmailSender.ts` | `parseBoolEnv` | Module-private (intentional) | LOW-EMAIL-03 — not exported. Not dead, just unshared. |
| `packages/observability/src/redact.ts` | `REDACT_CENSOR`, `REDACT_PATHS`, `MakePinoOptions`, `makePino` | `makePino`: heavily used (apps/api `bootstrap.ts`, `index.ts`, `plugins/request-log.ts`; apps/worker `index.ts`, `lib/with-tenant-context.ts`, `lib/with-system-context.ts`, `jobs/ingest-litellm-spend.ts`). `REDACT_PATHS`: re-exported via `apps/api/src/plugins/request-log.ts`. `REDACT_CENSOR`: not imported externally. | `REDACT_CENSOR` is the lone unused-by-anyone export — could be tightened to module-private, or kept as part of the public-API for callers that want to assert on the censor token. LOW (not separately filed). |

Live consumer paths for `@openwhispr/email`:

- `apps/api/src/auth.ts:41` — `createEmailSender`, `EmailSender as EmailService` (verification + password-reset emails)
- `apps/worker/src/index.ts:70` — `createEmailSender` (worker email-delivery job)
- `apps/worker/src/jobs/email-delivery.ts:31` — `type EmailSender as EmailSenderPkg`

Live consumer paths for `@openwhispr/observability`:

- `apps/api/src/bootstrap.ts:14`, `apps/api/src/index.ts:63`, `apps/api/src/plugins/request-log.ts:17,26` — `makePino`, `REDACT_PATHS`
- `apps/worker/src/index.ts:71`, `apps/worker/src/lib/with-tenant-context.ts:32`, `apps/worker/src/lib/with-system-context.ts:24`, `apps/worker/src/jobs/ingest-litellm-spend.ts:32` — `makePino`

---

## Suppressed Warnings / TODOs / HACKs

`grep -rEn 'TODO|FIXME|HACK|XXX' packages/{auth,email,i18n,observability}/src` → **zero hits.**

`grep -rEn 'as any|as unknown as|@ts-ignore|@ts-nocheck|@ts-expect-error|eslint-disable' packages/{auth,email,i18n,observability}/src` → **zero hits.**

Locker compliance:

| Locker | Rule | Status across the 4 packages |
|---|---|---|
| LOCKER-01 | No `NODE_ENV` branches outside bootstrap/config | `packages/email/src/EmailSender.ts:87` reads `env.NODE_ENV === "production"`. The locker's allowed-locations list is `bootstrap.ts`, `config/*.ts`, `otel-bootstrap.ts`, `*.config.ts` — `EmailSender.ts` is none of those. The check is boot-time config validation in spirit. **Contingent finding** — if `tools/lint-no-env-branches.ts` rejects this on CI, it needs an allowlist entry. HEAD commits since Phase 31 have landed without locker failures, suggesting the lint already exempts the path. Filing as a contingent LOW. |
| LOCKER-02 | No type suppressions | Clean across all 4. OK. |
| LOCKER-03 | No hardcoded localhost / UUID / token shapes | Clean. `"no-reply@openwhispr.local"` is a domain, not a localhost ref. OK. |
| LOCKER-04 | Fastify route + rateLimit + Zod schema | N/A — none of the 4 packages declares Fastify routes. OK. |
| LOCKER-05 | Error subclasses truncate body fields | N/A — none of the 4 declares Error subclasses. OK. |
| LOCKER-06 | No template-interpolated shell credentials | Clean — no `child_process` usage anywhere. OK. |
| LOCKER-08 (PLAINTEXT-COLS) | No plaintext credential columns | N/A — none of the 4 declares Drizzle schema. OK. |

---

## CLAUDE.md Hard-Rule 1 Adherence (Tests Drive Tests, Not Production)

Out of scope by construction — this is a pre-publication source review, not a test-fix review. No tests were modified by this review, and no production source was modified by this review (Write-tool is restricted to the review file). OK.

---

## Recommendation

**Ship the four packages to public GitHub as-is, with one documentation patch:**

1. Address **HIGH-EMAIL-01** by updating the `SendArgs.html` JSDoc + package `README.md` (if present) to make the HTML-escape contract explicit, ideally before publication. This is the only finding with latent-injection potential; everything else is dead-stub housekeeping or low-risk style.

Decisions deferrable to a later phase:

- Whether to ship the two `*-stub` packages at all (MED-AUTH-01, MED-I18N-01) — they squat the npm namespace, which is valuable defensive posture, and `"private": true` already prevents accidental publication. If GitHub-only release is the goal, leaving them in-tree is fine.
- Whether to tighten `pino` to `~9.5.0` in `packages/observability/package.json` (LOW-OBS-01).
- Whether to expose `parseBoolEnv` from `@openwhispr/email` (LOW-EMAIL-03).

---

_Reviewed: 2026-05-20_
_Reviewer: Claude (gsd-code-reviewer, Opus 4.7 1M)_
_Depth: standard + cross-file consumer tracing_
