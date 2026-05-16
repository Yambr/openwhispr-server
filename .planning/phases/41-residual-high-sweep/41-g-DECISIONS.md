# Phase 41.g — small-pkgs HIGH cluster: Decisions

Source: `.planning/review/small-pkgs.md` HI-01..03.
Branch: main (no worktree). Stash applied pre-flight.

---

## D-41g-01 — HI-01: rename `@openwhispr/i18n` → `@openwhispr/i18n-stub`

**Evidence (grep audit on HEAD):**

```
grep -rln "@openwhispr/i18n" apps/ packages/ --include="*.ts" --include="*.tsx" --include="*.json"
→ (zero matches outside packages/i18n/ itself)
```

Real i18n is shipped elsewhere:
- `apps/api/src/i18n/init.ts` (server-side, mounted in bootstrap).
- `apps/web/src/locales/{en,ru}/{common,admin,end-user}.json` (4.6 KB to 23 KB per file — real keys, not 37-byte stubs).

The Phase 0 stub `packages/i18n` ships:
- `src/index.ts:loadLocale("en"|"ru")` returning `Record<string,string>` whose ONLY key is `phase: "phase-0-placeholder"`.
- `locales/{en,ru}/common.json` — 37 bytes each, `{"phase":"phase-0-placeholder"}`.
- One unit test asserting the placeholder loads.

**Decision:** mirror the **Phase 38 `auth → auth-stub` pattern** (commit `cbe0082`-era):

1. Rename `packages/i18n/package.json` → `"name": "@openwhispr/i18n-stub"`. `private: true` already set.
2. Replace `loadLocale` with `isPlaceholder(): boolean` so the load-bearing `@openwhispr/i18n` namespace cannot be squatted, and the export is retained as a Stryker mutation target (same rationale as Phase 38 auth-stub).
3. Delete `locales/en/common.json` + `locales/ru/common.json` + the `locales/` directory entirely (they were 37-byte lies).
4. Update the existing unit test to assert `isPlaceholder()` returns `true`.
5. Update `vitest.config.ts` project name `"@openwhispr/i18n"` → `"@openwhispr/i18n-stub"`.
6. Remove the allowlist entry `packages/i18n/src/index.ts:11` from `tools/lint-prod-readiness.allowlist.txt` (the dead-export it pointed at no longer exists).
7. Top-of-file comment documents the deprecation and points at real i18n locations.

**Rationale:** Phase 10 fully covers i18n. Phase 38 established the rename-to-stub precedent for placeholder packages occupying load-bearing namespaces. Same risk surface, same fix shape, same locking discipline.

---

## D-41g-02 — HI-02: parity rule = strict equality on shared canonical provider list

**Surface:** `packages/observability/src/redact.ts` lists `REDACT_PATHS` entries 73-89 (top-level provider env-key names + `*.PROVIDER_KEY` wildcard pairs). `packages/byok-guard/src/redact-url.ts` masks credential-bearing URL query params and bearer-token-shaped path segments (URL surface, not env-key surface).

The HI-02 finding asks for a **single canonical provider-env-key list** the two layers share, with a parity test that fails on drift.

**Decision:** strict equality (not subset).

- Create `packages/observability/src/provider-env-keys.ts` exporting `export const PROVIDER_ENV_KEYS = [...] as const` — the eight names already in `REDACT_PATHS`.
- `redact.ts` consumes `PROVIDER_ENV_KEYS` to build its top-level + wildcard redact paths instead of hand-listing them.
- Add a parity test that asserts:
  1. Every entry in `PROVIDER_ENV_KEYS` appears as both a top-level path AND a `*.NAME` wildcard inside `REDACT_PATHS`.
  2. `redactUrl` (from `byok-guard`) masks a synthetic URL whose query carries `?<lower>=<fake-token>` for every entry in `PROVIDER_ENV_KEYS`.

Adding a new provider env key in only one layer fails the parity test on the next CI run. Same drift-as-failure shape as the existing Phase 40 `redact-url-parity.test.ts`, but inverted: parity-test-as-source-of-truth, not parity-test-as-discoverer.

**Why strict equality not subset:** the corp-overlay path (LiteLLM proxy → internal LLM gateway) means the OSS list is the universal floor. Any extension must be a deliberate, reviewed change to the canonical list, not a silent superset somewhere. Subset would let drift exist as long as observability is *at least* as broad as byok-guard, but that allows the silent-redaction-miss in byok-guard the review explicitly warned about.

---

## D-41g-03 — HI-03: SMTP_SECURE accepts `1 | true | yes | on` case-insensitive trimmed

**Evidence:** `packages/email/src/EmailSender.ts:115` reads `env.SMTP_SECURE === "true"` — strict string equality rejects `1`, `TRUE`, `yes`, `on`, `" true "` (trailing whitespace). Corporate operator forcing implicit TLS via `SMTP_SECURE=1` silently gets plaintext on port 587.

**Decision:**

1. Introduce a `parseBoolEnv(v: string | undefined): boolean` helper at the bottom of `EmailSender.ts` (not extracted to a shared util in this sub-fix — kept local to keep the diff blast radius small; can be hoisted to `packages/observability/src/parse-bool-env.ts` in a future phase if a second consumer appears).
2. Accept truthy: `1`, `true`, `yes`, `on` — case-insensitive, after `.trim().toLowerCase()`.
3. Reject (treat as `false`): anything else, including empty string and undefined. Default-safe — never silently flips to `true`.
4. RED tests cover both directions (truthy variants + falsy variants + default behavior when env unset).
5. SMTP_REJECT_UNAUTHORIZED is intentionally NOT widened in this sub-fix — the review noted it is "fail-safe" (only literal `"false"` disables verification), so the asymmetry is currently in the safe direction. Widening it without also adding a production warning (per the review fix recommendation) would invert the safety. Tracked as a future hardening; not in scope for 41.g.

---

## Coverage gate

Per DISCIPLINE.md Rule 1 (≥90/90/90/90 on diff): each sub-fix lands with its tests in the same atomic commit. Tests precede production code (RED → GREEN) within the commit narrative even though the working-tree state is committed atomically.
