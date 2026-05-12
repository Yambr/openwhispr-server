---
surface: admin
phase: 07-frontend-ui-spec
generated_at: 2026-05-12
requirements: [UI-SPEC-01, UI-SPEC-03]
---

# OpenWhispr Server — Admin Console UI-SPEC

**Purpose.** Specify the operator/admin console surface (2 screens: A2 Observability
hub, A3 Config view) at a level of detail sufficient for Claude Design (visual)
and Claude Code (Next.js 15 + shadcn/ui v2 implementation) to deliver without
follow-up questions.

**Steering rule.** "Толкаемся от спеки бэка" (D-S1) — when design diverges from
the existing API, simplify the screen, re-engage Claude Design, or defer to
Phase 7.x. No new API endpoints are introduced by Phase 7.

<!-- Screen sections A2 and A3 are appended by Plan 04. -->
<!-- Shared appendix (design tokens, breakpoint matrix, i18n key index, full API endpoint index) is appended by Plan 06. -->

## API Reference (verified)

Every endpoint the admin surface references, with HTTP method, request shape,
response shape, auth requirement, and a citation back to the live route file
or to the Better Auth catch-all handler. **HTTP method is read from the route
file's `method:` key inside `app.route({...})` or the literal in `app.<method>(...)`
— not inferred.**

| Method | Path | Auth | Request | Response (fields) | Source |
|--------|------|------|---------|-------------------|--------|
| GET    | /api/stt-config                | session (dual-auth) | — | `{ defaultModel: string, defaultLanguage: string, availableProviders: string[] }` | apps/api/src/routes/stt-config.ts:43-58 |
| GET    | /api/note-recording-config     | session (dual-auth) | — | `{ maxDurationSeconds: number, sampleRateHz: number, allowedFormats: string[], diarizationEnabled: boolean }` | apps/api/src/routes/note-recording-config.ts:32-48 |
| GET    | /api/auth/get-session          | session (cookie)    | — | Better Auth session: `{ session: {...}, user: { id, email, name, emailVerified, createdAt, updatedAt, ... } }` (NO `role` field — see Assumptions A4) | BETTER_AUTH_HANDLER (apps/api/src/routes/better-auth-handler.ts:61-92) |

> **Observability deep-links (A2):** A2 is read-only and does NOT call any API
> on this server. Its links target the operator's Grafana / Tempo / Mimir /
> Loki dashboards (Phase 6 Plan 11) at URLs supplied via environment
> (`OBS_GRAFANA_URL`, `OBS_TEMPO_URL`, etc.). Verified: no admin-specific
> endpoint exists in apps/api/src/routes/ (`rg "admin" apps/api/src/routes/`
> returns zero matches as of 2026-05-12).

### Better Auth catch-all paths (BETTER_AUTH_PATHS)

`apps/api/src/routes/better-auth-handler.ts:61` mounts
`app.all("/api/auth/*", { config: { auth: false } }, ...)` which delegates every
`/api/auth/**` request to Better Auth 1.6.9's universal handler. The admin
console relies on the following catch-all endpoints (subset shared with the
end-user surface):

| Method | Path | Auth | Used by |
|--------|------|------|---------|
| GET    | /api/auth/get-session                | session cookie  | A3 (role gate at layout level — see A4) |
| POST   | /api/auth/sign-out                   | session cookie  | shared header logout |
| GET    | /api/auth/list-sessions              | session cookie  | not used in admin (U5 only) |

## Assumptions resolved

Closes RESEARCH § Assumptions Log A1–A8.

| ID | Claim | Status | Evidence |
|----|-------|--------|----------|
| A1 | `GET /api/auth/list-sessions` available via Better Auth catch-all | VERIFIED | better-auth@1.6.9 in apps/api/package.json:30; catch-all mount at apps/api/src/routes/better-auth-handler.ts:61 — Better Auth 1.x exposes `list-sessions` natively |
| A2 | `/api/usage` returns `dailySeries[].{date,requests,audioMinutes}` | REFUTED (KPI-only) | apps/api/src/routes/usage.ts:66-71 returns `{ wordsUsed, wordsRemaining, plan, limitReached }`. No daily series. U4 simplifies to KPI-only per D-S1 |
| A3 | `providerBreakdown[]` field in `/api/usage` response | REFUTED | Same as A2 — no breakdown field. By-provider panel dropped from U4 per D-S1 |
| A4 | `session.user.role` exposed by Better Auth session | REFUTED (no role field configured) | apps/api/src/auth.ts:167-220 — Better Auth config does NOT declare `additionalFields.user.role` or `customSession`. packages/data/src/schema/users.ts has no `role` column. WIP — see WIP endpoints below |
| A5 | `apps/web/` scaffold deferred to Phase 8 | VERIFIED | .planning/phases/07-frontend-ui-spec/07-CONTEXT.md `<deferred>` confirms; no `apps/web/` directory present in tree |
| A6 | Recharts under 200KB-per-route gzipped (U4) | DEFERRED | Measurement happens in Phase 8 (`size-limit`). Marked DEFERRED — not blocking for admin surface (A2/A3 do not use Recharts) |
| A7 | `NEXT_LOCALE` cookie name (i18n) | DEFERRED | Phase 10 ratifies. Not blocking Phase 7 SPEC body |
| A8 | Better Auth `useSession()` returns `{ data, isPending, error, refetch }` under React 19 | VERIFIED | better-auth@1.6.9 React client (apps/api/package.json:30) — see better-auth.com/docs/concepts/session-management |

## WIP endpoints (must be empty before Phase 7 closes)

| Item | Reason | Resolution path |
|------|--------|-----------------|
| Admin role gate (`/admin/*` access control) | A4 REFUTED — Better Auth session has no `role` field; no `tenant_members` table either. Layout-level role check has no source of truth | Plan 04 (admin UI-SPEC authoring) MUST resolve by either (a) gating admin routes by "first registered user" heuristic (single-tenant self-host assumption), or (b) deferring A2/A3 to Phase 7.x with a new `role` column migration. Per D-S1, option (a) is preferred — no new API. Recommended copy: "Admin console (single-tenant operator only)" with no in-app role check; deployment-level Traefik basic-auth covers the operator surface |
