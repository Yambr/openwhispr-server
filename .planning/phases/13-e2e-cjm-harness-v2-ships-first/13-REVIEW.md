---
phase: 13-e2e-cjm-harness-v2-ships-first
reviewed: 2026-05-14T12:55:00Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - packages/email/src/EmailSender.ts
  - apps/api/src/routes/probes.ts
  - apps/api/src/index.ts
  - apps/api/src/auth.ts
  - apps/worker/src/index.ts
  - tools/lint-cjm-doc.ts
  - tools/lint-weak-assertions.ts
  - tools/global-vitest-teardown.ts
  - tests/e2e-cjm/support/compose-harness.ts
  - tests/e2e-cjm/support/wait-for-readiness.ts
  - tests/e2e-cjm/support/mailpit-helper.ts
  - tests/e2e-cjm/support/world.ts
  - tests/e2e-cjm/support/fixtures.ts
  - tests/e2e-cjm/steps/auth.steps.ts
  - tests/e2e-cjm/steps/transcribe.steps.ts
  - tests/e2e-cjm/steps/signin.steps.ts
  - tests/e2e-cjm/steps/password-reset.steps.ts
  - tests/e2e-cjm/steps/oidc.steps.ts
  - tests/e2e-cjm/steps/admin.steps.ts
  - tests/e2e-cjm/steps/locale.steps.ts
  - tests/e2e-cjm/steps/signup-extras.steps.ts
  - tests/e2e-cjm/steps/error-paths.steps.ts
  - tests/e2e-cjm/playwright.config.ts
  - tools/global-vitest-teardown.ts
  - docker-compose.yml
  - Makefile
  - .github/workflows/e2e-cjm.yml
findings:
  critical: 0
  blocker: 0
  high: 2
  medium: 6
  low: 5
  info: 3
  total: 16
status: issues_fixed
---

# Phase 13: Code Review Report

**Reviewed:** 2026-05-14T12:55:00Z
**Depth:** standard
**Status:** issues_fixed

## Summary

Phase 13 ships the e2e-cjm harness, a real-SMTP EmailSender, the `/api/health` `migrations_completed` field with a dedicated owner pool, a CJM-doc linter, and a Vitest teardown for testcontainer leaks. Overall the implementation is high quality, defensive, and well-commented; coverage gate is satisfied per the verifier.

The review surfaces **no CRITICAL or BLOCKER issues**. Two HIGH issues are operationally meaningful (dev-fallback delivery-truth + bootstrap secret-leak via console.warn). The remainder are MEDIUM/LOW defensive-coding/quality items. Several findings are subtle race / fail-open behaviors that the harness will not catch but matter in production.

The most important items for an enterprise audience:
- `EmailSender` dev fallback returns `delivered: true` (loud-fail principle violated in non-prod; can mask test regressions).
- Bootstrap warns include `(err as Error).message` from `new Redis(url)` / LiteLLM config load, both of which can carry the credential-bearing URL.

## High Issues

### HI-01: EmailSender dev fallback returns `delivered: true` — silently lies to callers

**File:** `packages/email/src/EmailSender.ts:92-97`
**Issue:** When `SMTP_HOST` is unset in non-production, the no-op sender returns `{ delivered: true, reason: "smtp-not-configured" }`. Better Auth and downstream pipelines (BullMQ `email-delivery` job, `/api/auth/verify-email` flow, audit logs) treat `delivered:true` as "the SMTP server accepted the message." This contradicts the file-header comment "Pitfall #4: NEVER swallow" and the per-file constitutional rule "loud-fail." A developer running CI tests against a no-SMTP image will see green test runs that mask real `email.failed` regressions, and a corporate operator who forgets to set `SMTP_HOST` in a staging environment that is NOT `NODE_ENV=production` (e.g. `staging`, `qa`) gets a silent black hole.
**Fix:**
```ts
return {
  async send({ to, subject }) {
    log.warn({ to, subject, event: "email.skipped" }, "email skipped (SMTP not configured)");
    return { delivered: false, reason: "smtp-not-configured" };
  },
};
```
Then update Better Auth and the worker email-delivery job to treat `delivered:false` as a non-fatal skip in non-prod (logged), and to keep the user `email_verified=false`. Alternatively, gate the loud-fail on `env.NODE_ENV !== "development"` (instead of `=== "production"`) so any non-dev environment fails fast.

### HI-02: Bootstrap `console.warn` for Valkey/BullMQ/LiteLLM may leak credentials from URL-bearing error messages

**File:** `apps/api/src/index.ts:530-533, 558-561, 588-591`
**Issue:** Each catch-arm prints `(err as Error).message`. Both `new Redis(url)` and `new URL(process.env.VALKEY_URL)` (line 511) — and `loadLitellmConfigFromEnv()` — can throw errors whose message contains the offending URL verbatim (e.g. `ioredis` "Invalid URL: redis://user:secret@host:6379" or Node's URL parser "Invalid URL: redis://...@..."). Logging the URL means the container's stdout (which is shipped to Loki in the Phase-6 LGTM stack) will carry the Valkey password / LiteLLM master key in plaintext. This is a recurring class-of-bug across the three handlers; SCALE-04's SSRF-audit posture is undermined by the bootstrap WARN line that prints the secret in cleartext on the next line.
**Fix:** Sanitize before logging:
```ts
function redactUrl(s: string): string {
  try { const u = new URL(s); if (u.password) u.password = "***"; return u.toString(); }
  catch { return "<unparseable-url>"; }
}
// inside the catch:
console.warn("[buildApp] BullMQ ... :", redactUrl(process.env.VALKEY_URL ?? ""), (err as Error).name);
```
And `String(err)` itself can include the URL when ioredis/undici embed it — prefer logging `err.name` + a fixed remediation string, never `err.message` verbatim when an upstream env URL is in scope.

## Medium Issues

### ME-01: `/api/health.migrations_completed` swallows ALL errors, including auth/RLS misconfig → silent fail-open for the readiness gate

**File:** `apps/api/src/routes/probes.ts:134-140` and `apps/api/src/index.ts:638-651`
**Issue:** Both layers `catch {}` and coerce to `false`. The probes.ts comment explicitly says "Errors thrown by `migrationsCheck` are swallowed... `/api/health` (an alias of `/livez`) never cascades a kubelet restart on a migrations-probe hiccup." This is correct in spirit, but the harness AND `wait-for-readiness.ts` poll until `migrations_completed:true` — so a real misconfig (owner pool wrong DSN, role lacks USAGE, table renamed) is indistinguishable from "not yet run" and the readiness probe loops to its full timeout (240s in compose-harness) instead of failing loud. Operators get NO log signal explaining why the harness/readiness keeps polling.
**Fix:** Log the underlying error at WARN inside both catches; keep the `false` return so kubelet doesn't restart, but emit a structured one-time per-process WARN (rate-limited) so the operator/harness sees `event=migrations_check.failed err=...` in stdout. Critical: keep the log line scrubbed of `DATABASE_URL_OWNER` content (same redaction concern as HI-02).

### ME-02: Dedicated owner pool (`probeOwnerPool`) is never closed — leaks at process exit

**File:** `apps/api/src/index.ts:635-651`
**Issue:** The comment on line 629 promises "The pool is closed at process exit via the existing shutdown hook below," but there is NO `probeOwnerPool.end()` in the file (the only `app.listen` failure handler `process.exit(1)`s without closing pools, and there's no SIGTERM handler in index.ts at all — unlike apps/worker/src/index.ts which has one). On `docker stop api` (Traefik graceful drain), the pool's TCP socket is RST'd, leaving an unclean termination on the PG side. Under 1000-concurrent autoscaling churn this manifests as PG `unexpected EOF on client connection` warnings.
**Fix:** Either (a) add a SIGTERM handler to apps/api/src/index.ts that calls `probeOwnerPool.end()` (and `appPool.end()` / `redis.quit()` while you're at it), or (b) tag the pool `{ max: 1, allowExitOnIdle: true, idleTimeoutMillis: 5_000 }` so it self-releases when not under active probe load.

### ME-03: `auth.ts` variable interpolation passes `name: user.email` to the worker template — leaks email into both `{name}` and `{verification_url}` rendering surfaces

**File:** `apps/api/src/auth.ts` (around line 337 of the diff: `variables: { verification_url: url, url, name: user.email }`)
**Issue:** The worker's email template interpolates `{name}` into both plaintext + HTML bodies. Passing `user.email` as `name` means the email body greets recipients with their own email address in the "name" slot — minor UX smell, but more importantly: if the worker renderer does NOT HTML-escape (Phase 10 review responsibility, not this diff), an attacker who signs up with `name+<script>x</script>@evil.com` could land XSS via the verification email rendering. Better Auth's `user.email` is validated to RFC-5321 form, which forbids most HTML metacharacters — but `+` / `'` / `"` are permitted local-part chars in RFC-5321. Defense-in-depth: pass an actual `name` field (Better Auth surfaces `user.name`) and fall back to `user.email.split("@")[0]`.
**Fix:**
```ts
variables: { verification_url: url, url, name: user.name ?? user.email.split("@")[0] },
```

### ME-04: `wait-for-readiness.ts` and `mailpit-helper.ts` accept self-signed TLS for any `*.localhost` — but the env-override path can also flip to non-localhost

**File:** `tests/e2e-cjm/support/wait-for-readiness.ts:80-91` and `mailpit-helper.ts:67-78`
**Issue:** The localhost-only TLS-trust dispatcher is correct for the canonical paths. However, the env-override `READINESS_HEALTH_URL` / `MAILPIT_API_URL` (CI / staging slices) is a string the harness reads at process start — if someone configures `READINESS_HEALTH_URL=https://staging.example.com/api/health` AND that staging endpoint serves a self-signed cert, the harness will fail TLS verification (correct), but if the URL is `https://10.0.0.5.localhost.evil.tld` an attacker who controls DNS can serve a self-signed cert and the harness will accept it because the suffix `.localhost` matches. Low-impact (harness is operator-owned and never touches secrets), but the `.endsWith(".localhost")` rule is a porous suffix check.
**Fix:** Tighten to `host === "localhost" || /^[\w-]+\.localhost$/.test(host)` so multi-label hostnames like `evil.localhost.attacker.tld` don't qualify. Alternatively gate the self-signed acceptance behind `process.env.CI !== "true" && process.env.E2E_CJM === "1"`.

### ME-05: `tests/e2e-cjm/steps/auth.steps.ts:275` — `expect(newer).toHaveLength(0)` runs inside the polling loop only when `res.ok` — silently passes if mailpit is permanently down

**File:** `tests/e2e-cjm/steps/auth.steps.ts:260-279`
**Issue:** The "no second verification email" gate does `if (res.ok) { ... expect(newer).toHaveLength(0); }` inside a `while (Date.now() < deadline)` loop. If mailpit returns 5xx for the entire window, NO assertion runs and the step returns successfully (the loop just exits on deadline). A real bug where mailpit is unreachable would silently pass this negative-twin gate, defeating the @cjm-1.2 invariant.
**Fix:** Track `let queriedSuccessfully = false;` inside the loop and `expect(queriedSuccessfully).toBe(true)` after the loop exits. The current shape relies on the implicit "the framework will eventually fail if mailpit is dead elsewhere" — but @cjm-1.2 is exactly the negative twin meant to surface this category of regression.

### ME-06: Makefile `e2e-cjm` target writes to repo-root `.e2e-cjm-user-was-running` — race + cleanup gap

**File:** `Makefile` (lines added in 13-01)
**Issue:** Two concurrent contributors running `make e2e-cjm` in parallel checkouts of the same repo (not realistic, but Bazel/nx-style monorepos do this) clobber each other's sentinel file. More importantly: if the `e2e-cjm` target is killed with `SIGKILL` (parent shell dies, OOM, `docker compose` segfault), the trap does NOT fire, the sentinel file persists across runs, and the next `make e2e-cjm` invocation may restart the user's stack on teardown even though the user explicitly told it not to run before. The sentinel is also outside `.gitignore` — `git status` shows it.
**Fix:** (a) Move sentinel to `$$XDG_RUNTIME_DIR/openwhispr-e2e-cjm-$$PPID` (per-process, auto-cleared on reboot). (b) Add `.e2e-cjm-user-was-running` to `.gitignore`. (c) Use `set -eo pipefail` at the top of the recipe so a docker-compose failure aborts cleanly. The current `set -e` only aborts on direct command failures, not pipe failures.

## Low Issues

### LO-01: `Number(env.SMTP_PORT ?? "587")` accepts garbage and silently produces NaN

**File:** `packages/email/src/EmailSender.ts:100`
**Issue:** `Number("not-a-port")` → NaN, then nodemailer fails opaquely at first send rather than at boot. Same pattern in `worker/src/index.ts:99` (`Number(process.env["VALKEY_PORT"] ?? "6379")`) and `index.ts:515` (`Number(url.port || 6379)`).
**Fix:** Validate with `Number.isInteger(port) && port > 0 && port < 65536` and throw at construction time. Mirror the loud-fail posture of the SMTP_HOST gate.

### LO-02: `wait-for-readiness.ts` deserializes mailpit/api JSON without max-size cap

**File:** `tests/e2e-cjm/support/wait-for-readiness.ts:137-141`, `mailpit-helper.ts:108`, multiple step files
**Issue:** `await res.text()` / `await res.json()` is unbounded. A misbehaving mailpit (or hostile readiness URL via env override) could stream gigabytes into the harness process. Not exploitable in normal harness flow (operator owns the URLs), but harness-eats-memory is a real CI failure mode.
**Fix:** Use `AbortController` + a max-body-size check (`res.body.getReader()` + counter). Or — easier — set a `Content-Length` cap via undici's response-body limit option.

### LO-03: `lint-cjm-doc.ts:60-63` regex flags `g` and `lastIndex` reset — concurrent calls share state

**File:** `tools/lint-cjm-doc.ts:60-63, 73, 97`
**Issue:** `ANCHOR_RE` and `SECTION_HEADING_RE` are module-scope `g`-flag regexes. The code resets `lastIndex = 0` defensively, but if `extractAnchors()` and `lintCjmDoc()` are called concurrently (e.g. Vitest concurrent mode), the shared `lastIndex` races. Not exercised today; a known JS footgun.
**Fix:** Either construct the regex locally inside each function, or use `text.matchAll(new RegExp(ANCHOR_RE.source, "gm"))` to materialize a fresh instance per call.

### LO-04: `compose-harness.ts:131` passes `env: process.env` directly into `spawn`

**File:** `tests/e2e-cjm/support/compose-harness.ts:131, 150`
**Issue:** Forwarding the full parent env to `docker compose` exposes any harness-injected secrets (e.g. `OPENROUTER_KEY` etc.) into the child compose process's environment, which then propagates into containers via compose's `environment:` resolution. Most are needed (DATABASE_URL_OWNER, SMTP_HOST, MAILPIT_API_URL); a deny-list / explicit allow-list is safer.
**Fix:** Build a derived env with the explicit compose-needed keys only, OR document this as accepted at the harness layer (compose handles its own scope). Either way add a one-line audit-trail comment.

### LO-05: `tests/e2e-cjm/steps/password-reset.steps.ts:66-70` ignores the `forget-password` POST response status

**File:** `tests/e2e-cjm/steps/password-reset.steps.ts:66-70`
**Issue:** The step `When the user requests a password reset` calls `postJsonRaw(...)` and discards the response. If Better Auth returns 5xx (e.g. SMTP down), the "Then a password-reset email arrives in mailpit within {int} seconds" step polls to deadline and throws with the cutoff time, but the operator never sees the underlying 5xx → root-cause obscured. Same pattern as ME-05.
**Fix:** Assert `expect(res.status).toBeLessThan(500)` immediately after the POST.

## Info

### IN-01: `tests/e2e-cjm/steps/auth.steps.ts:222` hardcodes `email = "cjm-1-2@e2e.test"`

**File:** `tests/e2e-cjm/steps/auth.steps.ts:222`
**Issue:** The "duplicate signup" step hardcodes the email instead of pulling from the scenario fixture / feature parameter. If two scenario runs target the same mailpit in parallel (workers=1 today, but future-proofing), the second run sees stale state.
**Fix:** Read the email from the feature step parameter or fixture. Currently `workers: 1` and per-scenario isolation is via UUID `tenantId`; this string literal undermines that contract.

### IN-02: `apps/worker/src/index.ts:97-100` references `process.env["VALKEY_HOST"]` separately from `process.env.VALKEY_URL` used by apps/api

**File:** `apps/worker/src/index.ts:97-101` vs `apps/api/src/index.ts:508`
**Issue:** The worker uses `VALKEY_HOST` + `VALKEY_PORT` + `VALKEY_PASSWORD`; the api uses `VALKEY_URL`. Two sources of truth for the same Valkey instance — drift risk over time. Document or unify.

### IN-03: `tests/e2e-cjm/playwright.config.ts:43` hardcodes `workers: 1`

**File:** `tests/e2e-cjm/playwright.config.ts:43`
**Issue:** `workers: 1` is the safest setting given mailpit's shared inbox + Better Auth's process-wide rate limit; documented intent. With per-scenario UUID emails (already implemented for most steps), `workers: N` would scale CI time. Not a defect; an enhancement opportunity flagged for future.

## Findings Above HIGH Severity

**Two HIGH issues, no CRITICAL/BLOCKER.** The two HIGH items (HI-01 silent-success email no-op, HI-02 secret-leaking bootstrap warns) are correctness/security-posture defects worth fixing before this code carries load at scale; neither blocks the phase-13 ships-first goal.

## Fixes Applied

Closed in commit `5c579d3` — `fix(13): close HI-01 (email loud-fail in non-prod) + HI-02 (redact creds in bootstrap warn)`:

- **HI-01 (closed)** — `packages/email/src/EmailSender.ts` dev-fallback now returns `{ delivered: false, reason: "smtp-not-configured" }` with WARN log per send (was: silent `delivered:true`). `apps/worker/src/jobs/email-delivery.ts` gained a `nodeEnv` dep and treats the canonical `smtp-not-configured` reason as a non-fatal skip in non-prod (no spurious BullMQ retries); production keeps the loud-fail throw as defence-in-depth on top of the EmailSender construction-time gate. Test suite at `packages/email/src/EmailSender.test.ts` covers the new behaviour with three additional cases (delivered:false, WARN event, regression guard) + worker tests at `apps/worker/src/jobs/email-delivery.test.ts` cover both env-gates. Coverage on `packages/email`: 100% / 100% / 100% / 100% (25 tests).
- **HI-02 (closed)** — new `apps/api/src/lib/redact-url.ts` helper masks the password component of any URL string (returns `<unparseable-url>` on parse failure, including empty input). All three bootstrap catch arms in `apps/api/src/index.ts` (BullMQ email-delivery queue, LiteLLM client, Valkey/Redis client) now log `redactUrl(env)` + `(err as Error).name` instead of `(err as Error).message`. `apps/api/src/lib/redact-url.test.ts` covers the helper directly (8 cases); `apps/api/src/lib/redact-url-bootstrap-usage.test.ts` is a source-level lint asserting (a) each catch arm wires through `redactUrl` against the correct env variable and (b) `(err as Error).message` does not reappear anywhere in `index.ts`. Coverage on `apps/api/src/lib/redact-url.ts`: 100% / 100% / 100% / 100% (14 tests).

The remaining MEDIUM (ME-01..06), LOW (LO-01..05), and INFO (IN-01..03) findings are intentionally deferred — the prompt scope was HIGH-only.

---

_Reviewed: 2026-05-14T12:55:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Fixes applied: 2026-05-14 (HI-01 + HI-02 in commit 5c579d3)_
