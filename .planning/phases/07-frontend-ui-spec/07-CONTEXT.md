# Phase 7: Frontend UI-SPEC - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 7 delivers two markdown UI-SPEC artifacts (`UI-SPEC-admin.md` + `UI-SPEC-end-user.md`) that fully specify the OpenWhispr Server web surfaces at a level of detail sufficient for:

1. **Claude Design** — already delivered initial visual mockups; remaining design gaps will be patched by re-engaging Claude Design as needed.
2. **Claude Code** — can implement Next.js 15 + shadcn/ui v2 frontend nightly, without follow-up questions, wiring to the existing `apps/api` byte-for-byte.

**Steering rule (locked, from user 2026-05-12):**
> "Толкаемся от спеки бэка; фронт либо упрощаем под существующий API, либо при неясности — пинаем Claude Design на доработку. Никаких новых API в Phase 7."

This rule supersedes Claude Design's visual when they conflict — if the design assumes an endpoint that does not exist in `apps/api/src/routes/`, the screen is simplified, dropped, or sent back to Claude Design. No new API surface is introduced by Phase 7.

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**3 requirement clusters are locked** (UI-SPEC-01, UI-SPEC-02, UI-SPEC-03). See `07-SPEC.md` for full requirements, boundaries, and acceptance criteria. Composite ambiguity at close: **0.143**.

Downstream agents MUST read `07-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md, as revised by this discussion):**
- **Admin console (2 screens, revised from 3):** A2 Observability hub + A3 Config view. (A1 Audit log removed — see D-API5.)
- **End-User UI (13 screens, kept):** U1–U3 auth, U4–U5 account, U6–U13 resources (transcriptions/notes/conversations list+detail+search).
- Cross-cutting: i18n (en + ru, EN strings in v1, RU in Phase 10), Better Auth session cookies (web) / PAK Bearer (desktop), WCAG 2.2 AA, Tailwind 4 + shadcn/ui v2 + TanStack Query 5 + react-hook-form + zod, light/dark theme.

**Out of scope (from SPEC.md + revisions):**
- A1 Audit log viewer in v1 → Phase 7.x (would require new `GET /api/admin/audit/list` endpoint; Phase 6 D-A5 kept the public-read API deferred).
- Tenant/Users CRUD, IdP/LiteLLM config UI — no API exists.
- Password reset flow → backlog (Phase 7.x).
- PAK manager web UI → backlog (Phase 7.x).
- Folders CRUD in web (read-only only — desktop owns writes).
- Web transcribe / reason / realtime UI — desktop client owns these.
- MCP server integration — desktop-client domain.

</spec_lock>

<decisions>
## Implementation Decisions

### Steering rule

- **D-S1 — Backend-spec-driven.** When design diverges from existing API: (a) simplify the screen to fit the API, or (b) re-engage Claude Design to update the mockup, or (c) drop the feature into 7.x backlog. **Never** add a new API endpoint in Phase 7 to back-fill a design assumption. (User decision 2026-05-12.)

### Admin console scope (revised)

- **D-API5 — Drop A1 Audit log from v1.** Requires a new `GET /api/admin/audit/list` endpoint that does not exist (Phase 6 D-A5 deferred it). Admin v1 = **2 screens** (A2 Observability + A3 Config). A1 moves to Phase 7.x roadmap entry alongside the audit-list API.
- **D-API4 — A3 Config: drop "Effective env" block.** Showing env-var names (even redacted) is a security hot zone with no backing endpoint. A3 v1 = STT config table (`GET /api/stt-config`) + Note-recording config table (`GET /api/note-recording-config`). Operator docs link explains "how to override via env vars" but the values themselves are not surfaced.

### End-User resource screens (alignment with real API)

- **D-API1 — U7 Transcription detail: flat transcript.** API returns `text`, `raw_text`, `word_count`, `audio_duration_ms`, `provider`, `model`, `language`, `status`, `created_at`. NO word-level timestamps. UI-SPEC renders transcript as plain paragraphs (no `00:42` timecodes). Metadata sidebar shows `word_count`, `audio_duration_ms`, `provider`, `model`, `language`. Claude Design's `00:00 / 00:42 / 02:18` markers are decorative-only in the mockup; UI-SPEC says **plain paragraphs**.
- **D-API2 — U5 Sessions list via Better Auth.** Use existing Better Auth handler routes (mounted under `/api/auth/*`): `GET /api/auth/list-sessions`, `POST /api/auth/revoke-session`, `POST /api/auth/revoke-other-sessions`. No new API. UI-SPEC names these explicitly so Claude Code does not invent a custom endpoint.
- **D-API3 — A1 Audit "Export CSV" button removed.** A1 itself is out of v1 (D-API5), but for the carry-forward: if A1 returns in 7.x, export remains client-side Blob from the current keyset page only (no server-side export endpoint).
- **D-API6 — U4 "Latest activity" feed removed.** No backing endpoint. U4 v1 = 4 KPI cards + Requests/day line chart + Audio-minutes/day bar chart + By-provider breakdown. Activity feed deferred to 7.x (only if a `/api/activity/recent` endpoint materializes — but the user's steering rule says "no new APIs in Phase 7").

### UX scope (revised)

- **D-UX1 — Keep email/password in v1 UI.** SPEC stays: U1 sign-in + U2 sign-up + U3 verify-email as designed. OIDC buttons (Google / GitHub / Generic OIDC labeled as "SSO") remain alongside email/password form. Better Auth backend supports both — no backend changes.
- **D-UX2 — Password reset → Phase 7.x backlog.** "Forgot password?" link in U1 disabled in v1 (rendered as static text or links to a placeholder `/forgot-password` page that says "Password reset is coming soon — contact your operator"). 7.x adds U14 `/forgot-password` (email entry) + U15 `/reset-password?token=` (new password) using Better Auth `/api/auth/forget-password` + `/api/auth/reset-password`.
- **D-UX3 — PAK web UI → Phase 7.x backlog.** PAK auth flow (Authorization: Bearer pak_*) remains intact in the API (Phase 2 work, dual-auth.ts). Desktop client owns PAK creation/rotation/revoke. No web screen for PAK list/revoke in v1.
- **D-UX4 — LDAP via OIDC bridge.** Better Auth has no native LDAP plugin, but LDAP/AD users sign in via an upstream OIDC provider (Keycloak / Authentik / Okta / Azure AD) that the corp operator wires through env vars (`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, etc.). UI-SPEC labels the third OIDC button as **"Continue with SSO"** rather than the IdP-specific name so corp operators can rebrand via i18n override. No UI change.
- **D-UX5 — Folders read-only in web.** UI-SPEC U8 folders sidebar = read-only navigation. No create/rename/delete UI. Desktop client owns folder writes.

### UI-SPEC artifact structure

- **D-ART1 — Two markdown files.** `.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md` + `.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md`. 15–25 pages combined.
- **D-ART2 — Wireframes = ASCII + JSX reference.** Each screen section contains a block-level ASCII wireframe (sidebar/main/panels hierarchy) AND a `See visual:` line pointing to the corresponding JSX function in `design/screens-{admin,user}.jsx`. Claude Code reads ASCII for layout intent and JSX for color / spacing / Tailwind classes / motion details. Neither alone is sufficient.
- **D-ART3 — Design assets vendored under `.planning/phases/07-frontend-ui-spec/design/`.** Files: `screens-admin.jsx`, `screens-user.jsx`, `design-canvas.jsx`, `browser-window.jsx`, `tweaks-panel.jsx`, `ui.jsx`, `data.js`, `index.html`. Origin: Claude Design export 2026-05-12 (archive deleted after vendoring). Single canonical location; no zip floating around the repo.
- **D-ART4 — Copy-keys schema: `{surface}.{screen}.{section}.{element}.{prop}`.** Five-level dotted hierarchy. Examples: `admin.config.stt.table.header`, `end-user.trx.detail.metadata.duration.label`, `end-user.trx.detail.metadata.duration.value`. JSON bundles: `apps/web/src/locales/{en,ru}/{admin,end-user,common}.json`. Russian deferred to Phase 10.
- **D-ART5 — shadcn inventory: per-screen + appendix.** Each screen section ends with a `shadcn primitives:` line listing the shadcn/ui v2 components used (e.g., `Table, Skeleton, Dialog, Badge`). Appendix at end of each UI-SPEC consolidates the full set with the matching `pnpm dlx shadcn@latest add <name>` commands so Claude Code can prime the project shell in one block.
- **D-ART6 — Shared cross-link appendix.** Both UI-SPEC files reference a single appendix section (in each file, identical text — duplicated for self-contained reading) covering:
  - Design tokens (colour roles, spacing scale, typography ramp, motion durations) — sourced from `design/ui.jsx` color/spacing constants
  - Breakpoint matrix (`mobile <640`, `tablet 640–1024`, `desktop ≥1024`)
  - i18n key index (alphabetized)
  - API endpoint index (table: method + path + auth requirement + which screen consumes it)

### Spec linter

- **D-ART7 — `tools/lint-ui-spec.ts` (planner picks up).** Validates:
  - Each screen section has all 9 required subsections (Purpose / Roles / Route / Data / Actions / States / User journey / Copy keys / Wireframe / shadcn primitives).
  - Every API endpoint referenced exists in `apps/api/src/routes/` (greps the routes directory).
  - Every copy key is unique across both UI-SPEC files.
  - Every `See visual: design/...` reference points to a real function in a real file.
  - Block-level ASCII wireframes parse as monospace (every wireframe line same length when trimmed; characters from a known set).

### Claude's discretion

- Exact shadcn variants (e.g., `Button kind="ghost"` vs `Button variant="outline"`) — picker chooses based on shadcn v2 canonical names; UI-SPEC says **shadcn primitive name**, planner/executor reconciles.
- Exact en strings within each copy key — writer chooses concise, voice-consistent text; reviewer can revise during implementation.
- Order of screen sections within each UI-SPEC file — writer chooses (alphabetical-by-route is a good default).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 7 inputs
- `.planning/phases/07-frontend-ui-spec/07-SPEC.md` — Locked requirements (UI-SPEC-01..03), 16-screen enumeration (3 admin + 13 end-user → revised to 2 admin + 13 end-user by D-API5), tech stack constraints, ambiguity 0.143. **MUST read before planning.**
- `.planning/phases/07-frontend-ui-spec/design/` — Claude Design output 2026-05-12 (JSX mockups + index.html runner). Authoritative visual reference for every screen Phase 7 implements.

### Project-level
- `CLAUDE.md` — Constitutional rules (TDD, ≥90/90/90/90 coverage on diff, GHA-only CI, no internal mocks, English-only source artifacts, en+ru runtime localization).
- `.planning/PROJECT.md` — OpenWhispr Server project charter.
- `.planning/REQUIREMENTS.md` — Master requirements list (UI-SPEC-01..03 entries).

### Upstream wire spec (compatibility-critical)
- Upstream `BACKEND_SPEC.md` (1556 lines) — wire surface UI calls. Every endpoint UI-SPEC names must match byte-for-byte.
- Upstream `OAUTH_SPEC.md` — desktop OAuth flow that mints PAK; Phase 7 web UI does NOT participate but must not break it.
- Upstream `SELF_HOSTING.md` — quickstart UX expectations.

### Carry-forward from prior phases
- `.planning/phases/06-observability-ops-hardening-workers/06-CONTEXT.md` — Phase 6 D-A5 (audit-log public-read API deferred, reason A1 dropped from v1); D-T1..T7 (OTel surfacing — informs A2 Observability deep-link targets); D-A1..A8 (audit_log table semantics — relevant for 7.x audit-list endpoint design).
- `.planning/phases/02-*/02-CONTEXT.md` (if needed during planning) — Better Auth Bearer/JWT/OIDC plugin wiring, PAK schema, dual-auth middleware.
- `apps/api/src/routes/` — Source of truth for every API endpoint UI-SPEC may reference. Lint enforces existence.
- `apps/api/src/middleware/dual-auth.ts` — Session-cookie-or-Bearer-PAK auth model. Web uses session cookie exclusively.
- `packages/auth/` — Better Auth setup (server-side); session shape consumed by frontend `better-auth/react` client.

### Frontend tech stack canonical docs
- Next.js 15 App Router (`https://nextjs.org/docs/app`) — routing model.
- shadcn/ui v2 (`https://ui.shadcn.com/`) — component catalog and CLI.
- TanStack Query 5 (`https://tanstack.com/query/v5/docs/framework/react/overview`) — data-fetch pattern referenced by UI-SPEC.
- Better Auth React client (`https://www.better-auth.com/docs/integrations/react`) — session hook surface.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **API routes** (`apps/api/src/routes/`): every endpoint UI-SPEC references already exists — sign-in (Better Auth handler), `/api/usage`, `/api/streaming-usage`, `/api/transcriptions/list`, `/api/notes/list|search`, `/api/conversations/list|messages|search`, `/api/folders/list`, `/api/stt-config`, `/api/note-recording-config`, `/api/auth/delete-account`, `/api/auth/get-session`. UI-SPEC is a wiring spec, not an API extension.
- **`packages/wire-schemas`**: Zod schemas of the wire surface — frontend can import these as runtime validators for fetched payloads.
- **`packages/i18n`**: i18next setup already used by server-side emails / error messages — frontend reuses the same locale-bundle convention.
- **`design/` JSX**: Claude Design output is React + inline styles, NOT shadcn-based. Treat it as visual reference only; the actual implementation uses shadcn primitives mapped per D-ART5.

### Established Patterns
- **No `apps/web` yet** — Phase 7 produces the SPEC; the Next.js project skeleton itself is created during execute-phase (planner decides whether to scaffold `apps/web/` during this phase or punt to Phase 8). UI-SPEC names directories assuming `apps/web/` as the eventual location.
- **Locale negotiation**: server-side Accept-Language → cookie → user-preference (Phase 2 / Phase 10). Frontend mirrors this with `next-i18next` chain.
- **Auth on web = session cookie only**. Bearer/PAK is desktop-only. UI-SPEC must not show Bearer-token affordances in web screens.
- **Soft-delete via `deleted_at`** is the convention in `apps/api/src/lib/soft-delete.ts`. Delete actions in UI-SPEC trigger `DELETE` endpoints that perform soft-delete server-side.

### Integration Points
- **Same-origin or subdomain**: SPEC notes the web app runs same-origin as `apps/api` OR as a separate Vercel deployment pointing at the API's public URL. UI-SPEC names cookie SameSite/Domain implications but the planner / executor resolves CORS specifics.
- **Better Auth client** consumes the same session endpoints the server exposes — symmetric library. Frontend imports `better-auth/react` and shares the session shape with the server.
- **TanStack Query keys** form a stable convention so cache invalidation works across the resource screens (list invalidates on detail-mutate, etc.). UI-SPEC names the canonical query keys per screen.

</code_context>

<specifics>
## Specific Ideas

- **"Толкаемся от спеки бэка"** (verbatim user phrasing, 2026-05-12) — single most-load-bearing rule of this phase. Every design-vs-API conflict gets resolved by either simplifying the UI, pushing back to Claude Design, or deferring the screen; never by adding a new API.
- **Claude Design re-engagement loop is allowed and expected**. The execute-phase writer is permitted to mark a screen as "design-gap" and queue a follow-up Claude Design pass rather than invent visual decisions. Three known gaps after this discussion:
  1. U1 "Forgot password" link state when password reset is disabled (D-UX2) — needs visual treatment.
  2. A3 layout when "Effective env" block is removed (D-API4) — vertical space rebalancing.
  3. U4 layout when "Latest activity" panel is removed (D-API6) — grid rebalancing.
- **"Continue with SSO" button label** (D-UX4) — generic label so corp operators with LDAP-via-Keycloak/Authentik can rebrand without code changes. Lock as `end-user.signin.oidc.sso.label = "Continue with SSO"`.

</specifics>

<deferred>
## Deferred Ideas

### Phase 7.x (web UI follow-ups, after Phase 7 lands)
- **U14/U15 Password reset flow** — `/forgot-password` + `/reset-password?token=`, wired to Better Auth `/api/auth/forget-password` + `/api/auth/reset-password`.
- **U16 PAK manager web UI** — read-only list of user's PAKs (id, name, created_at, last_used_at, scopes) + Revoke action. Endpoints already exist (`/api/v1/keys/list`, `/api/v1/keys/:id/revoke`); needs new screen + Claude Design pass.
- **A1 Audit log viewer** — requires backend endpoint `GET /api/admin/audit/list` (Phase 6 D-A5 left this open). Add the endpoint + admin-role guard + keyset pagination, then add the screen.

### Phase 7b (multi-tenant operator console, much later)
- Tenants CRUD UI + admin-cross-tenant API.
- Users CRUD per tenant.
- IdP config UI (currently env-only).
- LiteLLM endpoint config UI (currently env-only).

### Phase 6.x (carried over from prior phase audit, unchanged)
- Wire Fastify production pino logger so Loki↔Tempo correlation works at the API tier (currently worker-only).
- Delete virtual-key-rotation dead code (worker job + test + scheduler entry + queues entry + index.ts importer).

### Out of OpenWhispr Server entirely
- MCP server integration — desktop-client domain.
- Web transcribe / reason / realtime UI — desktop client owns these flows.

</deferred>

---

*Phase: 07-frontend-ui-spec*
*Context gathered: 2026-05-12*
