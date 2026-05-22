# v2.4 OSS-Publish — Deep Audit Findings

**Date:** 2026-05-22
**Method:** 3 parallel research subagents (Wave 1) — reinvented-wheel, hacks/antipatterns, doc-vs-code lies.
**Base:** worktree `v2.4-oss-publish` branched from local `main` @ `3b504fa3`.
**Total findings:** 45 (9 library, 17 antipattern, 19 doc-lie).

Severity legend: CRITICAL = breaks a user / security hole; HIGH = wrong/misleading; MED = real debt; LOW = cosmetic.

---

## A. Reinvented-wheel (library should have been used)

| ID | Severity | File(s) | Hand-rolled | Fix |
|----|----------|---------|-------------|-----|
| LIB-1 | MED | `config/diarization.ts:43`, `config/web-search.ts:54`, `config/realtime.ts:205`, `litellm-client/config.ts:149`, `index.ts:955` | 5 copies of positive-int env parser under 4 names | Unify on Zod `z.coerce.number().int().positive()` — Zod already a dep |
| LIB-2 | HIGH | `plugins/rate-limit.ts:88` | Unbounded `Map` IP counter — memory leak under spray | `lru-cache` (already a dep) with `{max, ttl}` |
| LIB-3 | HIGH(sec) | `lib/mint-bearer.ts:282,310` | `globalThis.fetch` for OIDC bypasses SSRF dispatcher | `import { fetch } from "undici"` |
| LIB-4 | LOW | `litellm-client/index.ts:320` | `drainWithTimeout` manual Promise.race+timer | `AbortSignal.timeout()` (Node 24 builtin) |
| LIB-5 | LOW | `tokens/_call-provider.ts:127` | `AbortController`+`setTimeout`+`clearTimeout` | `AbortSignal.timeout()` |
| LIB-6 | LOW | `lib/sse-parser.ts:99` | Full SSE framing parser | `eventsource-parser` (new dep) — OPTIONAL, defer |
| LIB-7 | LOW | `worker/i18n/template-renderer.ts:139` | Hand-rolled 5-entity HTML escaper | `escape-html` or i18next escapeValue |
| LIB-8 | MED | `routes/diarization.ts:315` | Fixed-interval sleep-poll loop | p-retry cosmetic / BullMQ pub-sub real — defer redesign |
| LIB-9 | MED | `lib/settings-resolver.ts:59` | `process.env` reads outside config boundary, `Number()` casts | New `config/stt-settings.ts` Zod schema |

## B. Hacks / antipatterns

| ID | Severity | File(s) | Problem | Fix |
|----|----------|---------|---------|-----|
| HACK-C1 | CRITICAL | `auth.ts:173`, `lens.ts:443` | Better Auth creds NOT encrypted at rest — transaction path bypasses lens | Rewrap `transaction` through `wrapAdapter` + declare sidecar `additionalFields`. **Own TDD cycle.** |
| HACK-C2 | CRITICAL | `index.ts:590-615` | `tryPreviousToken` on RLS-subject pool — AUTH-04 overlap window dead | Thread BYPASSRLS owner pool / SECURITY DEFINER fn |
| HACK-H1 | HIGH | `lint-prod-readiness.allowlist.txt` | 514-entry allowlist hides route schema/rateLimit debt | Bulk-fix routes, shrink allowlist (large — own phase) |
| HACK-H2 | HIGH | `routes/better-auth-handler.ts:188` | `/api/auth/*` catch-all no per-route rateLimit | Add `rateLimit: {max:20, timeWindow:"1 minute"}` |
| HACK-H3 | HIGH | 22 sites (`tokens/deepgram.ts`, `assemblyai.ts`, `better-auth-handler.ts`, `desktop-signin.ts`, `agent/stream.ts`, `routes/index.ts`) | `process.env` reads in route handlers bypass DI | Move to `config/*.ts`, thread through deps |
| HACK-H4 | HIGH | `routes/index.ts:377-384`, `tokens/assemblyai.ts:107`, `tokens/deepgram.ts:74` | Pre-existing typecheck errors TS2322/TS2339 | Narrow union before `.message`; fix RoutePlugin arity |
| HACK-H5 | HIGH | `tests/e2e/compose-helper.ts` | E2E harness references missing `seed` service | Pass contract-test overlay to compose |
| HACK-H6 | HIGH | `plan-52-06-stream-zod-drift.test.ts` | Pre-existing failing unit test | Update regex or delete obsolete assertion |
| HACK-M1 | MED | `worker-rls-property.test.ts:274` | Hard `test.skip` on worker RLS property test | Re-enable as `describe.skipIf(dockerUnavailable)` |
| HACK-M2 | MED | `docker-compose.yml:593` | Mailpit in production profile (no `profiles:`) | Add `profiles: [dev]` |
| HACK-M3 | MED | `docker-compose.yml:510,543`, `.env.full.example:482` | Dead `NEXT_PUBLIC_OIDC_PROVIDERS` var | Remove from compose build args + example env |
| HACK-M4 | MED | all `apps/*/src` | 1339+ phase-tag comments | Sed sweep, keep WHY-bearing — own phase |
| HACK-M5 | MED | `diarization.ts:315` | Sleep-retry loop (= LIB-8) | Same as LIB-8 |
| HACK-M6 | MED | `.env.*.example` | `EMAIL_FALLBACK_NONFATAL` undocumented | Document in example env files |
| HACK-M7 | MED | `worker/db/app-pool.ts:61-143` | 8 `as any` on pg overloads | Type once via narrow helper |
| HACK-M8 | MED | `apps/web/src/app/api/locale/route.ts`, `api/health/route.ts` | Dead Next.js routes shadowed by rewrites | Delete |
| HACK-M9 | MED | `apps/api/src/index.ts` | 1136-line god file | Extract `bootstrap/` modules — own phase |
| HACK-M10 | MED | `auth.ts` (759), `litellm-client/index.ts` (617) | Over-400-line files | Domain sub-module splits — own phase |
| HACK-L1 | LOW | `reason.ts:92`, `litellm-client/index.ts:113` | Hardcoded model→provider map | Cosmetic, accept |
| HACK-L5 | LOW | `encryption/backfill.ts:179` | `for(;;)` no iteration cap | Add safety cap |

**Stale TECH_DEBT entries to remove:** TD-mailpit noopSender, TD-12.a /admin 404, TD-12.c SSO flash, TD-13.a duplicate banner, TD-13.d weak assertion — all already resolved.

## C. Documentation lies (doc contradicts code)

| ID | Severity | Doc | Claim | Truth |
|----|----------|-----|-------|-------|
| DOC-1 | CRITICAL | README.md:114-131 | curl `localhost:3000` after embedded-litellm compose | api has no host port; Traefik routes `https://api.localhost` |
| DOC-2 | CRITICAL | README.md:131 | fixture `sample.wav` | actual: `sample-1s.wav` |
| DOC-3 | CRITICAL | README.md:132 | response `duration_s` | actual field: `duration` + 6 more |
| DOC-4 | CRITICAL | litellm-target-spec.md | `cp .env.example .env` | no `.env.example`; use `.env.embedded.example` etc |
| DOC-5 | HIGH | README.md:288, security.md:26 | "Apache-2.0" | actual: FSL-1.1-ALv2 (ADR-0013) |
| DOC-6 | HIGH | architecture.md:152,170,173 | NDJSON `text-delta/tool-call/finish` | actual: `content/tool_call/done` |
| DOC-7 | HIGH | wire-contracts-phase-3.md | `wordsUsed` = word count | actual: minutes-of-audio rounded up |
| DOC-8 | HIGH | architecture.md:40 | LiteLLM `v1.83.7-stable` | actual: `main-v1.83.14-stable` / `r31-patched` |
| DOC-9 | HIGH | README.md:21 | `/readyz` has top-level `ok` | actual: nested per-component `{ok,latency_ms}` |
| DOC-10 | HIGH | README.md:21 | 30-sec smoke + 5-min quickstart use different stacks silently | clarify which stack |
| DOC-11 | HIGH | README.md:21, CONTRIBUTING.md:78 | api 147 files/1299 tests, web 65/963 | actual api 193, web 73 |
| DOC-12 | HIGH | CONTRIBUTING.md:64 | coverage 85%/80% | actual 90/90/90/90 |
| DOC-13 | HIGH | README.md:33 | web lands at `/sign-up` | actual: `/` → `/app` → `/sign-in` |
| DOC-14 | LOW | architecture.md:28 | "eight runtime units" | table lists 9 |
| DOC-15 | LOW | litellm-target-spec.md | `qwen/qwen-3.6-plus` | actual `qwen3.6-plus` |
| DOC-16 | LOW | litellm-target-spec.md | YAML excerpt 4 models | actual 6+ |
| DOC-17 | LOW | wire-contracts-phase-3.md:5 | hardcoded `/Users/nick/...` path | use relative ref |
| DOC-18 | LOW | observability.md | `/api/health` = alias for `/livez` | different shapes (adds `migrations_completed`) |
| DOC-19 | LOW | README.md | `make contract-test` sets `MOCK_DIARIZATION=true` | it does not |

---

## Phase plan for v2.4 milestone

Findings are grouped into phases by cohesion and risk:

- **P-A: Quick-win bug fixes** — LIB-1..5, LIB-7, LIB-9, HACK-H2..H6, HACK-M1..M3, M5..M8, L5. Mechanical, low-risk, TDD-paired. Excludes the two architectural CRITICALs and the large bulk-fix/god-file phases.
- **P-B: CRITICAL security fixes** — HACK-C1 (creds-at-rest) + HACK-C2 (tryPreviousToken RLS). Each its own TDD cycle. Highest priority.
- **P-C: Documentation truth pass** — DOC-1..19 + stale TECH_DEBT cleanup + full docs update (stage 3 of user request).
- **P-D: CI builds + smoke tests** — GitHub Actions, openwhispr-client cross-references (stage 4).
- **P-E: Load tests** — build + run, results into docs (stage 5).
- **P-F: OSS publish** — GitHub-standard README with UI screenshots (stage 6).

**Deferred (own future phases, too large for v2.4 quick-fix):** HACK-H1 (514-route bulk-fix), HACK-M4 (1339 comments), HACK-M9/M10 (god-file splits), LIB-6/LIB-8 redesign.
