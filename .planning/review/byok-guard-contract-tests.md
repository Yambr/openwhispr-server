# Review: byok-guard + contract-tests
Branch: main @ 13f0864
Files reviewed: 12

Scope:
- `packages/byok-guard/src/index.ts`
- `packages/byok-guard/src/redact-url.ts`
- `packages/contract-tests/src/index.ts`
- `packages/contract-tests/src/errors.ts`
- `packages/contract-tests/src/env.ts`
- `packages/contract-tests/src/schemas.ts`
- `packages/contract-tests/src/negative-matrix.ts`
- `packages/contract-tests/src/helpers/http.ts`
- `packages/contract-tests/src/helpers/cookie-jar.ts`
- `packages/contract-tests/src/helpers/multipart.ts`
- `packages/contract-tests/src/helpers/sign-in-fixture.ts`
- `packages/contract-tests/src/helpers/streaming.ts`

Method: source read + dynamic probe via `tsx` exercising `redactUrl` and `assertBYOKConfig` with adversarial inputs (whitespace, sentinel casing, fragments, JWT shapes, substring collisions). Output captured during review.

## Summary
- CRITICAL: 3 / HIGH: 6 / MEDIUM: 6 / LOW: 4
- Top 3 production risks:
  1. **`redactUrl` does not match `Bearer ey…` / JWT shapes despite scope listing it** — JWT access tokens in any URL component pass through to logs. Documented mandatory shape silently unenforced.
  2. **`redactUrl` ignores URL fragments** — OAuth2 implicit-flow access tokens are returned as `https://callback#access_token=…`. The redactor never inspects `u.hash`, so any operator who logs a callback URL leaks the bearer token verbatim.
  3. **Two divergent `redactUrl` implementations** — `apps/api/src/lib/redact-url.ts` is the one actually wired into `apps/api/src/index.ts:575/609/643` for runtime catch-arm log lines, and it only masks `URL.password`. The "newer" copy in `packages/byok-guard/src/redact-url.ts` (with username + querystring + path-segment sweeps) is referenced ONLY from the boot-time guard's hint string. The byok-guard header comment "SOURCE OF TRUTH: this file (Phase 40 supersedes the apps/api/src/lib copy)" is false — production logs the inferior version.

## Findings

### [CRITICAL] CR-01 — `Bearer ey…` / JWT shape not in `BEARER_SHAPES` regex set
- File: `packages/byok-guard/src/redact-url.ts:51-56`
- Scope explicitly lists `Bearer ey...` as a required credential shape. The `BEARER_SHAPES` array contains only `sk-`, `sk-ant-`, `AIza`, `AKIA` — no `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` regex, no `Bearer\s+ey…` regex.
- Probe evidence (dynamic):
  - in: `https://api.example.com/v1/eyJhbGciOiJIUzI1NiJ9.payload.sig`
  - out: `https://api.example.com/v1/eyJhbGciOiJIUzI1NiJ9.payload.sig` (UNCHANGED — token leaked).
- Impact: Better Auth session JWTs, OpenAI realtime ephemeral keys, AssemblyAI v3 tokens, Deepgram streaming tokens — every JWT-shaped credential in this codebase — pass through the redactor unmasked. The boot-time hint `buildHint('storage', redactUrl(endpoint))` and any caller that runs `redactUrl(jwt_url)` then `logger.info(...)` writes the raw JWT to Loki.
- Fix: add `/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g` and `/Bearer\s+ey[A-Za-z0-9_.\-+/=]+/gi` to `BEARER_SHAPES`. Sweep `u.pathname`, `u.hash`, AND query VALUES (see CR-02 + HI-04).

### [CRITICAL] CR-02 — URL fragment never inspected; OAuth implicit-flow tokens leak verbatim
- File: `packages/byok-guard/src/redact-url.ts:71-103` (entire `redactUrl` body)
- The function reads/writes `u.username`, `u.password`, `u.searchParams`, `u.pathname` — but never touches `u.hash`. OAuth2 implicit / hybrid flows return access tokens in the URL fragment: `https://app/callback#access_token=…&id_token=…&expires_in=…`. Channel-scheme echo callbacks per `OAUTH_SPEC.md` are a documented surface in this codebase.
- Probe evidence:
  - in: `https://host/v1#access_token=sk-abcdefghijklmnopqrstuvwxyz123456`
  - out: `https://host/v1#access_token=sk-abcdefghijklmnopqrstuvwxyz123456` (UNCHANGED — both the param name `access_token` AND the `sk-` shape leaked).
- Fix: parse `u.hash` (strip leading `#`) as `URLSearchParams`, run the same `isCredentialParam` sweep + bearer-shape sweep, write back.

### [CRITICAL] CR-03 — Two diverging `redactUrl` implementations; production catch-arms use the WEAKER one
- Files: `apps/api/src/lib/redact-url.ts` (Phase-13 vintage, masks only `URL.password`) vs `packages/byok-guard/src/redact-url.ts` (Phase-40 vintage, masks username + password + querystring + path bearer shapes)
- `apps/api/src/index.ts:107` imports from `./lib/redact-url.js` and uses it at L575 (Valkey catch arm), L609 (LiteLLM catch arm), L643 (Valkey catch arm). The "newer" version vendored into `packages/byok-guard/` is exercised ONLY by `assertBYOKConfig`'s boot-time hint string. Production runtime warn/error log paths use the OLD version.
- The byok-guard header comment falsely claims:
  > `SOURCE OF TRUTH: this file (Phase 40 supersedes the apps/api/src/lib copy).`
  but no commit removes or forwards the apps/api copy.
- Impact: an `S3_ACCESS_KEY` embedded as `?X-Amz-Credential=…`, an `sk-` token in `LITELLM_BASE_URL`'s path, or a Postgres URL with username are NOT masked by the runtime catch-arm logs. Loki receives plaintext.
- Fix: delete `apps/api/src/lib/redact-url.ts`, re-export from `@openwhispr/byok-guard`, and update apps/api/src/index.ts import. Add a lint rule to fail CI if both files exist.

### [HIGH] HI-01 — Whitespace-only env values silently pass `!env[k]` falsy check
- File: `packages/byok-guard/src/index.ts:137-162` (storageRow), :168-181 (observabilityRow), :184-194 (ingressRow), :202-213 (pgbouncerRow), :220-232 (devToolsRow)
- All rows use `!env.X` / `!env[k]` to decide "missing". A YAML `S3_ACCESS_KEY: " "` or shell `S3_ACCESS_KEY=$UNSET ` (trailing space from unset interpolation) yields a truthy non-empty string. Guard returns clean. The S3 SDK then receives a single-space access key and 4xx's at first PUT, in a code path with no boot-time loud-fail.
- Probe evidence: `{...full, S3_ACCESS_KEY: " "}` → `OK (no throw)` — guard accepts.
- Fix: replace `!env[k]` with `(env[k] ?? "").trim().length === 0` across all five rows.

### [HIGH] HI-02 — `=disabled` sentinel is case-sensitive and trailing-space-intolerant; misconfig silently slips past guard
- File: `packages/byok-guard/src/index.ts:170`
- `if (otlp === "disabled") return null;` is strict-equal on the unmodified string.
- Probe evidence:
  - `OTEL_EXPORTER_OTLP_ENDPOINT="DISABLED"` → guard returns clean (treated as if the operator had set a real endpoint — but otel-bootstrap will then try to dial `DISABLED` as a URL and crash).
  - `OTEL_EXPORTER_OTLP_ENDPOINT="disabled "` → same problem (trailing space).
- Impact: silent boot-time misconfig. The operator thought they disabled OTLP; otel-bootstrap thinks they configured an endpoint named "DISABLED"; first OTLP export attempt throws and the api process either crashes or spams the error log.
- Fix: `if (otlp.trim().toLowerCase() === "disabled") return null;`. Pair with `.trim()`-aware emptiness check (HI-01).

### [HIGH] HI-03 — `NODE_ENV !== "production"` strict-equal bypasses SMTP gate for `Production` / `PRODUCTION`
- File: `packages/byok-guard/src/index.ts:221`
- A capitalized `NODE_ENV=Production` (common in PaaS dashboards, Heroku CLI tutorials, k8s manifests pasted from blog posts) skips the SMTP-required check.
- Probe evidence: `NODE_ENV=Production, SMTP_HOST unset` → `OK (no throw)`. Downstream email subsystem then logs "SMTP not configured" warnings and silently drops mail (verification emails, password-reset emails).
- Fix: `if (env.NODE_ENV?.toLowerCase() !== "production") return null;` — or, better, route NODE_ENV through the codebase's canonical `mode` resolver from `bootstrap.ts` and DROP the `env.NODE_ENV` read entirely (LOCKER-01 spirit, even though this file is allowlisted at `tools/lint-no-env-branches.allowlist.txt:26`).

### [HIGH] HI-04 — Bearer shapes inside QUERY VALUES not swept
- File: `packages/byok-guard/src/redact-url.ts:80-91`
- Querystring sweep masks values only when the PARAM NAME matches `isCredentialParam`. If the value is a bearer-shaped token but the param name is mundane (`?next=`, `?redirect=`, `?session=`, `?ref=`), the `sk-` / `AIza` / `AKIA` token survives.
- Probe evidence:
  - in: `https://host/v1?foo=sk-Abcdefghijklmnopqrstuvwxyz123456`
  - out: `https://host/v1?foo=sk-Abcdefghijklmnopqrstuvwxyz123456` (UNCHANGED).
- Fix: after the param-name sweep, iterate values and apply `BEARER_SHAPES.replace` to each value; rewrite via `params.set(k, masked)`.

### [HIGH] HI-05 — Cascade for `INGRESS_BASE_URL` documented (scope checklist) but absent from code
- File: `packages/byok-guard/src/index.ts:184-194`
- Storage row enforces atomic-set cascade (`S3_ENDPOINT → ACCESS_KEY + SECRET_KEY + BUCKET`). Ingress row enforces NO cascade. The CONTEXT.md decision-2 surface for ingress is opaque — TLS cert paths, ACME email, hostname, public-vs-internal scheme are all candidates. The current row will pass with `INGRESS_BASE_URL=https://example.com` and zero TLS config; Traefik then 503's on first request.
- Either (a) document explicitly in the row JSDoc "INGRESS_BASE_URL has no cascade — Traefik consumes its own env file", OR (b) add a real cascade (e.g. `INGRESS_TLS_EMAIL`, `INGRESS_PUBLIC_HOST`).
- Pick one — today this row is a stub with the same trivially-passing shape as `pgbouncerRow`, and the scope checklist specifically called this out as an open question.

### [HIGH] HI-06 — `fetchAndParse` does not default `redirect:'error'`; suite silently follows 308 to wrong scheme
- File: `packages/contract-tests/src/helpers/http.ts:25-27`
- `await fetch(url, init)` passes `init` through verbatim. `env.ts` documents (D-05) that `probeBackend()` MUST set `redirect:'error'` to loud-fail on Traefik's HTTPS-redirect. `fetchAndParse` — the helper used by every CONTRACT-01 read — does NOT default `redirect:'error'`. A stale `BACKEND_URL=http://api.localhost` will silently 308 to https, where the request body may be lost (Traefik rewrites GET only) and contract assertions run against the wrong target.
- Fix: `await fetch(url, { redirect: 'error', ...init });` — caller can still override.

### [MEDIUM] ME-01 — Regex bearer shapes lack word boundaries; substring matches produce confusing log lines
- File: `packages/byok-guard/src/redact-url.ts:51-56`
- `/sk-[A-Za-z0-9_-]{20,}/g` matches inside `/musk-abcdefghijklmnopqrstuvwxyz/` producing `/mu***/`. Not a security defect (over-masking is safe), but it ALSO will eat a real path segment like `/sk-loaded-data-…` if it happens to be long enough.
- Probe evidence:
  - in: `https://host/musk-abcdefghijklmnopqrstuvwxyz/path`
  - out: `https://host/mu***/path`
- Fix: anchor with `(?:^|[^A-Za-z0-9])(sk-…)(?=$|[^A-Za-z0-9])` or split path into segments and apply per-segment.

### [MEDIUM] ME-02 — `cookie-jar.ts` swallows tough-cookie `setCookie` errors with `ignoreError:true` AND a catch
- File: `packages/contract-tests/src/helpers/cookie-jar.ts:41-46`
- Calling `await jar.setCookie(sc, url, { ignoreError: true })` already swallows. Wrapping it in `try/catch{}` is redundant AND, when `setCookie` rejects despite `ignoreError`, the catch silently eats the failure. Comment "tough-cookie throws on invalid Domain — swallow to keep the contract test focused" is exactly the anti-pattern: a Set-Cookie shape the SERVER emitted that tough-cookie cannot parse IS the regression we want to catch.
- Fix: drop the catch, let `ignoreError` do its job, or at minimum log via `process.stderr.write`.

### [MEDIUM] ME-03 — `STREAMING_HELPERS_PLACEHOLDER` is a dead module
- File: `packages/contract-tests/src/helpers/streaming.ts`
- Exports a single `true` constant with zero importers in the workspace (grep: 0 hits outside the file). Phase 4 landed long ago. The file is residue.
- Fix: delete the file. If kept for "import surface stability", at least add a regression test that asserts its import surface (the file currently has no test, contradicting its own raison d'être).

### [MEDIUM] ME-04 — `harnessLoaded()` is a self-validating no-op
- File: `packages/contract-tests/src/index.ts:10-12`
- Exports a function whose only consumer is `tests/unit/loads.test.ts` which asserts it returns `true`. Functionally indistinguishable from `export const harnessLoaded = true`.
- Fix: delete or replace with a real readiness probe (e.g. assert wire-schemas re-exports are present).

### [MEDIUM] ME-05 — `TolerantEnvelope` exported but RE-DECLARED locally in `tests/e2e/phase-05-negative-matrix.spec.ts:20`
- File: `packages/contract-tests/src/negative-matrix.ts:21-30`
- The schema is exported as the canonical source of truth. A consumer copy-pasted it instead of importing. Drift inevitable: if the union grows (`{error: {message,code,traceId}}`) the e2e suite will silently pass on the old union shape.
- Fix: import from `@openwhispr/contract-tests/negative-matrix` (add to package `exports` map first — only `.` and `./schemas` are exported today).

### [MEDIUM] ME-06 — Helpers `signInFixture` / `makeJarFetch` / `JarFetch` re-implemented in `tests/e2e/sign-in.ts`
- Files: `packages/contract-tests/src/helpers/sign-in-fixture.ts` vs `tests/e2e/sign-in.ts`
- The repo has TWO `signInFixture` + `makeJarFetch` implementations, used by different test suites. `apps/web/tests/e2e/fixtures/auth.ts:38` separately declares `FIXTURE_PASSWORD = "Pwa9!#testStrong"` — a DIFFERENT literal than the contract-tests `"test-PW-12345!"`. Three sources of truth for the same fixture. The contract-tests package is dead-on-arrival as a shared helper.
- Fix: delete `tests/e2e/sign-in.ts`, point e2e at `@openwhispr/contract-tests`. Reconcile `FIXTURE_PASSWORD` literals.

### [LOW] LO-01 — Unused type exports in `packages/byok-guard/src/index.ts`
- `BYOKOverlay`, `BYOKErrorCode`, `AssertBYOKConfigOpts` are exported but no external consumer (grep: hits only within byok-guard's own tests). `BYOKFatalRecord` is consumed by tests only.
- Fix: drop `export` keyword on the unused four; keep `BYOKGuardError` + `assertBYOKConfig` as the public surface.

### [LOW] LO-02 — `multipart.ts` reaches up four `..` levels with `readFileSync` at module load
- File: `packages/contract-tests/src/helpers/multipart.ts:29`
- `resolve(__dirname, "../../../../tests/fixtures/audio", filename)` — fragile relative-path coupling. If the package is ever published (per scope: "this package SHIPS"), it cannot read repo-root test fixtures. Today this works because tests are workspace-internal.
- Fix: accept an absolute fixture root via param or `FIXTURE_ROOT` env, default to current behaviour.

### [LOW] LO-03 — `boundary` value uses `Math.random()` for uniqueness
- File: `packages/contract-tests/src/helpers/multipart.ts:26`
- `Math.random()` is non-CSPRNG. Not a security issue for multipart boundaries (no adversary), just a "did you mean `crypto.randomUUID()`?" smell.

### [LOW] LO-04 — `sign-in-fixture.ts:90-92` interpolates email + body into Error message
- File: `packages/contract-tests/src/helpers/sign-in-fixture.ts:88-94`
- `throw new Error(\`signInFixture(${email}) failed: HTTP ${res.status} body=${text.slice(0, 200)}\`)` — body is truncated (good), but a future Better Auth release that echoes the submitted password into its 4xx body would partially leak into the error. LOCKER-05 (Phase 37 BLOCKING) requires Error subclasses to truncate body fields at construction. This is a plain `Error`, not a subclass — outside the lint scope, but still relevant.
- Fix: scrub by replacing any `password.{0,200}` substring with `"***"` before interpolating, or convert to a subclass that LOCKER-05 will police.

## Dead code

- `packages/contract-tests/src/helpers/streaming.ts` — `STREAMING_HELPERS_PLACEHOLDER` (ME-03).
- `packages/contract-tests/src/index.ts` — `harnessLoaded()` (ME-04).
- `packages/byok-guard/src/index.ts` — unused exported types `BYOKOverlay`, `BYOKErrorCode`, `AssertBYOKConfigOpts` (LO-01).
- `packages/contract-tests` — entire package, as a SHARED helper layer, is dead — its primary helpers (`signInFixture`, `makeJarFetch`, `FIXTURE_PASSWORD`) are duplicated in two other places (ME-06). Contract-tests is exercised only by its own internal unit tests; no other workspace member imports `@openwhispr/contract-tests` symbols (verified via grep of `from "@openwhispr/contract-tests"` — zero hits outside the package).

## Suppressed warnings

None. Scope is free of `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `as any`, `as unknown as`. LOCKER-02 clean.

## Notes

- LOCKER-01 (no NODE_ENV branching): `packages/byok-guard/src/index.ts:221` is on the documented allowlist (`tools/lint-no-env-branches.allowlist.txt:26`). Per CLAUDE.md the lint passes — but the spirit of the rule is to confine NODE_ENV reads to bootstrap; the SMTP gate could instead consume a resolved `mode` injected by the entrypoint. See HI-03 for a behavioural defect inside this same line.
- LOCKER-05 (truncated body-fields on Error subclasses): `MalformedUpstreamEnvelopeError` in `packages/contract-tests/src/errors.ts:18-57` is fully compliant — `bodyText` is `#`-private (non-enumerable, structured-clone safe), truncated at construction to 200 chars via `args.bodyText.slice(0, MAX_BODY_TEXT_LEN)`, and `toJSON()` overrides the JSON shape to exclude the body. Clean exemplar.
- `redactUrl` does NOT throw on any tested input (empty string, whitespace-only, garbage `not-a-url`, valid postgres/s3/https with userinfo). Boot-time loud-fail-path safety property holds.
- `assertBYOKConfig` correctly throws `BYOKGuardError` (does NOT `process.exit`) — Phase 19 / Plan 02 D-09 contract met. Synchronous Pino destination on fd 2 verified at line 83. Process-boundary discipline restored as designed.
- `.env` in `packages/byok-guard/` is gitignored (verified via `git check-ignore`). Confirmed it contains only `STRONG_FIXTURE_*` placeholders, not real secrets. Not a leak — but it IS anomalous for a private package to carry an `.env`; recommend moving to `tests/` or a `compose/` overlay so contributors don't grep it as authoritative config.
- `BACKEND_URL` defaults to `http://api.localhost` (not https). For a published harness package this is conservative; for the project's own use it conflicts with the "HTTPS only" constraint in CLAUDE.md. Document this asymmetry — contract harness is a CLIENT, not a server, so plaintext default is acceptable for local dev, BUT the `probeBackend()` `redirect:'error'` discipline (D-05) is the safety net. Re-verify that net under HI-06.
- The probe scripts that generated the dynamic evidence in CR-01/CR-02/HI-01/HI-02/HI-03/HI-04/ME-01 are at `/tmp/probe-redact.mjs` + `/tmp/probe2.mjs` + `/tmp/probe3.mjs` for reproduction; each was executed via `npx tsx`.
