# Phase 10: i18n + Docs + OSS Housekeeping — Research

**Researched:** 2026-05-13
**Domain:** runtime i18n (en+ru, ICU plurals) + OSS docs + Apache-2.0 housekeeping + ADRs
**Confidence:** HIGH (web i18n scaffolding live, infra inventory grep-verified, requirements pinned)

---

## Summary

Phase 10 is two distinct workstreams glued by a single CI gate:

1. **Runtime i18n** — extend the existing English-only Phase-07.1 web i18next stack to en+ru, add the **server-side** i18next surface (API error envelopes, worker email templates), wire CLDR plural rules via `i18next-icu`, negotiate locale from `Accept-Language` (and `NEXT_LOCALE` cookie on web), and ship a TEST-I18N-01 completeness gate. The web app already runs `i18next@26.1` + `react-i18next@17.0.7` + `i18next-resources-to-backend@1.2.1` with **200+ keys** across `common.json` / `admin.json` / `end-user.json` (verified at `apps/web/src/locales/en/`) — Russian bundles are entirely absent. The API has **89 inline `reply.send({error:...})` sites** plus **22 typed `throw new AuthError/NotFoundError/...` sites** funneled through ONE chokepoint (`apps/api/src/error-handler.ts:92` — `setErrorHandler`), so server-side translation happens in exactly one place. The worker BullMQ `email-delivery` payload already declares `locale: z.enum(["en","ru"])` and a `TemplateRenderer` interface stub — Phase 10 implements the renderer.
2. **Docs + OSS housekeeping** — six new docs (`architecture.md`, `i18n.md`, `security.md`), four extended docs (`README.md`, `operations.md`, `auth.md`, `wire-contract.md`), **8–10 new ADRs** (existing: 0000-template, 0001-pnpm, 0002-vitest/stryker, 0003-english-only), a critical **LICENSE bug fix** (the file at the repo root is **MIT**, not Apache-2.0 — the README claims Apache-2.0, CONTRIBUTING says Apache-2.0, DOCS-07 requires Apache-2.0), and `.github/` housekeeping (no ISSUE_TEMPLATE/, no CODEOWNERS).

**Primary recommendation:** Single chokepoint for server translation = `error-handler.ts` (already centralizes envelope emission per Phase-2 D-13). Push every emission site to throw typed errors with a **stable error code** (`AuthError("unauthorized")` → `errors.unauthorized`), translate at the chokepoint using `req.i18n.t(code)`. **Audit-log payload values stay English (constitutional rule, DOCS-09 / ADR-0003 forbids Cyrillic in source artifacts and `audit_log.action` is a CHECK-constrained enum). Localization for any audit summary surface is a *web-side render* concern, not a payload concern.**

**Plan complexity:** 4 plans (i18n-server-api, i18n-web-russian, docs-suite, oss-housekeeping-and-adrs). Predicted ≈ 60–80 tasks. Median plan size 15–20 tasks.

---

## User Constraints (from CONTEXT.md)

No CONTEXT.md exists for Phase 10 (research-phase-only spawn). Constraints derived from:
- `/Users/nick/openwhispr-server/CLAUDE.md` — runtime i18n en+ru minimum from day one; source-artifact language English-only (hard rule, NON-NEGOTIABLE)
- `.planning/REQUIREMENTS.md` — locked requirement IDs (see below)
- `.planning/ROADMAP.md` §"### Phase 10" — 6 success criteria

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| I18N-01 | Runtime user/operator-facing strings (UI copy, email templates, notification text, end-user error messages) use i18next + i18next-icu; minimum locales en + ru; CLDR pluralization (Russian one/few/many handled correctly); `Accept-Language` negotiation for API responses | §"i18n stack pick", §"String-site inventory" |
| I18N-02 | Locale resources operator-overridable via mounted volume / config map without forking | §"Operator override mechanism" |
| TEST-I18N-01 | i18n completeness test fails CI when a key exists in en but is missing in ru (or vice versa) | §"TEST-I18N-01 gate design" |
| DOCS-01 | README.md with quickstart (compose path) — under 5 minutes to first authenticated `/api/transcribe` | §"Docs gap analysis — README" |
| DOCS-02 | `docs/architecture.md` — component decomposition, request lifecycle for the three hot paths, mermaid diagrams | §"Docs gap analysis — architecture (MISSING)" |
| DOCS-03 | `docs/operations.md` — deploy, upgrade, scale, backup, restore, troubleshoot | §"Docs gap analysis — operations (588 lines, partial)" |
| DOCS-04 | `docs/litellm-target-spec.md` — already shipped; audit | §"Docs gap analysis — litellm-target-spec (240 lines, shipped Phase 3)" |
| DOCS-05 | `docs/wire-contract.md` — references upstream BACKEND_SPEC + lists v2-deferred (Stripe / referrals) | §"Docs gap analysis — wire-contract (217 lines, shipped Phase 3)" |
| DOCS-06 | `docs/auth.md` — OIDC plug-in + email+password + channel-scheme handling | §"Docs gap analysis — auth (234 lines, shipped Phase 2)" |
| DOCS-07 | CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, **Apache-2.0 LICENSE**, license headers | §"OSS housekeeping checklist" — **LICENSE is currently MIT, BUG** |
| DOCS-08 | ADRs for every Key Decision in PROJECT.md | §"ADR list — 8–10 new ADRs" |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Locale negotiation (browser) | Frontend Server (Next.js SSR) | — | App Router `RootLayout` reads `Accept-Language` + `NEXT_LOCALE` cookie at RSC boundary; passes `lng` to `getServerI18n` and serializes resources to client (existing pattern at `apps/web/src/app/layout.tsx`) |
| Locale negotiation (desktop client → API) | API / Backend | — | `Accept-Language` header → `i18next-http-middleware` LanguageDetector → `req.i18n` decorator → translated in `setErrorHandler` |
| UI copy | Frontend Server + Browser | — | RSC serves localized HTML; client-side React re-renders use the inlined snapshot (existing pattern at `apps/web/src/lib/i18n-client.tsx`) |
| Error envelope translation | API / Backend | — | Already a single chokepoint at `setErrorHandler` (Phase-2 D-13) — translate `err.code` → `req.i18n.t(\`errors.${code}\`)` |
| Email subject + body translation | Worker | API (renderer collaborator) | BullMQ `email-delivery` job's `TemplateRenderer` interface already exists at `apps/worker/src/jobs/email-delivery.ts:55-62`; Phase 10 implements it inside worker, reads `data.locale` from the payload (already `z.enum(["en","ru"])`) |
| Audit log action labels | **NOT translated** | — | `audit_log.action` is a CHECK-constrained enum of 18 English action codes (`packages/data/src/schema/audit_log.ts:24`). Constitutional rule: source artifacts English-only. Web admin renders these via a static lookup map — translation is a render-time concern, not a payload concern |
| Static doc bundles (README, ADRs) | CDN / Static (repo) | — | Markdown rendered by GitHub; English-only per ADR-0003 |
| Operator-override locale files | Filesystem | Docker compose volume | I18N-02 — `docker-compose.yml` volume mount maps `./locales` over baked-in resources; i18next `loadPath` reads from disk in API/worker |

---

## i18n String-Site Inventory

### API — error envelopes

**Centralized emission point:** `apps/api/src/error-handler.ts:92` (`app.setErrorHandler`). **All 22 typed throws + the 89 inline `reply.send({error:...})` calls eventually pass through this handler** (Phase-2 / Plan 03 / Task 1 — D-13 single emission point).

**Current inline sites NOT YET converted to typed throws** (greppable via `rg "\.send\(\s*\{\s*error" apps/`):

| File | Count | Unique strings |
|------|------:|----------------|
| `apps/api/src/routes/conversations/*.ts` | 17 | `unauthorized`, `conversation not found`, `metadata exceeds 4096 bytes (4KB cap)`, `query must be non-empty`, `conversation_id required`, `conversation_id must be a UUID`, `invalid query` |
| `apps/api/src/routes/transcriptions/*.ts` | 9 | `unauthorized`, `transcription not found`, `batch size exceeds ${MAX_BATCH_SIZE} items`, `invalid query` |
| `apps/api/src/routes/folders/*.ts` | 9 | `unauthorized`, `folder not found`, `batch size exceeds ${MAX_BATCH_SIZE} items` |
| `apps/api/src/routes/notes/*.ts` | ~8 | `unauthorized`, `note not found`, `note_id required`, `note_id must be a UUID` |
| `apps/api/src/routes/v1/keys/*.ts` | 7 | `unauthorized`, `api key with that name already exists`, `api key not found`, `invalid id` |
| `apps/api/src/routes/auth-callback.ts` | 8 | `unsupported provider`, `idp error: ${req.query.error}`, `missing state or code`, `invalid state`, `state already consumed`, `state expired`, `oauth callback not configured` |
| `apps/api/src/routes/desktop-signin.ts` | 3 | `unsupported provider`, `oidc not configured`, `invalid callback scheme` |
| `apps/api/src/routes/tokens/openai-realtime.ts` | 1 | `streams must be 1 or 2` |
| `apps/api/src/routes/reason.ts` | 2 | `unauthorized`, `upstream reasoning provider failure` |
| `apps/api/src/routes/usage.ts`, `note-recording-config.ts`, `stt-config.ts`, `delete-account.ts`, `verification-status.ts`, etc. | ~25 | `unauthorized`, `session expired` |

**Typed-throw sites already converted** (greppable via `rg "throw new (AuthError|NotFoundError|...)"`): 22 — these are the seed pattern to follow.

**Unique English strings to translate:** ≈ **30** (after deduping `unauthorized` × N).

**Mapping recommendation:** stable error code per typed-error class:
```
AuthError("unauthorized")           → errors.auth.unauthorized
AuthError("session expired")        → errors.auth.session_expired
NotFoundError("conversation ...")   → errors.not_found.conversation
NotFoundError("transcription ...")  → errors.not_found.transcription
ValidationError("metadata ...")     → errors.validation.metadata_too_large {limit_bytes}
ValidationError("batch ...")        → errors.validation.batch_too_large {limit}
ServiceUnavailable("...")           → errors.upstream.<provider>_failure
RateLimitError                      → errors.rate_limit.exceeded
ServerError                         → errors.internal
```
The `err.code` (added to the typed-error classes — see Task layout) is the i18next key suffix.

### API — Better Auth integration

`apps/api/src/auth.ts:238-245` — verification-email subject is currently hard-coded English: `"Verify your OpenWhispr account"`. Better Auth's `sendVerificationEmail` and `sendResetPassword` (when wired) hooks receive the user object. Better Auth itself does NOT localize; the hook must enqueue the email-delivery BullMQ job with `template_id: "email_verification"` + `locale: <detected_locale>` and let the worker render. **Locale source for emails:** persisted on the user row (Better Auth `user` table needs a `locale` column added via a migration in this phase, defaulting to `"en"`) OR derived from the request `Accept-Language` at signup time and stored.

### Worker — email templates

`apps/worker/src/jobs/email-delivery.ts:30-37` — payload schema:
```ts
emailDeliverySchema = z.object({
  tenant_id: z.string().uuid(),
  to: z.string().email(),
  template_id: z.string().min(1),
  locale: z.enum(["en", "ru"]).default("en"),
  variables: z.record(z.string(), z.unknown()).default({}),
  request_id: z.string().uuid(),
});
```
`TemplateRenderer` interface at lines 55–62 — currently stubbed at `apps/worker/src/index.ts:75-79` (`noopRenderer`). **Templates required for v1:**
- `email_verification` — Better Auth verification (currently sent inline at `auth.ts:238`)
- `password_reset` — Better Auth `sendResetPassword` (not yet wired — Phase 10 must add the hook + template)
- `account_deletion_confirmation` — sent after `DELETE /api/auth/delete-account` succeeds (Phase 2)
- `virtual_key_rotation_notice` — already-shipped BullMQ flow (Phase 6) — currently text-free

Each template has `subject`, `text`, optional `html`. For Phase 10 deliverable scope, **3 production templates** (verification, password_reset, account_deletion_confirmation) and 1 deferred (key_rotation_notice — backlog).

### Web — Next.js App Router

**Existing scaffold (Phase 07.1 / Plan 06):**
- `apps/web/src/lib/i18n.ts` — server instance factory (`getServerI18n(lng, ns)`)
- `apps/web/src/lib/i18n-client.tsx` — client provider (receives resources snapshot from RSC)
- `apps/web/src/locales/en/{common,admin,end-user}.json` — **200+ keys**, sourced verbatim from UI-SPEC Appendix C
- `apps/web/src/locales/__tests__/coverage.test.ts` — gate that asserts every UI-SPEC Appendix C key resolves in English bundle

**What's locked in `lng`:** `apps/web/src/app/layout.tsx:39` — `const lng = "en"`. The comment explicitly states `// Phase 10 introduces the Accept-Language → NEXT_LOCALE cookie chain.` This is the entry point Phase 10 modifies.

**Locale negotiation flow (target):**
1. `RootLayout` (RSC) reads `cookies().get("NEXT_LOCALE")?.value` first.
2. Falls back to `headers().get("accept-language")` parsed via `accept-language-parser@1.5.0`.
3. Falls back to `"en"`.
4. Sets `<html lang={lng}>` and serializes resources for the chosen `lng`.
5. A `/api/locale` Next.js route handler accepts POST `{locale: "en"|"ru"}` and sets `NEXT_LOCALE` cookie (for the language switcher UI).

**Russian translations needed:** every key in `common.json` / `admin.json` / `end-user.json` — **200+ strings**. Translation work itself is the labor cost; mechanical wiring is small.

### Audit log — NOT translated

`packages/data/src/schema/audit_log.ts:24-44` — `AUDIT_LOG_ACTIONS` is a const-union of 18 English codes (`auth.signin`, `auth.signin_failed`, `auth.signout`, ..., `security.ssrf_blocked`). The CHECK constraint on the column hard-pins these. **No payload field carries human-readable text.** Web admin renders these via a static lookup map at render time — this IS in scope for Phase 10 web translations (entry in `admin.json` namespace, e.g. `admin.audit.action.auth_signin.label`).

---

## i18n Stack Pick

### Server-side (apps/api, apps/worker)

| Package | Version | Purpose | Why |
|---------|---------|---------|-----|
| `i18next` | `^26.1.0` (web already pinned) | Core | Industry standard; web already uses it; consistent server/client |
| `i18next-icu` | `^2.4.3` | ICU MessageFormat for Russian plurals | Correct CLDR plural categories (one/few/many/other); `{count, plural, one{} few{} many{} other{}}` syntax |
| `i18next-http-middleware` | `^3.9.6` | Fastify plugin for `Accept-Language` parsing + `req.i18n.t()` decorator | Official i18next integration; Fastify-compatible (registered as `app.register(i18nextMiddleware.plugin, { i18next })`) |
| `i18next-fs-backend` | `^2.6.0` | Read locales from disk (operator-overridable volume) | I18N-02 — operator mounts `/etc/openwhispr/locales` over baked-in resources |
| `accept-language-parser` | `^1.5.0` | Parse `Accept-Language` for Next.js RSC (not Fastify — middleware handles that there) | Required only on the web app's RSC layer; Fastify side is covered by `i18next-http-middleware.LanguageDetector` |

### Client-side (apps/web)

Already locked at:
- `i18next@^26.1.0`
- `react-i18next@^17.0.7`
- `i18next-resources-to-backend@^1.2.1`

Adds in Phase 10:
- `i18next-icu@^2.4.3` (for client-side plural rendering parity with server)
- `accept-language-parser@^1.5.0` (RSC negotiation)

### Resource file layout

```
packages/i18n/locales/
├── en/
│   ├── common.json    (cross-app shared: greetings, action labels, "Loading…")
│   ├── errors.json    (NEW — API error envelopes: errors.auth.unauthorized, etc.)
│   ├── email.json     (NEW — email templates: email.email_verification.subject, .text, .html)
│   └── audit.json     (NEW — admin web rendering of audit_log.action: audit.actions.auth_signin)
└── ru/
    ├── common.json    (NEW — Russian translations)
    ├── errors.json    (NEW)
    ├── email.json     (NEW)
    └── audit.json     (NEW)

apps/web/src/locales/  (already exists, UI-SPEC sourced)
├── en/
│   ├── common.json    (30 lines, exists)
│   ├── admin.json     (167 lines, exists)
│   └── end-user.json  (768 lines, exists)
└── ru/                 (NEW — entire dir; mirror keys from en/)
    ├── common.json
    ├── admin.json
    └── end-user.json
```

**Why split between `packages/i18n/locales/` (server/worker) and `apps/web/src/locales/` (web)?** Web bundles its locales into the Next.js build (statically imported via `i18next-resources-to-backend` dynamic import — verified at `apps/web/src/lib/i18n.ts:21`); server reads from disk at runtime to allow operator override. Two homes for two consumption models is the correct split — already in flight (the `packages/i18n` stub at `packages/i18n/src/index.ts` exists for exactly this).

**JSON not YAML:** consistent with Better Auth, Next.js, and the web bundles already shipped. `tools/lint-english.ts` already excludes `packages/i18n/locales/**` from the Cyrillic gate (verified at `tools/lint-english.ts:59`).

### Operator override mechanism (I18N-02)

```yaml
# docker-compose.yml fragment
services:
  api:
    volumes:
      - ./locales:/etc/openwhispr/locales:ro  # operator-overridable
  worker:
    volumes:
      - ./locales:/etc/openwhispr/locales:ro
```

API/worker initialization:
```ts
i18next.use(Backend).init({
  backend: {
    loadPath: process.env.LOCALES_DIR
      ? `${process.env.LOCALES_DIR}/{{lng}}/{{ns}}.json`
      : new URL("../../../packages/i18n/locales/{{lng}}/{{ns}}.json", import.meta.url).pathname,
  },
  // ...
});
```

`LOCALES_DIR` env var documented in `.env.example`. Operator's mounted `./locales` directory wins if present.

### Server bootstrap (Fastify, apps/api)

```ts
// apps/api/src/i18n.ts (NEW)
import i18next from "i18next";
import ICU from "i18next-icu";
import Backend from "i18next-fs-backend";
import middleware from "i18next-http-middleware";

await i18next
  .use(ICU)
  .use(Backend)
  .use(middleware.LanguageDetector)
  .init({
    fallbackLng: "en",
    supportedLngs: ["en", "ru"],
    preload: ["en", "ru"],
    ns: ["errors", "common"],
    defaultNS: "errors",
    backend: { loadPath: /* see I18N-02 */ },
    detection: { order: ["header"], caches: false },
  });

// apps/api/src/index.ts
app.register(middleware.plugin, { i18next });
```

### `setErrorHandler` translation

```ts
// apps/api/src/error-handler.ts (modified)
} else if (err instanceof AuthError) {
  status = 401;
  message = req.i18n.t(`errors.auth.${err.code ?? "unauthorized"}`);
}
```
Each typed-error class grows a `code: string` field defaulted to a canonical fallback. Backward compatibility: existing tests assert specific envelope strings — those tests need updating to either (a) assert English under `Accept-Language: en` OR (b) assert key presence in the locale bundle.

---

## CLDR Plural Test Design

### Russian boundary cases (the load-bearing test for TEST-I18N-01 + I18N-01)

ICU MessageFormat key example:
```json
// errors.json (ru)
{
  "validation": {
    "batch_too_large": "Пакет превышает {limit, plural, one {# элемент} few {# элемента} many {# элементов} other {# элементов}}"
  }
}
```

| n | Expected category | Example output (ru) |
|---|-------------------|---------------------|
| 0 | many | `0 элементов` |
| 1 | one | `1 элемент` |
| 2 | few | `2 элемента` |
| 3 | few | `3 элемента` |
| 4 | few | `4 элемента` |
| 5 | many | `5 элементов` |
| 11 | many | `11 элементов` |
| 12 | many | `12 элементов` |
| 21 | one | `21 элемент` |
| 22 | few | `22 элемента` |
| 25 | many | `25 элементов` |
| 101 | one | `101 элемент` |
| 105 | many | `105 элементов` |

CLDR rule (Unicode CLDR §Plural Rules):
- `one`: `n % 10 === 1 && n % 100 !== 11`
- `few`: `n % 10 in {2,3,4} && n % 100 not in {12,13,14}`
- `many`: `n % 10 === 0 || n % 10 in {5..9} || n % 100 in {11..14}`
- `other`: fractions, not used for integer counts (decimal cases will hit `other`)

Source: [Unicode CLDR Plural Rules](https://cldr.unicode.org/index/cldr-spec/plural-rules).

### English sanity

```json
{ "validation": { "batch_too_large": "Batch exceeds {limit, plural, one {# item} other {# items}}" } }
```

Boundary cases: 1 → "1 item", 0/2/N → "N items".

### Test mechanics

`packages/i18n/src/plural-rules.test.ts` (NEW):
```ts
import i18next from "i18next";
import ICU from "i18next-icu";

const i = i18next.createInstance().use(ICU);
await i.init({
  lng: "ru",
  resources: { ru: { test: require("../locales/ru/test-plurals.json") } },
});

const cases: Array<[number, string]> = [
  [0, "many"], [1, "one"], [2, "few"], [5, "many"],
  [11, "many"], [21, "one"], [22, "few"], [25, "many"],
  [101, "one"], [105, "many"],
];
for (const [n, expectedCategory] of cases) {
  it(`ru plural ${n} → ${expectedCategory}`, () => {
    const out = i.t("test:item_count", { count: n });
    expect(out).toMatch(/* category-specific regex */);
  });
}
```

Parity assertion: the SAME boundary cases run against the web bundle (same i18next-icu config), against the API bundle, and against the worker bundle. Three consumers, one truth file.

---

## TEST-I18N-01 Gate Design

**Two complementary mechanisms.**

### 1. Key-completeness diff (the cheap fast gate)

`packages/i18n/__tests__/locale-coverage.test.ts` (NEW):

```ts
// Walk every JSON under packages/i18n/locales/en/ and apps/web/src/locales/en/.
// For each en file, the same-named ru file must exist and have the same key set
// (recursive, dotted paths). Surface a list of missing keys in ru AND orphan keys
// (present in ru but not en).
```

Runs in CI under `test:i18n` and as part of `pnpm test`. Failure mode: emits `MISSING ru: <path>:<dotted.key>` for every drift.

### 2. Emission-site coverage (the hard semantic gate)

`apps/api/src/__tests__/i18n-emission-completeness.test.ts` (NEW):

```ts
// Static-analyse apps/api/src/**/*.ts for:
//   - throw new <TypedError>(<string>) — string must match a code that
//     exists in errors.json
//   - reply.send({error: <string>}) — flagged as "must be converted to typed throw"
// Build a set of error codes referenced in source, assert each resolves
// in BOTH en and ru locales.
```

Source-analysis approach: TypeScript Compiler API walk (we already use it in `tools/lint-rls.ts` / `tools/lint-tenant-context.ts` — same pattern). The gate **forbids** inline `reply.send({error:"..."})` outside of allow-listed bootstrap paths, forcing every new error to flow through `setErrorHandler` and `errors.json`. This converts the constitutional D-13 rule into a CI invariant.

### 3. Worker email-template completeness

`apps/worker/src/__tests__/email-template-completeness.test.ts` (NEW):
- Enumerates every `template_id` known to `TemplateRenderer.render()` (a const list in the new renderer module)
- For each `template_id` × `locale in [en, ru]`, asserts the render output is non-empty for `subject` and `text`
- Snapshot-tests the rendered output of `email_verification` + `password_reset` + `account_deletion_confirmation` for both locales

### Sampling rate

| Boundary | Command |
|----------|---------|
| Per-task quick run | `pnpm -F @openwhispr/i18n test` |
| Per-wave merge | `pnpm -r test -- --runInBand packages/i18n apps/api apps/worker apps/web/src/locales` |
| Phase gate | `make test` (full suite, includes i18n completeness, plural snapshots, emission audits) |

### Wave 0 gaps (RED before GREEN)

- `packages/i18n/__tests__/locale-coverage.test.ts` — completeness diff (TEST-I18N-01)
- `packages/i18n/src/plural-rules.test.ts` — CLDR ru boundary cases
- `apps/api/src/__tests__/i18n-emission-completeness.test.ts` — source-walk gate
- `apps/api/src/__tests__/error-handler-i18n.test.ts` — extends existing `error-handler.test.ts` with `Accept-Language: ru` assertions
- `apps/worker/src/__tests__/email-template-completeness.test.ts`
- `apps/web/src/lib/__tests__/i18n-russian-coverage.test.ts` — extends existing `apps/web/src/locales/__tests__/coverage.test.ts` to assert ru bundles match UI-SPEC Appendix C key set
- `apps/web/src/app/__tests__/locale-negotiation.test.ts` — `NEXT_LOCALE` cookie + `Accept-Language` chain

---

## Docs Gap Analysis

### DOCS-01 — `README.md` (currently 64 lines)

**Status:** EXISTS, partial.

**Gaps:**
- Quickstart claims `make dev` "boots a placeholder Fastify app" — must be updated for Phase 9 final state (real `/api/transcribe` running, < 5 min to first authenticated call)
- Add: "Languages: en (default), ru" badge + 1-line link to `docs/i18n.md`
- Add: Apache-2.0 license badge — but FIRST fix the actual `LICENSE` file (currently MIT)
- Add: links to `docs/architecture.md` (new) and `docs/security.md` (new)

**Estimated effort:** ~150 lines net (current 64 → target ~200).

### DOCS-02 — `docs/architecture.md` (**MISSING**)

**Required content (from REQUIREMENTS.md line 155):**
- Component decomposition (API + Worker + Web + Postgres + PgBouncer + Valkey + LiteLLM + MinIO + Traefik)
- Request lifecycle for the **three hot paths**:
  1. `POST /api/transcribe` — multipart → Fastify → LiteLLM → response envelope
  2. `WSS /v1/realtime` — Traefik :8443 → Fastify upgrade → OpenAI Realtime reverse-proxy
  3. `POST /api/agent/stream` — NDJSON line-flush path
- Mermaid sequence diagrams for each hot path
- Tenant isolation diagram (RLS chokepoint + PgBouncer transaction-mode)
- BullMQ topology (8 queues — already documented in worker comments)

**Estimated effort:** ~400 lines.

### DOCS-03 — `docs/operations.md` (currently 588 lines)

**Status:** EXISTS, substantial (Phase 0 + Phase 4 + Phase 8 already extended).

**Gaps:**
- "Upgrade" runbook — pin to Helm chart upgrade flow (Phase 9) + docker-compose `pull && up -d` flow
- "Scale" — horizontal scaling guidance (API replicas, worker replicas, autoscaling on Redis queue depth)
- "Restore" — has backup but restore drill is mentioned only in passing
- i18n operator-override volume — REFERENCE from Phase 10 i18n work (`LOCALES_DIR` env var)

**Estimated effort:** ~150 lines added.

### DOCS-04 — `docs/litellm-target-spec.md` (currently 240 lines)

**Status:** EXISTS, shipped Phase 3.

**Gaps:** Audit-only — confirm corporate-override section is still accurate after Phase 5–8 changes; cross-reference Phase 9 Helm chart's LiteLLM override values.

**Estimated effort:** ~20 lines audit pass.

### DOCS-05 — `docs/wire-contract.md` (currently 217 lines)

**Status:** EXISTS, shipped Phase 3.

**Gaps:** Audit — must list v2-deferred endpoints (Stripe / referrals — already mentioned in REQUIREMENTS.md but verify in wire-contract); add post-Phase-5 CRUD routes (WIRE-22..29) confirmation.

**Estimated effort:** ~30 lines.

### DOCS-06 — `docs/auth.md` (currently 234 lines)

**Status:** EXISTS, shipped Phase 2.

**Gaps:** Audit — confirm OIDC provider plug-in instructions still align with Phase 2 implementation; cross-link `docs/oidc-operator-config.md` (which exists as 243 lines, Phase 2); channel-scheme handling — confirm cross-link to `docs/channel-scheme-override.md` (which exists as 207 lines).

**Estimated effort:** ~20 lines audit.

### DOCS-07 — OSS housekeeping (CONTRIBUTING + SECURITY + COC + LICENSE)

| File | Status | Action |
|------|--------|--------|
| `CONTRIBUTING.md` | EXISTS (67 lines, good baseline) | Add: license-header note pointing to Apache-2.0 SPDX header convention; cross-link to i18n contribution rules (don't paste Cyrillic outside `packages/i18n/locales/ru/**`) |
| `SECURITY.md` | EXISTS (34 lines, baseline) | Expand: response SLA detail; cross-link to new `docs/security.md`; threat model summary |
| `CODE_OF_CONDUCT.md` | EXISTS (20 lines, Contributor Covenant 2.1 — current latest is also 2.1) | OK as-is |
| `LICENSE` | **EXISTS BUT WRONG — currently MIT, requires Apache-2.0** | **REPLACE with Apache-2.0 full text** |
| License headers in source files | NONE detected | Add SPDX short-form header to every `.ts` / `.tsx` source file via a codemod: `// SPDX-License-Identifier: Apache-2.0` — single-line, lint-english-compatible |
| `NOTICE` (Apache-2.0 attribution file) | MISSING | Add per Apache-2.0 §4(d); list pre-existing copyright attributions if any |

### DOCS-08 — ADRs

See dedicated section below.

### Additional new docs (not in DOCS-NN but implied by I18N requirements)

- `docs/i18n.md` (**MISSING — Phase 10 deliverable, derived from this research**)
  - Locale negotiation chain (web + API)
  - Resource file layout
  - How to add a new locale
  - Operator override mechanism (I18N-02)
  - CLDR plural rules quick reference
  - ~200 lines
- `docs/security.md` (**MISSING — DOCS-07 SECURITY.md is for reports, this is for posture**)
  - SSRF gate architecture
  - Secret-loading conventions (env + SOPS)
  - Log scrubbing (pino redact paths)
  - Rate-limiting topology
  - Audit-log threat model (T-audit-loss, T-bearer-leak)
  - ~250 lines

### Existing docs already covering related areas (no Phase 10 action)

- `docs/conventions.md` (244 lines) — envelope D-33/34/35
- `docs/oidc-operator-config.md` (243 lines)
- `docs/channel-scheme-override.md` (207 lines)
- `docs/litellm-mock-mode.md` (106 lines)
- `docs/observability.md` (401 lines)
- `docs/self-hosting.md` (103 lines)
- `docs/storage.md` (95 lines)
- `docs/wire-contracts-phase-3.md` (325 lines)

---

## ADR List (DOCS-08)

**PROJECT.md "Key Decisions" rows (verbatim, lines 215–230):**
1. Wire-compatible with upstream BACKEND_SPEC
2. v1 implements auth lifecycle + operational; defers Stripe / referrals
3. Bundle LiteLLM ≥ 1.83.7 with OSS models default; env-override to corporate
4. Usage ledger observability-only; no v1 enforcement
5. Single LiteLLM endpoint — no parallel multi-LLM abstraction
6. UI-SPEC over UI-implementation in v1
7. Stack: Node 24 + Fastify 5 + Better Auth + Drizzle + PG 17 + PgBouncer + Valkey + BullMQ
8. Multi-tenancy retained, single "default" tenant v1
9. Email+password first-class
10. OIDC pluggable via Better Auth OAuth-Provider plugin
11. Open IdP scope (no server-side allowlist)
12. All docs/code English-only ← **already ADR-0003**
13. Open-source from day one
14. Strict TDD constitutional
15. GitHub Actions as the only CI
16. Contract suite as canonical conformance check

**Existing ADRs (verified at `docs/adrs/`):**
- 0000-template.md (Nygard template)
- 0001-pnpm-workspaces-monorepo.md
- 0002-vitest-and-stryker-for-coverage-and-mutation.md
- 0003-english-only-source-artifacts.md ← maps to Key Decision 12

**Proposed new ADRs (Phase 10):**

| ADR | Title | One-line decision | Alternatives considered |
|-----|-------|-------------------|------------------------|
| 0004 | Apache-2.0 licensing | License the project under Apache-2.0 to align with corporate-friendly redistribution and patent grant; replace the legacy MIT LICENSE file shipped from Phase 0 bootstrap | MIT (no patent grant), BSD-3 (no patent grant), AGPL (poison-pill for corporate self-host) |
| 0005 | Stack — Node 24 + Fastify 5 + Better Auth + Drizzle + PG 17 + PgBouncer + Valkey + BullMQ | Codify the seven-component stack pick as a single ADR rather than seven separate ones | Express 5 (rejected — Fastify NDJSON line-flush + WSS proxy first-class), Prisma (rejected — PgBouncer transaction-mode unreliable), TypeORM (rejected — staleness), Lucia (Better Auth's wire shape matches the desktop client byte-for-byte), MySQL (rejected — RLS), PG 16/18 (CNPG catalog default is 18; we override to 17 for stability), Redis without Valkey (license drift) |
| 0006 | Wire-compatibility with upstream BACKEND_SPEC | Match upstream byte-for-byte on every endpoint we serve; v2-deferred endpoints stub as 503 | Diverge to invent a "cleaner" v1 wire (rejected — desktop client is the canonical user) |
| 0007 | Multi-tenancy via RLS with single "default" tenant in v1 | Schema retains `tenant_id` on every row + Postgres RLS policies; v1 ships one tenant (no admin UI) | Schema-per-tenant (operational complexity), separate DBs (cost), single-tenant rewrite (closes the corporate-multi-tenant path) |
| 0008 | LiteLLM as the AI plane abstraction | Bundle LiteLLM in default compose; env-override `LITELLM_BASE_URL` for corporate; do NOT build a parallel multi-LLM abstraction in app code | Build custom abstraction (yak-shaving), use a different gateway (Helicone / Portkey — smaller ecosystem) |
| 0009 | Better Auth + email-password + OIDC plugin | First-class email-password sign-in for corporate fallback access; OIDC plug-in via Better Auth's OAuth-Provider plugin for Google / Azure / Okta / generic | Lucia (no plug-in OAuth-Provider story), NextAuth (Pages-Router-flavored API; Better Auth wire shape matches desktop), roll-your-own |
| 0010 | i18n runtime: en + ru with i18next + ICU, operator-overridable volume | Server uses i18next + i18next-icu + i18next-http-middleware; web uses i18next + react-i18next + ICU; locales in `packages/i18n/locales/<lng>/<ns>.json` + `apps/web/src/locales/<lng>/<ns>.json`; operator mounts `/etc/openwhispr/locales` to override | node-polyglot (no ICU plurals, hard-rejected per STACK.md), next-intl (Pages-Router-flavored, RSC integration fragile), FormatJS direct (heavier; i18next-icu wraps it) |
| 0011 | Strict TDD + GitHub Actions CI + maximum automation | Tests precede production code on every phase; CI runs unit + integration + contract + e2e + load + security + i18n on every PR; no human QA | Pragmatic TDD (slippage), GitLab CI (operator audience is GitHub), Buildkite (cost) |
| 0012 | Audit-log emission single-chokepoint (D-A1) + 18-action enum | Every audit row flows through `recordAudit()`; action codes are English-only enum; payloads forbid secret keys; in-band sync INSERT inside the route's tx | Async fanout (T-audit-loss), free-form action strings (drift), translated action strings (constitutional rule conflict) |

**Optional (judgment call — Phase 10 planner decides):**
- 0013 | :8443 dedicated WSS realtime entrypoint (Phase 4 Plan 05) — possibly already implicit in PROJECT.md, may not need standalone ADR
- 0014 | UI-SPEC over UI-implementation in v1 (Key Decision 6) — already realized in Phase 7.1; standalone ADR clarifies for Phase 11+ planners

**Total new ADRs:** **8 mandatory + 2 optional = 8–10**.

---

## OSS Housekeeping Checklist

| File | Path | Status | Action |
|------|------|--------|--------|
| LICENSE | `/LICENSE` | **WRONG (MIT, 21 lines)** | **Replace with full Apache-2.0 text (LICENSE-2.0)** |
| NOTICE | `/NOTICE` | MISSING | Create per Apache-2.0 §4(d) |
| README | `/README.md` | EXISTS (64 lines) | Extend per DOCS-01 |
| CONTRIBUTING | `/CONTRIBUTING.md` | EXISTS (67 lines) | Audit + i18n note + license-header guidance |
| SECURITY | `/SECURITY.md` | EXISTS (34 lines) | Extend per DOCS-07 |
| CODE_OF_CONDUCT | `/CODE_OF_CONDUCT.md` | EXISTS (20 lines, Contributor Covenant 2.1) | OK |
| ISSUE_TEMPLATE | `.github/ISSUE_TEMPLATE/` | MISSING | Create: `bug_report.md`, `feature_request.md`, `security.md` (redirect to private channel), `config.yml` (disable blank issues) |
| PULL_REQUEST_TEMPLATE | `.github/pull_request_template.md` | EXISTS (verified) | Audit |
| CODEOWNERS | `.github/CODEOWNERS` | MISSING | Create with default owner |
| Dependabot | `.github/dependabot.yml` | EXISTS | OK |
| License headers | every `.ts`/`.tsx` source file | MISSING | Codemod inserts `// SPDX-License-Identifier: Apache-2.0` as line 1 (or line 2 if shebang) — must respect `lint-english.ts` and biome formatting |
| Funding | `.github/FUNDING.yml` | MISSING | Optional — out of scope for v1 |

**Contributor Covenant version pin:** **2.1** (current latest as of CoC's 2020-07 release; no 2.2 exists). Already correct in the current CoC file. Source: [contributor-covenant.org](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

---

## Common Pitfalls

### Pitfall 1: Russian plural CategoryError — `"other"` is the wrong fallback

**What goes wrong:** Translator writes `{count, plural, one {1 файл} other {N файлов}}` (Slavic pattern they remember from English). Output for `2 файла` is wrong (`one` fires for n=1, falls to `other` for n=2 → "2 файлов" instead of "2 файла").
**Why:** Russian CLDR has **four** categories (`one|few|many|other`). `other` matches **only fractions** for integer counts. Omitting `few`/`many` is a silent semantic bug.
**How to avoid:** TEST-I18N-01 plural-snapshot test enumerates 0/1/2/3/5/11/21/22/25/101/105 with assertions on the exact rendered output. Linting MessageFormat strings: ICU parser enforces structure but NOT semantic correctness — only the test does.
**Warning signs:** ru bundle uses `{count, plural, one {} other {}}` shape (only two cases) → reject in CI.

### Pitfall 2: RSC→Client serialization boundary for i18next

**What goes wrong:** `I18nextProvider` receives an `i18next` instance (not a plain object). Next.js App Router serializes RSC props as JSON; an i18next instance has methods + class instances → "cannot be serialized" runtime error during render.
**Why:** Already documented in `apps/web/src/lib/i18n-client.tsx` header comment ("Pitfall 1"). Phase 07.1 fixed it.
**How to avoid:** Pass **only the resource-store snapshot** (`i18n.services.resourceStore.data[lng]`) — a plain object. The client constructs its own instance inside `useMemo`. This pattern already exists; Phase 10 must NOT break it when adding ICU.
**Warning signs:** "Functions cannot be passed directly to Client Components" at SSR.

### Pitfall 3: License-header codemod trips lint-english on existing Cyrillic comments

**What goes wrong:** None of the files at risk have Cyrillic comments today (verified by the existing `lint-english` gate being green). BUT: ADR-0003's allowlist exempts `packages/i18n/locales/**` only — adding license headers to those JSON files would be a no-op (JSON has no line-comment syntax), but adding to test-fixture i18n files (`tests/fixtures/i18n/**`) needs care.
**How to avoid:** Codemod skips JSON files. Codemod respects existing shebangs (`#!/usr/bin/env -S pnpm exec tsx` at top of `tools/lint-english.ts`) by inserting header at line 2.
**Warning signs:** `lint-english` CI job goes red after the codemod.

### Pitfall 4: Better Auth's verification email subject is hard-coded in the API

**What goes wrong:** `apps/api/src/auth.ts:241` — `subject: "Verify your OpenWhispr account"` — direct call to `email.send()`. Better Auth does NOT pass `locale` through its `sendVerificationEmail` hook signature, so the hook code has no way to detect locale from the user without an explicit lookup.
**How to avoid:** Hook reads `user.locale` from a NEW `users.locale` column added in this phase (Better Auth allows additional user fields via `additionalFields` config — verified pattern in Better Auth docs). Locale is set at signup time from `req.headers['accept-language']` and persists for that user's lifetime; user can change via web settings (admin namespace already has translation keys for this).
**Warning signs:** ru-locale user signs up, receives English verification email.

### Pitfall 5: `Accept-Language` header parsing on Edge runtime

**What goes wrong:** `apps/web/src/middleware.ts` runs on Edge runtime. `accept-language-parser@1.5.0` has no Node-only dependencies; verified Edge-compatible. BUT: cookie-only locale negotiation (NEXT_LOCALE) should happen at middleware time (Edge) to set the `lang` attribute on the root `<html>` element correctly without a hydration mismatch.
**How to avoid:** Middleware reads cookie, sets a request header `x-locale`, and RSC layout reads `headers().get('x-locale')` first (then falls back to `Accept-Language`). Avoids two-source-of-truth drift.
**Warning signs:** SSR HTML shipped with `<html lang="en">` but client switches to `<html lang="ru">` after hydration — React's hydration mismatch warning fires.

### Pitfall 6: Audit log payload values get accidentally translated

**What goes wrong:** Developer thinks "user-facing string" includes audit-log human-readable summaries, adds `req.i18n.t(...)` to the audit emission site, writes Cyrillic into a `payload` field. `tools/lint-english.ts` catches it ONLY if the literal is in the source — runtime-translated values reach the DB un-vetted.
**How to avoid:** `recordAudit()` already enforces a forbidden-key list (`apps/api/src/lib/audit.ts:45`). Add a runtime invariant: scan the parsed payload for Cyrillic codepoints before INSERT — same regex as `lint-english.ts`. Reject with a programmer-error throw if hit.
**Warning signs:** audit_log rows in production with Russian text — constitutional violation.

### Pitfall 7: ICU MessageFormat conflicts with i18next default interpolation

**What goes wrong:** ICU uses `{name}` syntax; i18next default uses `{{name}}` syntax. Mixed bundles break.
**How to avoid:** When `i18next-icu` is registered as a `i18nFormat` plugin, **all** keys default to ICU interpolation. `react-i18next` Trans-component formatter must be configured to match. Lock it: every locale file is 100% ICU syntax. The plural-rules test catches mixed-syntax bugs because Russian-plural messages without ICU are wrong.
**Warning signs:** keys rendered as literal `{{name}}` in the UI.

### Pitfall 8: Operator-mounted locales bypass the lint-english allowlist

**What goes wrong:** Operator mounts `/etc/openwhispr/locales/ru/errors.json` over baked-in resources. Operator's content is outside repo — no lint-english enforcement. If the operator writes malicious or broken ICU, runtime parses and silently 500s.
**How to avoid:** Document in `docs/i18n.md` that operator-overrides are **at operator risk**. Add boot-time validation: every `loadPath`-loaded JSON parses through a schema check (ICU MessageFormat parser) at i18next init; init fails fast if invalid. CI tests baked-in bundles only.
**Warning signs:** API boot loop after operator deploy.

---

## Plan Layout Suggestion

**4 plans, predicted 60–80 tasks total.**

### Plan 10-01 — Server-side i18n (API + Worker)

**Scope:** install i18next stack server-side; wire `i18next-http-middleware` into Fastify; convert remaining 89 inline `reply.send({error:...})` sites to typed throws with `err.code`; translate at `setErrorHandler`; build `errors.json` (en + ru); implement worker `TemplateRenderer` with `email.json` resources; add `users.locale` column migration; wire Better Auth `sendVerificationEmail` to enqueue locale-aware BullMQ job; plural-rules test + emission-completeness test.

**Predicted tasks:** ~25.

### Plan 10-02 — Web Russian translations + locale negotiation

**Scope:** install `i18next-icu` + `accept-language-parser` on web; extend `getServerI18n` to negotiate (cookie → header → fallback); add `/api/locale` route handler for the language switcher; add language-switcher UI component; **translate 200+ keys to Russian across `common.json` / `admin.json` / `end-user.json`**; add `ru/` to coverage test; build locale-completeness gate.

**Predicted tasks:** ~20.

### Plan 10-03 — Docs suite (DOCS-01..06 + new docs)

**Scope:** write `docs/architecture.md` from scratch (mermaid diagrams for three hot paths); write `docs/i18n.md`; write `docs/security.md`; extend `README.md` (DOCS-01); extend `docs/operations.md` (upgrade/scale/restore + i18n volume mount); audit + extend `docs/auth.md`, `docs/wire-contract.md`, `docs/litellm-target-spec.md`; cross-link every doc into README's "Documentation" section.

**Predicted tasks:** ~12.

### Plan 10-04 — OSS housekeeping + ADRs (DOCS-07 + DOCS-08)

**Scope:** **replace MIT LICENSE with Apache-2.0** (BLOCKING — must land first in this plan); create `NOTICE`; license-header codemod across `.ts`/`.tsx` (SPDX line); `.github/ISSUE_TEMPLATE/` (3 templates + config); `.github/CODEOWNERS`; audit + extend `CONTRIBUTING.md` (license-header + i18n notes), `SECURITY.md` (response SLA + threat-model link); audit `CODE_OF_CONDUCT.md` (verify Covenant 2.1); write **8 new ADRs** (0004 Apache-2.0, 0005 Stack, 0006 Wire-compat, 0007 Multi-tenancy, 0008 LiteLLM, 0009 Auth, 0010 i18n, 0011 TDD+CI; optional 0012 Audit-log, 0013 :8443 Realtime).

**Predicted tasks:** ~18.

**Plan dependencies:** 10-01 must land before 10-03's `docs/i18n.md` references it. 10-04's LICENSE fix is the **first task in the phase** (blocks everything downstream — any release-build gate that checks SPDX would otherwise fail).

---

## Project Constraints (from CLAUDE.md)

| Directive | Source | Phase-10 Impact |
|-----------|--------|------------------|
| Source-artifact English-only (DOCS-09) | CLAUDE.md, ADR-0003 | All ADRs, docs, code in English. Russian appears ONLY in `packages/i18n/locales/ru/**`, `apps/web/src/locales/ru/**`, `tests/fixtures/i18n/**` (allowlisted in `tools/lint-english.ts:59`). |
| Strict TDD | CLAUDE.md | Wave 0 = all i18n tests RED; Wave 1+ implements until GREEN. Each translation-add commit lands tests in same atomic commit. |
| Coverage ≥ 90% lines/branches/functions/statements | CLAUDE.md | New i18n modules (api/src/i18n.ts, worker template renderer, web locale negotiator) all gated. |
| No mocks of internal logic | CLAUDE.md | Email-template tests use real i18next + real fixtures (no mock renderer). |
| No bundled local AI models | feedback_no_bundled_local_models.md | n/a for this phase — i18n + docs only |
| GitHub Actions only CI | CLAUDE.md | Add `test:i18n-completeness` step to `.github/workflows/ci.yml`. |
| docker-compose integration | global CLAUDE | i18n operator-override mount lands in `docker-compose.yml` (not a separate compose file). |
| HTTPS only | CLAUDE.md | n/a directly — but `docs/security.md` documents this posture. |
| Apache-2.0 license required | REQUIREMENTS.md DOCS-07 | **CRITICAL: LICENSE file is currently MIT — must replace.** |

---

## Sources

### Primary (HIGH confidence)
- `/Users/nick/openwhispr-server/.planning/REQUIREMENTS.md` — locked requirement IDs
- `/Users/nick/openwhispr-server/.planning/ROADMAP.md` §"### Phase 10" — 6 success criteria
- `/Users/nick/openwhispr-server/.planning/PROJECT.md` lines 211-230 — Key Decisions (16 rows for ADR-0004..0014)
- `/Users/nick/openwhispr-server/CLAUDE.md` — stack pin, constitutional rules
- `/Users/nick/openwhispr-server/apps/web/src/lib/i18n.ts` + `i18n-client.tsx` + `app/layout.tsx` — existing Phase-07.1 web scaffold (with the explicit "Phase 10" extension marker)
- `/Users/nick/openwhispr-server/apps/api/src/error-handler.ts` — `setErrorHandler` single chokepoint (Phase-2 D-13)
- `/Users/nick/openwhispr-server/apps/worker/src/jobs/email-delivery.ts` — payload schema already has `locale: z.enum(["en","ru"])`
- `/Users/nick/openwhispr-server/packages/data/src/schema/audit_log.ts` — 18-action enum, CHECK-constrained
- `/Users/nick/openwhispr-server/tools/lint-english.ts:59` — locale-files allowlist already in place
- `/Users/nick/openwhispr-server/docs/adrs/0000-template.md` — Nygard format pinned
- npm registry — verified versions: `i18next@26.1.0`, `i18next-icu@2.4.3`, `i18next-http-middleware@3.9.6`, `accept-language-parser@1.5.0`, `react-i18next@17.0.7`

### Secondary (MEDIUM confidence — official docs)
- [Unicode CLDR Plural Rules](https://cldr.unicode.org/index/cldr-spec/plural-rules) — Russian one/few/many/other categories
- [i18next-icu GitHub](https://github.com/i18next/i18next-icu) — ICU MessageFormat integration
- [i18next-http-middleware GitHub](https://github.com/i18next/i18next-http-middleware) — Fastify plugin registration pattern
- [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) — current pinned version (no 2.2 exists)
- [Apache-2.0 License text](https://www.apache.org/licenses/LICENSE-2.0.txt)

### Tertiary (informational, no decisions hinge on these)
- General i18n best-practice articles from web search

---

## Metadata

**Confidence breakdown:**
- i18n string-site inventory: HIGH — every emission site grep-verified
- Stack pick: HIGH — versions verified via `npm view` on registry; web already uses identical stack
- TEST-I18N-01 gate: HIGH — pattern exists for source-walk gates (`tools/lint-rls.ts`, `tools/lint-tenant-context.ts`)
- Docs gap analysis: HIGH — every existing doc inspected by line-count and section-header dump
- ADRs: HIGH — 16 Key Decisions enumerated from PROJECT.md verbatim
- OSS housekeeping: HIGH — every file path verified via Read/ls
- Plurals: MEDIUM — Russian CLDR rule is well-defined but easy to mis-translate; test mechanics HIGH
- LICENSE fix: HIGH — file inspected, content is verbatim MIT, README states Apache-2.0

**Research date:** 2026-05-13
**Valid until:** 30 days (stable area — i18next, Apache-2.0, CLDR all mature)
