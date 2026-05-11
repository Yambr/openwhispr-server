---
phase: 07-frontend-ui-spec
type: spec
status: locked
created: 2026-05-12
ambiguity_at_close: 0.143
ambiguity_dimensions:
  goal_clarity: 0.90
  boundary_clarity: 0.85
  constraint_clarity: 0.85
  acceptance_criteria: 0.80
requirements: [UI-SPEC-01, UI-SPEC-02, UI-SPEC-03]
---

# Phase 7 — Frontend UI-SPEC

## Purpose

Specify the **operator/admin console** and **end-user self-service UI** for OpenWhispr Server v1 at a level of detail sufficient for:

1. **Claude Design** (or any designer) to produce a complete visual design without needing to ask follow-up questions about what each screen contains, what data it shows, or what actions it offers.
2. **Claude Code** (or any frontend implementor) to take the resulting visual design and produce a working Next.js 15 + shadcn/ui v2 implementation that wires to the existing `apps/api` wire surface byte-for-byte.

The spec defines **WHAT** each screen contains and **WHY** — not **HOW** it looks. Design choices (colour, typography, exact component composition) are downstream artifacts.

## Goal

Two markdown specifications enumerate every screen, every piece of data shown, every state, and every user journey for the OpenWhispr web surfaces — such that:

- **Admin console** is a self-host operator's window into a single-tenant installation: their own audit log, their own usage stats, observability deep-links into Grafana, read-only views over their accumulated transcriptions / notes / conversations / folders / messages, and read-only views of STT + note-recording config.
- **End-user UI** is the minimal web-facing surface for the OpenWhispr account holder: authentication (sign-in / sign-up / verify-email / password reset / OIDC), a stats dashboard, and account management (profile + deletion).

Both UIs run as a single Next.js 15 App Router application served from the same origin as the `apps/api` Fastify server (or as a separate Vercel deployment that points at the api's public URL). The split between "admin" and "end-user" surfaces is **routing-level**, not deployment-level: `/admin/*` requires elevated role; `/app/*` requires only authenticated user.

## In Scope

### Admin Console — 3 screens (operator-only tooling)

| # | Screen | Route | Data source |
|---|--------|-------|-------------|
| A1 | Audit log viewer | `/admin/audit` | DB read of `audit_log` table (Phase 6 partition-aware) |
| A2 | Observability hub | `/admin/observability` | Static deep-links into Grafana dashboards (Phase 6 Plan 11) |
| A3 | Config view | `/admin/config` | `GET /api/stt-config` + `GET /api/note-recording-config` |

### End-User UI — 13 screens (account + own resources)

**Auth flow (3):**

| # | Screen | Route | Data source |
|---|--------|-------|-------------|
| U1 | Sign-in | `/sign-in` | Better Auth `/api/auth/sign-in/email` + OIDC `/api/auth/sign-in/social/:provider` |
| U2 | Sign-up | `/sign-up` | Better Auth `/api/auth/sign-up/email` |
| U3 | Verify email | `/verify-email?token=...` | Better Auth verification handler |

**Account (2):**

| # | Screen | Route | Data source |
|---|--------|-------|-------------|
| U4 | Usage dashboard (post-auth landing) | `/app` | `GET /api/usage` + `GET /api/streaming-usage` |
| U5 | Profile + account deletion | `/app/account` | `GET /api/auth/get-session` + `DELETE /api/auth/delete-account` |

**Own resources — read-only viewer (server is single source of truth; desktop client is a mirror):**

| # | Screen | Route | Data source |
|---|--------|-------|-------------|
| U6 | Transcriptions list | `/app/transcriptions` | `GET /api/transcriptions/list` (keyset pagination) |
| U7 | Transcription detail | `/app/transcriptions/[id]` | `GET /api/transcriptions/list?id=...` (single-row filter) — shows full `text`, `raw_text`, `word_count`, `provider`, `model`, `language`, `audio_duration_ms`, `status`, `created_at` |
| U8 | Notes list (with folder tree sidebar) | `/app/notes` | `GET /api/notes/list` + `GET /api/folders/list` |
| U9 | Note detail | `/app/notes/[id]` | `GET /api/notes/list?id=...` — shows full `content`, `transcript`, `enhanced_content`, `enhancement_prompt`, `audio_duration_seconds`, `participants`, `note_type`, folder breadcrumb |
| U10 | Notes search | `/app/notes/search?q=...` | `GET /api/notes/search` |
| U11 | Conversations list | `/app/conversations` | `GET /api/conversations/list` |
| U12 | Conversation detail (messages thread) | `/app/conversations/[id]` | `GET /api/conversations/messages?conversation_id=...` — full chat history with roles/content/metadata |
| U13 | Conversations search | `/app/conversations/search?q=...` | `GET /api/conversations/search` |

**Actions across resource screens:**
- All detail views are **read-only** (no editing — desktop client owns the write surface; web-side edits would conflict with sync).
- **Delete** (soft-delete) is the one exception: `DELETE /api/notes/delete`, `DELETE /api/transcriptions/delete`, `DELETE /api/conversations/delete` — wire a single confirm-modal pattern.
- **Copy-to-clipboard** on detail screens for the primary content (text/transcript/message).
- **Client-side export** (.md / .json blob download) on each detail screen — no new API surface, just a Blob from the already-fetched data.

### Cross-routing convention

- `/sign-in`, `/sign-up`, `/verify-email` — public.
- `/app/*` — requires authenticated user (Better Auth session).
- `/admin/*` — requires authenticated user AND `role:admin` (in single-tenant self-host the first registered user is admin by default).

### Shared cross-cutting concerns

- **i18n** — every visible string carries a copy key. Two locales required at delivery: `en` + `ru`. Negotiation: `Accept-Language` header → cookie override → user preference. Implemented via `i18next` + `next-i18next` (per project tech stack); UI-SPEC enumerates every copy key but only English strings — Russian translations land in Phase 10 (i18n + docs).
- **Auth gate** — `/admin/*` and `/app/*` redirect to `/sign-in` if no valid session. After sign-in, user lands on `/app` (default) or the intended deep-link.
- **Role gate** — `/admin/*` additionally requires `role:admin` on the session. In single-tenant self-host, the first registered user IS admin by default (Phase 7 follow-up: operator-role management — but UI-SPEC assumes the role check exists at the API/middleware layer).
- **Theme** — light + dark, system-default with manual override persisted in `localStorage`.
- **Breakpoints** — `mobile <640px`, `tablet 640-1024px`, `desktop ≥1024px` (Tailwind 4 defaults).
- **Accessibility** — WCAG 2.2 AA: keyboard navigation, focus rings, screen-reader labels, contrast ratios, prefers-reduced-motion respected.
- **States** — every data-fetching screen specifies: `loading`, `empty`, `error`, `success` views. Loading uses shadcn `Skeleton`; empty uses domain-specific copy; error shows recovery action.

## Out of Scope (explicit)

| Item | Why excluded | Re-entry point |
|------|--------------|----------------|
| Tenant CRUD UI | API doesn't exist (`/api/admin/tenants/*` not implemented in any phase) | Future Phase 7b or 8.x if multi-tenant self-host emerges |
| Users CRUD per tenant | Same — no API | Same |
| IdP config UI | Configured via env vars only (Phase 2) | Same |
| LiteLLM endpoint config UI | Configured via `LITELLM_BASE_URL` env (Phase 3) | Same |
| Cross-tenant transcription view | Requires admin-cross-tenant API which doesn't exist | Future phase |
| Virtual keys management in end-user UI | Out of end-user surface per operator decision (2026-05-12) | Optional re-entry if PAK workflow opens to end-users |
| Web transcribe / reason / realtime UI | OpenWhispr desktop client owns these flows; web app is dashboard-only | Future Phase 11+ if web client emerges |
| MCP server integration | Not in this server-side repo (desktop-client domain) | Out of OpenWhispr Server scope entirely |
| Notes / transcriptions write actions in admin UI | Read-only by design (RLS-safe, no admin-cross-tenant) | Future phase if write surface materialises |
| Translation tooling for runtime copy | Russian strings land in Phase 10 | Phase 10 i18n + docs |
| End-user usage breakdown by model / by provider | Initial dashboard shows aggregate only; detail view deferred | Optional Phase 7.x if requested |

## Constraints

### Tech stack (locked)

- **Framework:** Next.js 15 (App Router)
- **React:** 19
- **TypeScript:** strict
- **Styling:** Tailwind 4
- **Component library:** shadcn/ui v2 (copy-into-repo, not npm dep)
- **Data fetching:** TanStack Query 5
- **Forms:** react-hook-form + zod
- **Auth client:** `better-auth/react` (same auth library as the server — symmetric)
- **Tables:** TanStack Table 8
- **Charts:** Recharts (for U4 usage dashboard)
- **i18n:** i18next + react-i18next (sharing JSON bundles with the server's i18next setup from Phase 10's design)
- **Date handling:** `date-fns`

### Wire compatibility

- Every API call from the UI MUST match the wire shape defined in `BACKEND_SPEC.md` / `OAUTH_SPEC.md` byte-for-byte.
- No new API surface introduced by Phase 7. If a screen needs data that no API endpoint provides, the screen is out of scope.
- Sessions are managed via Better Auth `session` cookies. Bearer-token auth is exclusively for the desktop client and is NOT used by the web UI.

### Accessibility

- WCAG 2.2 AA on every screen.
- All interactive elements keyboard-reachable.
- All form errors announced via `aria-live`.
- Focus management on route change (skip-to-content link, programmatic focus to `h1` on navigation).
- Contrast ratios: text ≥4.5:1, large text ≥3:1, UI components ≥3:1.

### Performance

- Initial JS bundle ≤ 200KB gzipped for any single route.
- LCP < 2.5s on a cold load over 4G simulated connection.
- INP < 200ms on interaction.

### Security

- No third-party scripts on auth screens (`/sign-in`, `/sign-up`, `/verify-email`).
- `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options: DENY` headers via `next.config.ts`.
- No tokens or sensitive payloads in `localStorage` — sessions live in HttpOnly cookies managed by Better Auth.

## Acceptance Criteria

1. Two artefacts on disk: `.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md` AND `.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md`.
2. Each artefact contains, **for every screen listed in this SPEC**:
   - **Purpose** — one sentence: why this screen exists.
   - **Roles** — who can see it (`admin`, `authenticated user`, `public`).
   - **Route** — exact Next.js App Router path.
   - **Data** — every datum shown on screen, mapped to its source API endpoint + response field.
   - **Actions** — every user-initiated action (button, form submit, link), mapped to the API endpoint it invokes (or the route it navigates to).
   - **States** — `loading`, `empty`, `error`, `success` — what is rendered in each.
   - **User journey** — at least one step-by-step scenario covering the primary happy path through the screen.
   - **Copy keys** — every visible string carries a key (e.g., `admin.audit.filter.action.label`); English value included; Russian deferred.
   - **Wireframe (ASCII)** — block-level layout indicating content hierarchy (sidebar / main / panels).
   - **shadcn/ui v2 component inventory** — list of shadcn primitives used (`Table`, `Dialog`, `Form`, `Skeleton`, `Toast`, etc.) so Claude Design knows the component vocabulary.
3. Both artefacts cross-link a shared appendix: **design tokens** (colour roles, spacing scale, typography ramp, motion durations), **breakpoint matrix**, **i18n key index**, and **API endpoint index** (table of every endpoint the UI calls, with method + path + auth requirement).
4. Spec linter (TBD in `tools/lint-ui-spec.ts`) validates structure: every screen has all 9 required subsections; every API endpoint referenced exists in `apps/api/src/routes/`; every copy key is unique; ASCII wireframes parse as monospace.
5. CI green.

## Verification Mode

`gsd-verifier` for Phase 7 confirms:
- Both `UI-SPEC-*.md` files exist and lint clean.
- Every screen enumerated in this SPEC has a corresponding section in the relevant UI-SPEC file.
- Every API endpoint referenced by UI-SPEC actually exists in `apps/api/src/routes/`.
- Every copy key is referenced at most once across both files (uniqueness).
- CI lint job green.

## Ambiguity Report (closed at 2026-05-12)

| Dimension | Score | Min | Status |
|-----------|-------|-----|--------|
| Goal Clarity | 0.90 | 0.75 | ✅ |
| Boundary Clarity | 0.85 | 0.70 | ✅ |
| Constraint Clarity | 0.85 | 0.65 | ✅ |
| Acceptance Criteria | 0.80 | 0.70 | ✅ |
| **Composite ambiguity** | **0.143** | ≤0.20 | ✅ Gate passed |

### Locked decisions (from 3 rounds of Socratic interview, 2026-05-12)

1. **D-SPEC-1:** Admin UI is **limited to what the existing API exposes** — no UI-driven backend design. Tenants/Users CRUD, IdP config UI, LiteLLM config UI all deferred to future phase if/when the API materialises.
2. **D-SPEC-2:** End-user UI is **minimal**: auth + stats + account only. Virtual keys management is NOT end-user surface (it lives in desktop-client domain or future PAK workflow). No web transcribe / reason / realtime UI — desktop client owns those.
3. **D-SPEC-3:** MCP server is out of OpenWhispr Server repo entirely (desktop-client domain).
4. **D-SPEC-4:** Admin sees own transcriptions / notes / conversations / folders / messages as **read-only**. RLS prevents cross-tenant view; no admin-cross-tenant API exists.
5. **D-SPEC-5:** SPEC artefact is two files (`UI-SPEC-admin.md` + `UI-SPEC-end-user.md`) of 15-25 pages combined, written at a level of detail that allows Claude Code to implement nightly without follow-up questions.
6. **D-SPEC-6:** SPEC content includes: per-screen purpose + roles + data + API source + actions + 4 states + 1+ user journey + copy keys + ASCII wireframe + shadcn component inventory.
7. **D-SPEC-7:** i18n target is `en` + `ru` per project rule. UI-SPEC enumerates copy keys + English strings; Russian translations land in Phase 10.

## Downstream

After this SPEC is committed:

1. `/gsd-discuss-phase 7` picks up this SPEC.md and surfaces remaining gray areas around HOW to structure the deliverable artefacts (file layout, lint structure, design-token format).
2. After discuss: `/gsd-plan-phase 7` produces the per-plan task breakdown.
3. After plan: hand SPEC.md + the two `UI-SPEC-*.md` skeletons to Claude Design for visual.
4. Once visual lands: `/gsd-execute-phase 7` writes the actual `UI-SPEC-*.md` files referencing the visual + finalises the lint.

## Out-of-scope-but-tracked (future inserts)

- **Phase 7b (proposed):** admin-cross-tenant API + UI for multi-tenant self-host operators. Adds tenants CRUD, users CRUD, IdP config UI, LiteLLM endpoint config UI.
- **Phase 7.x (proposed):** end-user virtual-keys management page (if PAK workflow opens to end-users).
- **Phase 6.x (carried from Phase 6 verifier audit-trail):** wire Fastify production pino logger so Loki correlation works on the api tier too (currently worker-only).
