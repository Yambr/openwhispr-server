# Phase 68 — verify-first disposition log (16 HIGH findings)
# Date: 2026-05-21
# All greps run against current main (HEAD e9e04493).

## apps/web

web HI-01 — STILL LIVE.
  SignInForm.tsx:89 `callbackURL: "/app"`, :99 `router.push("/app")`.
  No `useSearchParams` import. middleware.ts:146 `url.searchParams.set("from", path)`.
  Fix: consume `?from=` with same-origin path allowlist; fallback `/app`.

web HI-02 — STILL LIVE (library-shape exposure).
  SessionsTable.tsx:32 `token: string` on SessionRow; :77 `authClient.revokeSession({ token })`;
  :200 `revokeOne.mutate(row.token)`.
  BETTER-AUTH-VERSION CHECK: better-auth@1.6.9 dist/api/routes/session.d.mts:230-235 —
  `revokeSession` body is `z.ZodObject<{ token: z.ZodString }>` ONLY. No `{ id }` variant.
  id-based revocation is IMPOSSIBLE without a Better Auth upgrade.
  Resolution: DOCUMENTATION ROUTE — file-header comment + deferred-items v2 entry.
  RED test asserts the bearer never reaches a DOM attr / data-* / React key.

web HI-03 — STILL LIVE.
  NotesListClient.tsx:121 `queryKey: [...queryKeys.notes.list(cursor), { folder: folderFilter }]`.
  notes/page.tsx:25 prefetch `queryKey: queryKeys.notes.list(cursor)` — no folder element.
  Keys mismatch → SSR prefetch wasted. Fix: drop the `{ folder }` tuple element.

web HI-04 — STILL LIVE.
  AdminShell.tsx:4-7 "NO sign-out button ... Traefik basic-auth"; header :68 only <ThemeSwitcher />.
  Fix: add a sign-out control calling Better Auth signOut() → /sign-in.

web HI-05 — STILL LIVE (doc drift). 8 files carry stale D-ADMIN-1 / Traefik basic-auth comments:
  middleware.ts:24-25; admin/observability/page.tsx:2,10-11; admin/page.tsx:5;
  admin/config/page.tsx:2,8,15; AdminShell.tsx:2,5 (folded into HI-04 commit);
  AdminIndex.tsx:27; admin/ObservabilityClient.tsx:2; admin/ConfigClient.tsx:2,13.
  admin-guard.ts:6,21 + (admin)/layout.tsx:8,38 ALREADY correct — NOT edited.

web HI-06 — STILL LIVE.
  internal-api.ts:22 `const DEFAULT_INTERNAL_API_URL = "http://api:3000"`.
  LOCKER-03 allowlist has internal-api.ts:11,13 (docstring) + :22 (code literal).
  CHOSEN APPROACH: fail-closed — `internalApiUrl()` throws when INTERNAL_API_URL is
  unset/empty (docker-compose + Helm both set it per the file header; no real cost).
  The `:3000` code literal is removed; docstring lines 11/13 reworded to drop `:3000`.
  All 3 internal-api.ts allowlist entries (11/13/22) removed; lint:lockers must pass.

## packages/litellm-client

litellm HI-1 — STILL LIVE.
  errors.ts:73 `super(message ?? \`...${truncated}\`)`. `bodyText` truncated (:72) but
  the optional `message` override is passed verbatim. Fix: slice(0,200) the message arg.

litellm HI-2 — STILL LIVE.
  config.ts reads LITELLM_MASTER_KEY (:35) + LITELLM_BASE_URL (:40), never LITELLM_VIRTUAL_KEY.
  Fix: read LITELLM_VIRTUAL_KEY; precedence over LITELLM_MASTER_KEY.

litellm HI-3 — STILL LIVE.
  config.ts:29 `DEFAULT_LITELLM_BASE_URL = "http://litellm:4000"`; no https assertion.
  Fix: assert https on an overridden LITELLM_BASE_URL in production; opt-out
  LITELLM_ALLOW_PLAINTEXT=1 or bundled `litellm` host.

## packages/byok-guard + contract-tests

byok HI-01 — STILL LIVE.
  contract-tests/package.json: "main":"./src/index.ts", NO `files:` field.
  src/helpers/sign-in-fixture.ts:18 `export const FIXTURE_PASSWORD = "test-PW-12345!"`.
  Fix: add `files:` allowlist; relocate test helpers/test files off published surface.

byok HI-02 — STILL LIVE.
  3 test files in src/: {transcriptions,folders,notes}-shape.test.ts. Ship in tarball.
  Fix: relocate to tests/ + files: allowlist.

byok HI-03 — STILL LIVE (partial).
  schemas.ts already imports from @openwhispr/wire-schemas (:40) but still locally
  defines OpenAIRealtimeTokenResponse, UsageResponse, StreamingUsageResponse
  (counterparts exist) + HealthResponse, *Chunk family, DeepgramStreamingTokenResponse,
  ErrorEnvelope (no counterpart). Fix: import counterparts; document the rest.

byok HI-04 — STILL LIVE (partial).
  negative-matrix-enumeration.test.ts EXISTS at tests/unit/__tests__/ — drift guard present.
  TolerantEnvelope union still accepts both string + structured form. Fix: tighten.

byok HI-05 — STILL LIVE.
  multipart.ts:29 reads `resolve(__dirname, "../../../../tests/fixtures/audio", filename)` —
  repo-root path absent from a published tarball. Fix: bundle fixture + files: allowlist.

## packages/wire-schemas

wire H-1 — STILL LIVE.
  conversations.ts:26 `message: "metadata too large"` — inline English end-user message.
  Fix: machine key `metadata.too_large`.

## small-pkgs

HIGH-EMAIL-01 — STILL LIVE (doc gap). Resolution DOC-ONLY.
  CALLER-GREP (3 callers):
   - apps/worker/src/jobs/email-delivery.ts:98 — passes rendered.html from
     template-renderer; template-renderer.ts:199 `interpolate(tpl.html, vars, { htmlEscape: true })`.
   - apps/api/src/auth.ts:561 + :613 — html interpolates ONLY a Better-Auth-generated
     `url` (server-generated reset/verify URL — not user-controlled).
  NO caller interpolates user-controlled data into `html`. Resolution: doc-only —
  make caller-owns-escaping contract explicit in SendArgs.html JSDoc + email/README.md.

## DISPOSITION SUMMARY
All 16 findings STILL LIVE as the planner pre-determined. No divergence.
HI-02 → documentation route (Better Auth 1.6.9 is token-only, confirmed).
HIGH-EMAIL-01 → doc-only (no caller passes user-controlled HTML, confirmed).
HI-06 → fail-closed approach chosen.
