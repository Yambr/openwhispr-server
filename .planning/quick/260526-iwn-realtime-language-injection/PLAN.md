---
quick_id: 260526-iwn
slug: realtime-language-injection
title: "Realtime ?language= query + REALTIME_DEFAULT_LANGUAGE env fallback (v1.0.9)"
date: 2026-05-26
status: planned
mode: quick
---

# Realtime `?language=` Query + `REALTIME_DEFAULT_LANGUAGE` Env Fallback (v1.0.9)

## 1. Goal

Add an additive optional language hint to the realtime relay's GA `session.update` frame, resolved per-WSS-upgrade from `?language=` query (preferred) → `REALTIME_DEFAULT_LANGUAGE` env (fallback) → omit (OpenAI auto-detect), to stop multi-script drift (ru/zh/ja/hi/mt) on short VAD segments produced by the preconfigured immutable cloud client.

## 2. Scope

### In scope

- `apps/api/src/config/realtime.ts` — `language?: string` field on `RealtimeTranscriptionConfig`, env parse + whitelist validation in `loadRealtimeConfigFromEnv`, exported `REALTIME_LANGUAGE_WHITELIST` constant, boot-fatal `RealtimeConfigError` on invalid env.
- `apps/api/src/lib/realtime-frame-translate.ts` — `language?: string` on `RelayTranscriptionConfig`, conditional injection of `session.audio.input.transcription.language` in `buildRelaySessionUpdateFrame` (omit field when undefined).
- `apps/api/src/routes/realtime.ts` — query-string parse + whitelist validation in upgrade handler, per-upgrade shallow clone of `transcription` config (no singleton mutation), `'language'` added to `buildUpstreamUrl` strip-set on BOTH backend branches.
- Tests — extend `tests/unit/lib/realtime-frame-translate.test.ts`, NEW file `tests/unit/routes/realtime-language.test.ts`. Matrix M1–M9. Coverage ≥ 90/90/90/90 on diff.
- `charts/openwhispr-server/Chart.yaml` — `version: 1.0.11 → 1.0.12`, `appVersion: "1.0.8" → "1.0.9"`.
- `charts/openwhispr-server/values.yaml` — `image.tag: "1.0.8" → "1.0.9"` + lineage comment.
- `docs/operations.md` — `REALTIME_DEFAULT_LANGUAGE` env section + fallback chain doc + EX_CONFIG semantics.

### NOT in scope (out-of-band)

- `users.locale` resolution in realtime hot path — confirmed wrong concept (UI vs STT split per upstream `audioManager.js:54-57`).
- Whitelist beyond `['en','ru']` — gated on DB `users.locale` CHECK constraint widening.
- `loadLitellmConfigFromEnv` plaintext guard — Phase 63 backlog.
- LiteLLM image patch hardening — Phase 64 backlog.
- Any client-side change — peer `wd6g78xz` owns upstream openwhispr v1.7.9 patch that emits `?language=` on its WSS URL build.

## 3. Files Modified

| Path | Nature of change | LOC est. |
|------|------------------|---------:|
| `apps/api/src/config/realtime.ts` | Add `language?: string` to `RealtimeTranscriptionConfig` interface; export `REALTIME_LANGUAGE_WHITELIST = ['en','ru'] as const`; add env parse + whitelist validation + `RealtimeConfigError` throw branch in `loadRealtimeConfigFromEnv`; leave `DEFAULT_REALTIME_TRANSCRIPTION` untouched (language stays undefined). | ~25 |
| `apps/api/src/lib/realtime-frame-translate.ts` | Add `language?: string` to `RelayTranscriptionConfig`; conditional `...(config.language ? { language: config.language } : {})` spread into `session.audio.input.transcription`. | ~6 |
| `apps/api/src/routes/realtime.ts` | Import `REALTIME_LANGUAGE_WHITELIST` from `config/realtime`; in upgrade handler (after `userId` resolution, before `bridgeRealtimeSockets` call at ~L557) parse `req.raw.url` for `language` query, trim+lowercase, whitelist-validate, log warn on invalid; build shallow clone of `deps.transcription` with resolved language; pass clone (NOT `deps.transcription`) to `bridgeRealtimeSockets`. Add `'language'` to the `if (k !== ...)` strip-set in `buildUpstreamUrl` at L266 AND L284. | ~30 |
| `apps/api/tests/unit/lib/realtime-frame-translate.test.ts` | Extend with M1, M4, M6 (frame builder language behavior). | ~60 |
| `apps/api/tests/unit/routes/realtime-language.test.ts` | NEW — M2, M3, M5, M7, M8, M9 (route-level env+query resolution, strip-set, concurrent shallow-clone isolation). | ~220 |
| `charts/openwhispr-server/Chart.yaml` | `version: 1.0.12`, `appVersion: "1.0.9"`. | 2 |
| `charts/openwhispr-server/values.yaml` | `image.tag: "1.0.9"` + lineage comment block (L99–L106 area). | ~10 |
| `docs/operations.md` | New `REALTIME_DEFAULT_LANGUAGE` subsection in the realtime config block (whitelist, fallback chain, EX_CONFIG exit semantics, cross-ref to upstream client PR placeholder). | ~30 |

Total diff ≈ ~380 LOC including tests + docs.

## 4. Implementation Order (TDD discipline — RED first, GREEN second)

The atomic-commit doctrine requires code + tests + chart + docs in ONE commit. To honour TDD inside that envelope the executor MUST stage RED, run, witness failure, THEN stage GREEN — and only stage everything together at the very end. The verification checklist (§7) gates the final commit.

### Step 1 — RED: write failing tests against the unmodified production code

1.1. Edit `apps/api/tests/unit/lib/realtime-frame-translate.test.ts`:
- Add `describe("buildRelaySessionUpdateFrame language injection", ...)` block.
- M1: `config = { ...defaults, language: 'ru' }` → assert `frame.session.audio.input.transcription.language === 'ru'`.
- M4: `config = { ...defaults }` (no language) → assert `'language' in frame.session.audio.input.transcription === false` (field omitted, not `undefined`).
- M6: assert that whitelist constant `REALTIME_LANGUAGE_WHITELIST` exists and equals `['en','ru']` (import-level smoke test; uppercase normalisation lives at the route layer, not the builder).

1.2. Create `apps/api/tests/unit/routes/realtime-language.test.ts`:
- Set up minimal Fastify test app with `buildRealtimeRoutes` mounted; mock upstream WS dial (network boundary only — no internal-logic mocks per project rule). Use existing test helpers in `tests/unit/routes/__tests__/` if a fixture exists; otherwise inline the minimal WS-mock pattern already used by the realtime suite.
- Drive each matrix via WSS upgrade against the test server and intercept the relay-originated `session.update` frame the upstream mock receives. Snapshot the parsed JSON.
- M2: env `REALTIME_DEFAULT_LANGUAGE=ru`, query absent → frame has `language: 'ru'`.
- M3: env `REALTIME_DEFAULT_LANGUAGE=en`, query `?language=ru` → frame has `language: 'ru'` (query wins).
- M5: env unset, query `?language=xx` → frame has NO `language` field; assert a warn-level log fired with `event: 'realtime.language.invalid'` and `value: 'xx'` and `falling_back_to_env_default: false`.
- M7: `loadRealtimeConfigFromEnv({ REALTIME_DEFAULT_LANGUAGE: 'xx' })` throws `RealtimeConfigError` whose message names the offending value AND the whitelist.
- M8: stub upstream URL capture; client URL `/v1/realtime?intent=transcription&language=ru` → final upstream URL parses with NO `language` query param, in BOTH `direct` and `litellm` modes. Two parameterised cases (`backend: 'direct' | 'litellm'`).
- M9: spawn two concurrent upgrades against the same Fastify instance, client A with `?language=ru` + client B with `?language=en`; assert A's intercepted session.update has `language: 'ru'` and B's has `language: 'en'`, AND `realtimeConfig.transcription.language` (the singleton from the deps passed in) is unchanged after both bridges complete. (Property-style isolation check.)

1.3. Run RED:
```
pnpm --filter @openwhispr/api test:unit -- realtime-frame-translate
pnpm --filter @openwhispr/api test:unit -- realtime-language
```
Witness ALL new assertions fail. Confirm failure modes are "field missing" / "throws not thrown" / "language present where it should be stripped", NOT "import not found" (means production scaffolding is in place).

For M2/M3/M5/M8/M9: the route handler does not yet read the query, so `language` will be absent in the captured frame regardless of input — these MUST fail at the assertion step, not at scaffolding. If they fail at scaffolding (e.g. test helper missing), fix the test scaffold first; do not stage GREEN until the failures are clean assertion failures.

### Step 2 — GREEN: production edits, smallest possible

2.1. `apps/api/src/config/realtime.ts`:
- Above `DEFAULT_REALTIME_TRANSCRIPTION` (around L180), add:
  ```
  export const REALTIME_LANGUAGE_WHITELIST = ["en", "ru"] as const;
  export type RealtimeLanguage = (typeof REALTIME_LANGUAGE_WHITELIST)[number];
  ```
- Add `language?: RealtimeLanguage` (or `string` if the type system fights the spread) to `RealtimeTranscriptionConfig` at L126–L135. Document inline: `/** Optional ISO-639-1 language hint for session.update. undefined = omit field = OpenAI auto-detect. */`.
- In `loadRealtimeConfigFromEnv` at L210+ (after the `REALTIME_BACKEND` block, before the function returns the `transcription` object — find the existing `transcription:` literal in the return), add:
  - Read `trim(env.REALTIME_DEFAULT_LANGUAGE)?.toLowerCase()`.
  - If `undefined` → leave `language` undefined.
  - If in whitelist → assign.
  - Else → `throw new RealtimeConfigError(\`REALTIME_DEFAULT_LANGUAGE="${raw}" is not a recognized language. Valid values: ${REALTIME_LANGUAGE_WHITELIST.join(", ")}.\`);`.
- Set `transcription.language = resolved` on the returned object.

2.2. `apps/api/src/lib/realtime-frame-translate.ts`:
- Add `language?: string;` to `RelayTranscriptionConfig` at L210–L219 (mirror the config-layer interface; comment cross-refs `RealtimeTranscriptionConfig`).
- In `buildRelaySessionUpdateFrame` at L257, change the `transcription: { model: config.model }` line to:
  ```
  transcription: {
    model: config.model,
    ...(config.language ? { language: config.language } : {}),
  },
  ```
- DO NOT touch `translateClientToUpstream`, `translateUpstreamToClient`, or any other helper — header doctrine (lines 1–55) declares full passthrough; the language hint is additive to the relay-ORIGINATED frame only.

2.3. `apps/api/src/routes/realtime.ts`:
- Add import: `import { REALTIME_LANGUAGE_WHITELIST } from "../config/realtime";` (matching existing import style in this file).
- In `buildUpstreamUrl` at L266 (direct branch) AND L284 (litellm branch), extend the strip predicate:
  ```
  if (k !== "intent" && k !== "user" && k !== "model" && k !== "language") u.searchParams.set(k, v);
  ```
- In the upgrade handler around L543–L557, BEFORE `bridgeRealtimeSockets(...)`:
  ```
  const url = new URL(rawUrl, "http://internal");
  const rawLang = url.searchParams.get("language")?.trim().toLowerCase();
  let resolvedLanguage: string | undefined = deps.transcription.language;
  if (rawLang !== undefined && rawLang.length > 0) {
    if ((REALTIME_LANGUAGE_WHITELIST as readonly string[]).includes(rawLang)) {
      resolvedLanguage = rawLang;
    } else {
      req.log.warn(
        { event: "realtime.language.invalid", value: rawLang, falling_back_to_env_default: deps.transcription.language !== undefined },
        "realtime ?language= query value not in whitelist; falling back",
      );
    }
  }
  const perUpgradeTranscription = { ...deps.transcription, language: resolvedLanguage };
  ```
- Replace the existing `bridgeRealtimeSockets(clientSocket, upstreamSocket, deps.transcription, req.log)` with `bridgeRealtimeSockets(clientSocket, upstreamSocket, perUpgradeTranscription, req.log)`.
- The widened type — `(REALTIME_LANGUAGE_WHITELIST as readonly string[]).includes(rawLang)` — is needed because the const-tuple's `.includes()` narrows to its literal union and rejects arbitrary strings. This is a runtime predicate, not a type assertion, so LOCKER-02 is not violated.

2.4. Run GREEN:
```
pnpm --filter @openwhispr/api test:unit -- realtime-frame-translate realtime-language
```
All M1–M9 pass. Coverage report (`pnpm --filter @openwhispr/api test:unit --coverage -- realtime`) shows ≥ 90/90/90/90 on the three modified production files.

### Step 3 — Chart + docs

3.1. `charts/openwhispr-server/Chart.yaml`: `version: 1.0.12`, `appVersion: "1.0.9"`.

3.2. `charts/openwhispr-server/values.yaml`: at `image.tag: "1.0.8"` (L106) → `"1.0.9"`. Insert a comment block immediately above the `image:` block (around L13–L15) explaining: v1.0.9 adds realtime `?language=` query + `REALTIME_DEFAULT_LANGUAGE` env fallback for OpenAI Realtime GA `session.update` language hint. Solves auto-detect drift on short VAD segments. Coordinated with openwhispr client patch ≥ v1.7.9 that adds the query param to its WSS URL build.

3.3. `docs/operations.md`: in the realtime config section (locate via `grep -n REALTIME_BACKEND docs/operations.md`), add a new `REALTIME_DEFAULT_LANGUAGE` subsection documenting:
- Whitelist `'en' | 'ru'` for v1 (matches DB `users.locale` CHECK constraint).
- Fallback chain: query `?language=` (requires openwhispr client ≥ v1.7.9) → env → omit (OpenAI auto-detect).
- Recommended for single-language tenants OR while older client binaries are still in field.
- Boot-fatal if value not in whitelist (EX_CONFIG exit code 78 — same pattern as `REALTIME_BACKEND`).
- Cross-ref placeholder: `Coordinated with openwhispr client PR <TBD>`. Peer fills the URL on submission.

### Step 4 — Verify locally (full §7 checklist) THEN stage

Stage all touched files in ONE `git add` call. ONE `git commit` per atomic-commit doctrine. Then tag.

## 5. Test Matrix

| ID | Layer | Setup | Assertion |
|----|-------|-------|-----------|
| M1 | `buildRelaySessionUpdateFrame` unit | `config = { ...defaults, language: 'ru' }` | Built frame `session.audio.input.transcription.language === 'ru'`. |
| M2 | route | env `REALTIME_DEFAULT_LANGUAGE=ru`, no query | Intercepted upstream `session.update` has `transcription.language === 'ru'`. |
| M3 | route | env `=en`, query `?language=ru` | Intercepted frame language `=== 'ru'` (query wins over env). |
| M4 | `buildRelaySessionUpdateFrame` unit | `config = { ...defaults }` (no language) | `'language' in frame.session.audio.input.transcription === false` (omitted, NOT `undefined`). |
| M5 | route | env unset, query `?language=xx` | Frame has no `language` field; `req.log.warn` called once with `event: 'realtime.language.invalid'`, `value: 'xx'`, `falling_back_to_env_default: false`. |
| M6 | const + route | route case-folds incoming query `?language=RU` → `'ru'` (matches whitelist); also `?language=XX` → folded to `'xx'`, NOT in whitelist → warn + omit. Builder-side test asserts `REALTIME_LANGUAGE_WHITELIST` equals `['en','ru']`. | Whitelist match is post-lowercase; uppercase invalids still warn. |
| M7 | config | `loadRealtimeConfigFromEnv({ REALTIME_DEFAULT_LANGUAGE: 'xx', ...rest })` | Throws `RealtimeConfigError` whose `.message` contains the literal `xx` AND the literal `en` AND `ru`. |
| M8 | `buildUpstreamUrl` unit | Client URL `/v1/realtime?intent=transcription&language=ru&user=evil&model=evil`, parameterised over `backend: 'direct' \| 'litellm'` | Final URL parses with NO `language` query param, in BOTH branches. |
| M9 | route concurrent | Two parallel WSS upgrades against same Fastify, A `?language=ru` + B `?language=en` | A's intercepted frame language `=== 'ru'`, B's `=== 'en'`; `deps.transcription.language` reference unchanged after both bridges; the two intercepted config objects are distinct references. |

## 6. Coverage Targets

Diff coverage gate ≥ 90/90/90/90 (lines / branches / functions / statements) on:
- `apps/api/src/config/realtime.ts` — new env parse + throw branch + whitelist constant.
- `apps/api/src/lib/realtime-frame-translate.ts` — new conditional spread branch (covered by M1 + M4).
- `apps/api/src/routes/realtime.ts` — new query parse + validate + log + shallow-clone block + two new `language` strip predicates (covered by M2/M3/M5/M8/M9).

Verify via:
```
pnpm --filter @openwhispr/api test:unit --coverage -- realtime
```
Inspect the v8 coverage HTML at `apps/api/coverage/lcov-report/` for the three files; every red/yellow gutter on the diffed lines must be green.

## 7. Verification Checklist (gate the commit)

Execute in order. Each must succeed before the next.

1. `pnpm --filter @openwhispr/api lint` — passes, no new warnings.
2. `pnpm --filter @openwhispr/api typecheck` — passes, no `as any`, no `@ts-ignore`, no `@ts-nocheck`, no `as unknown as` (LOCKER-02).
3. `pnpm --filter @openwhispr/api test:unit -- realtime-frame-translate realtime-language` — all 9 matrices GREEN.
4. `pnpm --filter @openwhispr/api test:unit --coverage -- realtime` — diff coverage ≥ 90/90/90/90 on the three modified files.
5. `pnpm --filter @openwhispr/api test:integration` (if any realtime integration tests exist — `grep -l realtime apps/api/tests/integration/` to discover) — no regressions.
6. `node tools/lint-no-env-branches.ts` — LOCKER-01 green (no `NODE_ENV` references added to runtime paths; the changes touch `config/realtime.ts` which is already on the LOCKER-01 allowlist).
7. `node tools/lint-no-suppressions.ts` — LOCKER-02 green.
8. `node tools/lint-no-hardcode.ts` — LOCKER-03 green (no new localhost / UUID / secret shapes outside `tests/`).
9. `node tools/lint-prod-readiness.ts` — LOCKER-04 green (no new Fastify route declarations; the realtime upgrade handler is registered via existing `app.get` with `websocket: true`, untouched).
10. `node tools/lint-secret-shape-in-error.ts` — LOCKER-05 green (no new Error subclasses; we reuse `RealtimeConfigError`).
11. `node tools/lint-shell-credential-interpolation.ts` — LOCKER-06 green (no shell exec changes).
12. `node tools/lint-no-plaintext-secret-columns.ts` — LOCKER-08 green (no schema changes).
13. `git diff --stat` — only the 8 files in §3 are touched; nothing else.
14. Helm chart lint: `helm lint charts/openwhispr-server` — passes.
15. Docs check: `grep -n REALTIME_DEFAULT_LANGUAGE docs/operations.md` returns the new subsection.

Then and only then:
```
git add apps/api/src/config/realtime.ts \
        apps/api/src/lib/realtime-frame-translate.ts \
        apps/api/src/routes/realtime.ts \
        apps/api/tests/unit/lib/realtime-frame-translate.test.ts \
        apps/api/tests/unit/routes/realtime-language.test.ts \
        charts/openwhispr-server/Chart.yaml \
        charts/openwhispr-server/values.yaml \
        docs/operations.md
git commit -m "feat(realtime): add ?language= query + REALTIME_DEFAULT_LANGUAGE env fallback (1.0.9)"
```

Gitleaks pre-commit/pre-push hooks must fire and pass. NEVER `--no-verify` (Hard Rule 4).

## 8. Release Artifacts

- Atomic commit on `main`: `feat(realtime): add ?language= query + REALTIME_DEFAULT_LANGUAGE env fallback (1.0.9)`.
- Tags on the same SHA:
  - `v1.0.9` (application / api image version)
  - `openwhispr-server-1.0.12` (Helm chart version)
- Push:
  ```
  git push origin main
  git push origin v1.0.9 openwhispr-server-1.0.12
  ```
  (Verify hooks succeed; no `--no-verify`.)
- Image build expectation: CI `release` workflow rebuilds `ghcr.io/yambr/openwhispr-server:1.0.9` (multi-arch amd64+arm64) on tag push. Confirm via `gh run watch` against the triggered workflow.
- Helm chart: CI `chart-release` workflow re-publishes `oci://ghcr.io/yambr/charts/openwhispr-server:1.0.12` on the `openwhispr-server-1.0.12` tag.

## 9. Risk Register

| Risk | Likelihood | Mitigation |
|------|-----------:|------------|
| Singleton mutation race — concurrent upgrades clobber each other's language by mutating `realtimeConfig.transcription.language` directly. | low if shallow-clone is honoured | M9 property test asserts isolation; code review checkpoint: search `realtime.ts` for any `deps.transcription.language =` assignment — must be ZERO. |
| Env throw timing — `loadRealtimeConfigFromEnv` throws AFTER `loadLitellmConfigFromEnv` in the entrypoint, leaving partial config state. | low (existing throw branch already operates this way for `REALTIME_BACKEND`) | M7 unit test only covers throw shape; rely on existing entrypoint try/catch + EX_CONFIG exit pattern for runtime behavior. No new entrypoint changes. |
| Header doctrine drift — accidentally adding language injection to `translateClientToUpstream` or `translateUpstreamToClient`, breaking the v1.0.8 full-passthrough contract. | low | Step 2.2 explicitly scopes the edit to `buildRelaySessionUpdateFrame` only; verification step 13 `git diff --stat` enforces no other functions touched in that file. |
| Whitelist drift — DB `users.locale` CHECK constraint widens but route whitelist not updated. | medium (future) | `REALTIME_LANGUAGE_WHITELIST` is a single exported constant — future widening = one edit, one regression test. Documented in `docs/operations.md` as v1 limit. |
| Backwards-compat — old client binaries (pre-v1.7.9) without `?language=` query continue working unchanged. | low | M2 (env-only path) AND M4 (no language at all) explicitly cover this. Default behavior with no env + no query is byte-identical to v1.0.8 (field omitted = auto-detect). |
| Image rebuild miss — chart bumped to `1.0.12` referencing `image.tag: "1.0.9"` but the `:1.0.9` image is not yet published when an operator pulls. | low | Tag push order is git-tag-first → CI builds image on `v1.0.9` tag → chart consumers pull AFTER image is up. Document in release notes: deploy chart only after verifying `ghcr.io/yambr/openwhispr-server:1.0.9` manifest exists (`docker manifest inspect`). |
| Coverage miss on M5 warn-log assertion — fastify-pino capture is fiddly; test may pass without actually asserting the log fired. | medium | Use `req.log = pino({ level: 'silent' }, sink)` pattern with a `sink` array; assert sink contains the matching object. Reject any test that asserts only "no throw". |

## 10. Out-of-Scope Deferrals

- `users.locale`-as-STT-preference resolution (UI locale ≠ STT preference per upstream client split) — track as future enhancement only if user-tenant policy diverges from server-operator policy. NOT a v1 backlog item.
- Whitelist expansion (`zh`, `ja`, etc.) — gated on DB `users.locale` CHECK constraint widening; widening migration belongs to its own phase (post-v1).
- `loadLitellmConfigFromEnv` plaintext guard — Phase 63 backlog (`.planning/deferred-items.md`).
- LiteLLM image patch hardening — Phase 64 backlog (`.planning/deferred-items.md`).
- Client-side WSS URL builder change (the `?language=` emitter) — peer `wd6g78xz` owns; tracked in upstream openwhispr v1.7.9 release.
