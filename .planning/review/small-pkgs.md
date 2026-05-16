# Review: small-pkgs (auth, email, i18n, observability)

Branch: main @ 1832f28
Scope: packages/{auth,email,i18n,observability}/src/**

## Summary
- Files reviewed: 6
  - packages/auth/src/index.ts (7 lines)
  - packages/email/src/EmailSender.ts (153 lines)
  - packages/email/src/index.ts (20 lines)
  - packages/i18n/src/index.ts (14 lines)
  - packages/observability/src/index.ts (3 lines)
  - packages/observability/src/redact.ts (130 lines)
- Findings: CRITICAL=1 HIGH=3 MEDIUM=4 LOW=2 (total 10)
- Top 3 risks (pre-OSS-release):
  1. **CRITICAL — `packages/auth` is a publicly-named placeholder shell.** `@openwhispr/auth` exports nothing but `isPlaceholder(): true` and is imported by ZERO consumers in `apps/*` or `packages/*` (only its own tests reference it). The comment claims "Better Auth wiring lands in Phase 2", but the package still has `version: 0.0.0`, a `phase-0-placeholder` marker in `package.json`, and exports a function whose only purpose is to feed Stryker. Publishing this to GitHub under the `@openwhispr` namespace is misleading and a supply-chain hazard if someone later squats the real `@openwhispr/auth` name.
  2. **HIGH — `packages/i18n` ships as a placeholder claiming en+ru support while both locale bundles are 37-byte stubs (`{"phase":"phase-0-placeholder"}`).** Project memory + CLAUDE.md mandate "en+ru minimum from day one for UI copy, emails, end-user error messages." The synchronous `readFileSync` loader is also called on every invocation (no cache), and the loader silently accepts arbitrary `Record<string,string>` even though the JSON contains a non-string `phase` value — types lie about reality. The package is imported nowhere outside its own tests, so it is wired but unused.
  3. **HIGH — `redact.ts` (observability) cannot share the same secret-pattern surface as `byok-guard`'s `redact-url.ts`, and the duplication is acknowledged in-source as deliberate "vendoring" with a hand-promised port-the-fix rule.** Different abstractions (Pino key paths vs WHATWG URL password masking), but both packages are part of the same secret-redaction story and any future addition (e.g., a new provider API key) MUST be made in two places. There is no test or CI lint that enforces parity — drift is silent.

## Findings (group by package within severity)

### CRITICAL

#### CR-01 — `packages/auth/src/index.ts:1-6` — Placeholder package published under a load-bearing name
**File:** `packages/auth/src/index.ts:1-6`
**Issue:** The entire `@openwhispr/auth` workspace package consists of:
```ts
export function isPlaceholder(): boolean {
  return true;
}
```
- No Better Auth wiring exists (comment promises "Phase 2" but on HEAD=1832f28 there is no real code).
- `grep -r "@openwhispr/auth" apps/ packages/` returns ZERO imports outside the package's own tests/config. The package is dead code under a privileged namespace.
- `package.json` carries `"phase": "phase-0-placeholder"` and `"version": "0.0.0"` — explicit "do not ship" markers that nonetheless ship.
- On public GitHub release, third parties cloning the repo see an `@openwhispr/auth` package that purports to be an auth library but is a no-op; if the org ever publishes to npm the placeholder name is squatted by its own monorepo entry, blocking a real future package.
**Fix:** Either (a) delete `packages/auth` until the real Better Auth wiring lands and remove from `pnpm-workspace.yaml`, OR (b) rename to `packages/auth-placeholder` with a top-of-file `@deprecated` / "DO NOT IMPORT" notice, OR (c) move the Stryker mutation target into `packages/observability` or a dedicated `packages/_stryker-fixtures`. Document in README that the auth package is intentionally absent until Phase 2.

### HIGH

#### HI-01 — `packages/i18n/src/index.ts:1-14` + locales/*/common.json — i18n loader is a stub, both locales are 37-byte placeholders
**File:** `packages/i18n/src/index.ts:5-14`, `packages/i18n/locales/en/common.json`, `packages/i18n/locales/ru/common.json`
**Issue:**
- Both `common.json` files contain only `{"phase": "phase-0-placeholder"}` — zero real translation keys.
- The loader's type signature `Record<string, string>` is a lie: `phase` happens to be a string today, but there is no runtime validation and no schema. A consumer calling `loadLocale("en").greeting` returns `undefined` with no warning.
- Synchronous `readFileSync` on every call, no in-process cache. Acceptable for "phase 0 stub" but will become a hot-path FS hit if any route ever wires this.
- Zero consumers in `apps/*` outside the package's own tests — the package is published-named but unused.
- Project memory (`feedback_no_bundled_local_models.md` neighbours) + CLAUDE.md constitution require "en + ru minimum from day one." On public release a contributor reasonably assumes `@openwhispr/i18n` is the real i18n layer; it is not.
**Fix:**
1. Either delete the package or replace its README/inline comment with a prominent "PLACEHOLDER — i18next wiring lands in Phase 7+" notice.
2. Tighten the loader return type to `unknown` (or a Zod schema) until real translations land — current `Record<string,string>` is unsafe.
3. If retained, cache `loadLocale` results in a `Map<locale, parsed>` to avoid per-request FS hits the moment any route imports it.

#### HI-02 — `packages/observability/src/redact.ts:73-89` — Provider API-key list duplicates byok-guard surface; drift is silent
**File:** `packages/observability/src/redact.ts:73-89` (vs. `packages/byok-guard/src/index.ts` + `redact-url.ts`)
**Issue:** The `REDACT_PATHS` list hardcodes provider env-key names (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `PYANNOTE_API_KEY`, `TAVILY_API_KEY`, `YANDEX_API_KEY`, `LITELLM_VIRTUAL_KEY`, `LITELLM_MASTER_KEY`). Any new provider added in Phase 5+ (e.g., a future `BEDROCK_API_KEY` per the corporate override path mentioned in CLAUDE.md) must be added here, and the corresponding partner-key list inside `byok-guard` must also be updated. Neither side has a contract test that enumerates "all known secret env keys" and asserts both layers cover them.
**Fix:** Extract the canonical provider-env-key list into a single `const SECRET_ENV_KEYS = [...] as const` in one shared location (e.g., `packages/observability/src/secret-keys.ts`) and import it from `byok-guard` (one-way: a `packages/*` package importing another `packages/*` package is the explicit allowed direction). Add a contract test in `tests/contract/` that asserts every entry in `SECRET_ENV_KEYS` appears in the pino redact `paths` AND is treated as credential-bearing by `redactUrl`/byok-guard logging.

#### HI-03 — `packages/email/src/EmailSender.ts:115` — SMTP_SECURE strict-string parsing rejects valid truthy values
**File:** `packages/email/src/EmailSender.ts:115`
**Issue:**
```ts
const secure = env.SMTP_SECURE !== undefined ? env.SMTP_SECURE === "true" : port === 465;
```
- `SMTP_SECURE=1`, `SMTP_SECURE=TRUE`, `SMTP_SECURE=yes`, `SMTP_SECURE= true ` (trailing whitespace) all evaluate to `secure=false`. A corporate operator setting `SMTP_SECURE=1` on port 587 to force STARTTLS+TLS-only-on-connect will silently get plaintext.
- Same fragility applies to `SMTP_REJECT_UNAUTHORIZED` (line 119) — only the exact literal `"false"` disables verification; `"FALSE"`, `"0"`, `"no"` leave verification on. That direction is "fail safe" so it is less dangerous, but the asymmetric handling between the two env vars is a footgun.
- Additionally there is no validation that, in production, if `SMTP_HOST` is set but `secure=false` AND `port !== 587` AND no explicit `SMTP_SECURE` override is provided, that the operator is aware they are sending plaintext on a non-STARTTLS port. The CLAUDE.md constraint "HTTPS only: never plaintext HTTP on any externally reachable port" is the wire-protocol cousin of this concern for email.
**Fix:** Normalize via a `parseBool(env: string|undefined, default: boolean): boolean` helper that lowercases and accepts `true|1|yes|on` (or only `true|1` if you want to be strict) and warn via `log.warn` when production runs with `secure=false` on a port other than 587 (STARTTLS) — this is the hardening the file header comments promise but doesn't implement.

### MEDIUM

#### MD-01 — `packages/email/src/EmailSender.ts:72` — Hardcoded fallback `SMTP_FROM` literal
**File:** `packages/email/src/EmailSender.ts:72`
**Issue:** `const from = env.SMTP_FROM ?? "no-reply@openwhispr.local";` — `openwhispr.local` is a hardcoded brand string that survives into corporate deployments where the operator forgot to set `SMTP_FROM`. In production with a real SMTP relay, sending from `no-reply@openwhispr.local` will be rejected by most receivers (SPF/DKIM alignment failure on an unroutable domain) and may also leak internal brand to anti-abuse vendors. The production loud-fail at line 79 covers `SMTP_HOST` but NOT `SMTP_FROM`.
**Fix:** Either require `SMTP_FROM` in production (extend the line-79 throw to also enforce `SMTP_FROM`), or change the dev-fallback default to a clearly-fake `dev-no-reply@invalid` (`.invalid` is RFC 6761 reserved-TLD, will never resolve, makes "this is dev" obvious).

#### MD-02 — `packages/observability/src/redact.ts:90` — `REDACT_PATHS` list has no test asserting parity with provider env keys actually read by code
**File:** `packages/observability/src/redact.ts:32-90`
**Issue:** The list is hand-maintained. There is no test that scans `apps/*/src/**` for `process.env.FOO_API_KEY` patterns and asserts each is covered by `REDACT_PATHS`. The comment at lines 31-32 promises "exercises a sentinel sweep across every entry" but that asserts every listed path redacts — it does NOT assert every secret key in actual use is listed. This is exactly the drift HI-02 calls out, scoped to a single file.
**Fix:** Add a contract test that greps `apps/*/src` for `process.env.([A-Z_]*KEY|[A-Z_]*SECRET|[A-Z_]*TOKEN|[A-Z_]*PASSWORD)` and asserts each match is in `REDACT_PATHS` (or has an explicit allowlist exception with reason).

#### MD-03 — `packages/observability/src/redact.ts:114` — `process.env["LOG_LEVEL"]` type assertion bypasses validation
**File:** `packages/observability/src/redact.ts:114`
**Issue:** `(process.env["LOG_LEVEL"] as pino.LevelWithSilent | undefined)` — a misconfigured `LOG_LEVEL=verbose` (not a pino level) will be cast through without validation and pino will throw at `pino()` construction with a runtime error rather than a clear "LOG_LEVEL must be one of trace|debug|info|warn|error|fatal|silent". This is an `as` cast doing the job of a parser.
**Fix:** Validate explicitly:
```ts
const VALID = ["trace","debug","info","warn","error","fatal","silent"] as const;
const raw = process.env.LOG_LEVEL;
const level = raw && (VALID as readonly string[]).includes(raw) ? raw as pino.LevelWithSilent : "info";
```
And log a warning if `raw` was set but invalid.

#### MD-04 — `packages/i18n/src/index.ts:11-13` — No error handling around `readFileSync` + `JSON.parse`
**File:** `packages/i18n/src/index.ts:11-13`
**Issue:** Missing locale file (e.g., bundled tarball trims `locales/`) crashes with a raw `ENOENT` and a confusing path. Corrupt JSON throws `SyntaxError` with no locale context. No fallback to `en`.
**Fix:** Wrap in try/catch, log via a passed-in `Logger` (mirror the email package pattern), fall back to `en` on `ru` failures, and throw a typed `I18nLoadError` with the locale + path included.

### LOW

#### LO-01 — `packages/email/src/EmailSender.ts:60` — `env: NodeJS.ProcessEnv` is type-unsafe
**File:** `packages/email/src/EmailSender.ts:60`
**Issue:** Accepting raw `NodeJS.ProcessEnv` makes every env access `string | undefined` and bypasses any validation. A Zod schema parsed once at construction would surface misconfigs earlier and document the contract in code.
**Fix:** Add an internal Zod schema for SMTP_* envs; parse once at construction. Non-blocking quality improvement.

#### LO-02 — `packages/observability/src/redact.ts:32-90` — Comment block is 60 lines of policy prose at top of a 130-line file
**File:** `packages/observability/src/redact.ts:1-22, 32-90`
**Issue:** Stylistic — the file is half comment, half code. Some of that prose belongs in a `docs/observability-redaction.md` or `README.md` alongside the package, leaving the source file leaner.
**Fix:** Move the multi-paragraph rationale to `packages/observability/README.md`; keep terse JSDoc on the exported symbols.

## Dead code

- **`packages/auth/src/index.ts`** — entire package is dead. Zero consumers in `apps/api`, `apps/worker`, or any other `packages/*`. Tracked above as CR-01.
- **`packages/i18n/src/index.ts`** — `loadLocale` has zero callers outside `packages/i18n/tests/` and `vitest.config.ts`. Tracked above as HI-01.
- No `TODO/FIXME/HACK/XXX/TEMP/WORKAROUND` markers found in the reviewed files (greps came up clean across all six files). The "Phase 0 placeholder" / "Phase 13 review HI-01" markers are intentional historical pointers, not deferred-work flags.

## Suppressed warnings

- No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, or `biome-ignore` found in any of the six reviewed files.
- `as` casts used:
  - `packages/observability/src/redact.ts:114` — `process.env["LOG_LEVEL"] as pino.LevelWithSilent | undefined` (tracked as MD-03).
  - `packages/observability/src/redact.ts:116` — `[...REDACT_PATHS]` spreading a `readonly` into a mutable copy for pino's `paths` field is fine; no cast involved.
- No `as any` or `as unknown as` in scope.

## Notes

- **`@openwhispr/email` is genuinely production-grade** for what it does: structural Logger (no fastify coupling), production loud-fail on missing SMTP_HOST, never-swallow on send failure (Pitfall #4 explicitly addressed in the dev-fallback `delivered:false` shape), explicit TLS toggles. The file-header comment block accurately describes the implemented behaviour. The HIGH-severity finding HI-03 is a parsing-strictness gap, not a structural flaw.
- **`@openwhispr/observability`** is the strongest of the four packages. Real exported API, real consumers in `apps/api/src/plugins/request-log.ts` and `apps/worker/src/lib/with-{tenant,system}-context.ts`, sentinel test in `tests/e2e/log-scrub-sentinel.test.ts`. Findings are about parity/maintenance, not correctness.
- **`@openwhispr/auth` and `@openwhispr/i18n`** are both Phase-0 placeholder shells that should not ship under their final names. They violate the project's "publish boring proven stack" promise to first-time OSS contributors who will see `@openwhispr/auth` in `pnpm-workspace.yaml` and assume there is auth code there.
- **Architectural concern (cross-package):** Three of these four packages mark `"phase": "phase-0-placeholder"` in `package.json` (`auth`, `i18n`, `observability`). For `observability` that marker is now lying — the package has shipped real Phase-6 code per its own header comments. The `phase` field is unmaintained metadata; either remove it from all four manifests or update it to reflect the highest implemented phase.

---

_Reviewed: 2026-05-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
