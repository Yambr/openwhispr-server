---
surface: end-user
phase: 07-frontend-ui-spec
generated_at: 2026-05-12
requirements: [UI-SPEC-02, UI-SPEC-03]
---

# OpenWhispr Server — End-User UI-SPEC

**Purpose.** Specify the end-user self-service surface (13 screens: U1–U13 —
auth flow, account, and read-only own-resource viewers) at a level of detail
sufficient for Claude Design (visual) and Claude Code (Next.js 15 + shadcn/ui
v2 implementation) to deliver without follow-up questions.

**Steering rule.** "Толкаемся от спеки бэка" (D-S1) — when design diverges from
the existing API, simplify the screen, re-engage Claude Design, or defer to
Phase 7.x. No new API endpoints are introduced by Phase 7.

<!-- Screen sections U1..U13 are appended by Plan 05. -->
<!-- Shared appendix (design tokens, breakpoint matrix, i18n key index, full API endpoint index) is appended by Plan 06. -->

## API Reference (verified)

Every endpoint the end-user surface references, with HTTP method, request
shape, response shape, auth requirement, and a citation back to the live route
file or to the Better Auth catch-all handler. **HTTP method is read from the
route file's `method:` key inside `app.route({...})` or the literal in
`app.<method>(...)` — not inferred.**

| Method | Path | Auth | Request | Response (fields) | Source |
|--------|------|------|---------|-------------------|--------|
| GET    | /api/usage                       | session (dual-auth) | — | `{ wordsUsed: number, wordsRemaining: 999_999_999, plan: 'unlimited', limitReached: false }` | apps/api/src/routes/usage.ts:38-73 |
| POST   | /api/streaming-usage             | session (dual-auth) | `StreamingUsageBodySchema` (sessionId, audioDurationSeconds, …12 optional telemetry fields) | `{ wordsUsed, wordsRemaining, plan, limitReached }` (same envelope as `/api/usage`) | apps/api/src/routes/streaming-usage.ts:56-137 |
| GET    | /api/transcriptions/list         | session (dual-auth) | Query: `?limit=&before=&since=` (keyset) | `{ transcriptions: CloudTranscription[] }` — each row: `{ id, user_id, text, raw_text, word_count, audio_duration_ms, provider, model, language, status, created_at, ... }` (rowToCloudTranscription) | apps/api/src/routes/transcriptions/list.ts:37-77 |
| DELETE | /api/transcriptions/delete       | session (dual-auth) | Body: `{ id: uuid }` | `{ ok: true }` or 404 `{ error: 'transcription not found' }` | apps/api/src/routes/transcriptions/delete.ts:35-65 |
| GET    | /api/notes/list                  | session (dual-auth) | Query: `?limit=&before=&since=` (keyset) | `{ notes: CloudNote[] }` — each row via rowToCloudNote | apps/api/src/routes/notes/list.ts:40-77 |
| POST   | /api/notes/search                | session (dual-auth) | Body: `{ query: string (1..256), limit?: number }` (strict zod) | `{ notes: (CloudNote & { score: number })[] }` | apps/api/src/routes/notes/search.ts:49-96 |
| DELETE | /api/notes/delete                | session (dual-auth) | Body: `{ id: uuid }` | `{ ok: true }` or 404 `{ error: 'note not found' }` | apps/api/src/routes/notes/delete.ts:32-63 |
| GET    | /api/folders/list                | session (dual-auth) | Query: `?limit=&before=&since=` (keyset) | `{ folders: CloudFolder[] }` — each row via rowToCloudFolder | apps/api/src/routes/folders/list.ts:41-78 |
| GET    | /api/conversations/list          | session (dual-auth) | Query: `?limit=&before=&since=[&include=messages]` | `{ conversations: CloudConversation[] }` or, when `include=messages`, each row carries `messages: CloudMessage[]` (capped at 100, ordered created_at ASC) | apps/api/src/routes/conversations/list.ts:54-140 |
| GET    | /api/conversations/messages      | session (dual-auth) | Query: `?conversation_id=<uuid>&limit=&before=&since=` | `{ messages: CloudMessage[] }` — each row: `{ id, conversation_id, role, content, metadata, created_at }` | apps/api/src/routes/conversations/messages.ts:144-208 |
| POST   | /api/conversations/messages      | session (dual-auth) | Body: `{ conversation_id: uuid, role: 'user'\|'assistant'\|'system'\|'tool', content: string, metadata?: object, client_message_id?: string }` (strict zod; 4 KiB metadata cap) | `CloudMessage` (single row, not wrapped) — idempotent on `client_message_id` | apps/api/src/routes/conversations/messages.ts:78-139 |
| POST   | /api/conversations/search        | session (dual-auth) | Body: `{ query: string (1..256), limit?: number }` (strict zod) | `{ conversations: (CloudConversation & { score: number })[] }` | apps/api/src/routes/conversations/search.ts:47-89 |
| DELETE | /api/conversations/delete        | session (dual-auth) | Body: `{ id: uuid }` | `{ ok: true }` or 404 `{ error: 'conversation not found' }` | apps/api/src/routes/conversations/delete.ts:33-63 |
| DELETE | /api/auth/delete-account         | session (cookie-only — Bearer/PAK rejected) | — | 200 `{}` (empty object) with `Set-Cookie` clearing all 4 cookie variants | apps/api/src/routes/delete-account.ts:88-130 |

### Better Auth catch-all paths (BETTER_AUTH_PATHS)

`apps/api/src/routes/better-auth-handler.ts:61` mounts
`app.all("/api/auth/*", { config: { auth: false } }, ...)` which delegates every
`/api/auth/**` request to Better Auth 1.6.9's universal handler (better-auth
1.6.9 declared in apps/api/package.json:30). The end-user surface relies on:

| Method | Path | Auth | Used by |
|--------|------|------|---------|
| POST   | /api/auth/sign-in/email              | public          | U1 sign-in |
| POST   | /api/auth/sign-up/email              | public          | U2 sign-up |
| POST   | /api/auth/sign-out                   | session cookie  | shared header logout |
| POST   | /api/auth/verify-email               | public (token)  | U3 verify-email |
| GET    | /api/auth/get-session                | session cookie  | every authenticated layout; U5 profile data |
| GET    | /api/auth/list-sessions              | session cookie  | U5 sessions list |
| POST   | /api/auth/revoke-session             | session cookie  | U5 revoke-session action |
| POST   | /api/auth/revoke-other-sessions      | session cookie  | U5 revoke-all-other-sessions action |
| GET    | /api/auth/sign-in/social/:provider   | public          | U1 OIDC button (Continue with SSO) — only when OIDC providers are configured (apps/api/src/auth.ts oidcProviders) |

> **Note on forgot-password.** Per D-UX2, `POST /api/auth/forget-password` and
> `POST /api/auth/reset-password` are NOT used in v1 (the "Forgot password?"
> link in U1 is disabled / links to a static placeholder). Phase 7.x will
> reintroduce them.

## Assumptions resolved

Closes RESEARCH § Assumptions Log A1–A8.

| ID | Claim | Status | Evidence |
|----|-------|--------|----------|
| A1 | `GET /api/auth/list-sessions` available via Better Auth catch-all | VERIFIED | better-auth@1.6.9 in apps/api/package.json:30; catch-all mount at apps/api/src/routes/better-auth-handler.ts:61. Better Auth 1.x exposes `list-sessions`, `revoke-session`, `revoke-other-sessions` natively — no plugin needed |
| A2 | `/api/usage` returns `dailySeries[].{date,requests,audioMinutes}` | REFUTED (KPI-only) | apps/api/src/routes/usage.ts:66-71 returns `{ wordsUsed, wordsRemaining, plan, limitReached }`. No daily series. **U4 must simplify to KPI cards only** (drop Requests/day line chart + Audio-minutes/day bar chart per D-S1). Re-engage Claude Design for U4 layout rebalancing |
| A3 | `providerBreakdown[]` field in `/api/usage` response | REFUTED | apps/api/src/routes/usage.ts:66-71 — no `providerBreakdown` field. **U4 must drop the "By provider" panel** per D-S1 |
| A4 | `session.user.role` exposed by Better Auth session | REFUTED (no role field configured) | apps/api/src/auth.ts:167-220 — Better Auth config does NOT declare `additionalFields.user.role` or `customSession`. packages/data/src/schema/users.ts has no `role` column. Not blocking for end-user surface (no `/admin/*` routes here); blocks admin surface — tracked in UI-SPEC-admin.md WIP |
| A5 | `apps/web/` scaffold deferred to Phase 8 | VERIFIED | .planning/phases/07-frontend-ui-spec/07-CONTEXT.md `<deferred>` confirms; no `apps/web/` directory present in tree |
| A6 | Recharts under 200KB-per-route gzipped (U4) | DEFERRED (and partially moot) | A2/A3 refuted U4 charts; the v1 U4 is KPI-only, so Recharts may be dropped entirely. Measurement still happens in Phase 8 if charts return in 7.x |
| A7 | `NEXT_LOCALE` cookie name (i18n) | DEFERRED | Phase 10 ratifies. Not blocking Phase 7 SPEC body |
| A8 | Better Auth `useSession()` returns `{ data, isPending, error, refetch }` under React 19 | VERIFIED | better-auth@1.6.9 React client; documented at better-auth.com/docs/concepts/session-management and github.com/better-auth/better-auth/issues/903 |

## WIP endpoints (must be empty before Phase 7 closes)

_(none for the end-user surface — every endpoint U1..U13 references is verified
above. The admin-side A4 role-gate WIP is tracked in UI-SPEC-admin.md.)_
