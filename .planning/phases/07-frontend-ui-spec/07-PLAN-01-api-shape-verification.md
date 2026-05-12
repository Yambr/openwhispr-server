---
phase: 07-frontend-ui-spec
plan: 01
type: execute
wave: 0
depends_on: []
files_modified:
  - .planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md
  - .planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md
autonomous: true
requirements: [UI-SPEC-01, UI-SPEC-02]
must_haves:
  truths:
    - "Each UI-SPEC stub file exists with a top-level header and a `## API Reference (verified)` appendix section"
    - "Every endpoint named in 07-SPEC.md and 07-CONTEXT.md (D-API1..D-API6) is verified against the live apps/api/src/routes/ tree and its response shape pinned in the appendix"
    - "Better Auth catch-all endpoints (list-sessions, revoke-session, revoke-other-sessions, get-session, sign-in/email, sign-up/email, verify-email, delete-account, sign-in/social/:provider, forget-password placeholder) are enumerated as the BETTER_AUTH_PATHS contract"
    - "Any assumption from RESEARCH § Assumptions Log (A1–A8) is either upgraded to VERIFIED with a file:line citation OR explicitly captured as a `WIP_ENDPOINTS` entry (must be empty by Plan 07)"
  artifacts:
    - path: ".planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md"
      provides: "Header + API Reference (verified) appendix scaffold for admin surface (2 screens)"
    - path: ".planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md"
      provides: "Header + API Reference (verified) appendix scaffold for end-user surface (13 screens)"
  key_links:
    - from: "UI-SPEC API Reference appendix"
      to: "apps/api/src/routes/{usage,streaming-usage,stt-config,note-recording-config,transcriptions/*,notes/*,conversations/*,folders/*,better-auth-handler}.ts"
      via: "file:line citations in the verified table"
      pattern: "apps/api/src/routes/.+\\.ts:\\d+"
---

<role>
You are a GSD executor implementing Phase 7 Plan 01 of the OpenWhispr Server.
You verify upstream API shapes and pin them in stub UI-SPEC files. You do NOT
author screen bodies — that work is in Plans 04 and 05. Your output is the
factual ground truth those plans will build on.
</role>

<context>
@/Users/nick/openwhispr-server/CLAUDE.md
@/Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-SPEC.md
@/Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-CONTEXT.md
@/Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-RESEARCH.md
</context>

<files_to_read>
- /Users/nick/openwhispr-server/apps/api/src/routes/usage.ts
- /Users/nick/openwhispr-server/apps/api/src/routes/streaming-usage.ts
- /Users/nick/openwhispr-server/apps/api/src/routes/stt-config.ts
- /Users/nick/openwhispr-server/apps/api/src/routes/note-recording-config.ts
- /Users/nick/openwhispr-server/apps/api/src/routes/transcriptions/*.ts
- /Users/nick/openwhispr-server/apps/api/src/routes/notes/*.ts
- /Users/nick/openwhispr-server/apps/api/src/routes/conversations/*.ts
- /Users/nick/openwhispr-server/apps/api/src/routes/folders/*.ts
- /Users/nick/openwhispr-server/apps/api/src/routes/better-auth-handler.ts
- /Users/nick/openwhispr-server/apps/api/src/routes/delete-account.ts
- /Users/nick/openwhispr-server/apps/api/src/routes/index.ts
- /Users/nick/openwhispr-server/packages/auth/ (top-level config + session shape)
- /Users/nick/openwhispr-server/packages/wire-schemas/ (if Zod schemas for the above routes exist, prefer them as ground truth)
</files_to_read>

<files_to_modify>
- /Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md (CREATE)
- /Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md (CREATE)
</files_to_modify>

<task>
## Objective

Produce two stub UI-SPEC markdown files whose ONLY content (for this plan) is:

1. Top-of-file YAML front-matter (`surface`, `phase`, `generated_at`, `requirements`).
2. A short Purpose paragraph echoing the relevant requirement.
3. A `## API Reference (verified)` appendix section that tables every API endpoint
   the future screen bodies will reference, with response shape pinned to a real
   field-by-field reading of the route file (or its wire-schema Zod definition).
4. A `## Assumptions resolved` subsection that closes the A1–A8 items from
   RESEARCH § Assumptions Log (upgrade ASSUMED → VERIFIED with file:line citations,
   or move to a `WIP_ENDPOINTS` flagged list that Plan 07 must drain).

Plans 04 and 05 will append the actual screen sections on top of this scaffold.

## Step-by-step

1. **Read the routes.** Use `Read` on every file under `files_to_read`. For each
   endpoint named in 07-SPEC.md § "In Scope" tables, extract:
   - HTTP method + path (the literal string passed to `app.get` / `app.post` / etc.)
   - Request schema (body / query / params), citing the Zod schema in
     `packages/wire-schemas` if applicable.
   - Response schema (fields + types).
   - Auth requirement (session cookie / Bearer PAK / public).
   - File:line citation.

2. **Enumerate Better Auth catch-all endpoints.** Read `better-auth-handler.ts` and
   confirm it mounts `app.all("/api/auth/*", ...)`. Build the BETTER_AUTH_PATHS
   list per RESEARCH § "Linter caveat: Better Auth catch-all routes":
   - `POST /api/auth/sign-in/email`
   - `POST /api/auth/sign-up/email`
   - `POST /api/auth/sign-out`
   - `POST /api/auth/verify-email`
   - `GET /api/auth/get-session`
   - `GET /api/auth/list-sessions`
   - `POST /api/auth/revoke-session`
   - `POST /api/auth/revoke-other-sessions`
   - `DELETE /api/auth/delete-account`
   - `GET /api/auth/sign-in/social/:provider`
   Confirm each against the installed Better Auth version (read `packages/auth`).
   If any of these are unavailable in the installed version, mark the SPEC entry
   with a `WIP_ENDPOINTS` flag — DO NOT add a new server endpoint (D-S1).

3. **Resolve RESEARCH Assumptions Log.**
   - A1 (`list-sessions` available): confirm via `packages/auth/` config + Better
     Auth version in `pnpm list better-auth`.
   - A2 (`/api/usage` returns `dailySeries[].{date,requests,audioMinutes}`): read
     `usage.ts`. If the response is aggregate-only, document the real shape and
     note that Plan 05 (U4) must simplify to KPI-only charts per D-S1.
   - A3 (`providerBreakdown[]` field): same — verify or simplify U4.
   - A4 (`session.user.role` field): read `packages/auth/` session augmentation;
     pin the exact path (`session.user.role` or `session.user.tenantRole` or
     similar).
   - A5–A8: document inline.

4. **Author the two stub files.**

   `UI-SPEC-admin.md`:

   ```markdown
   ---
   surface: admin
   phase: 07-frontend-ui-spec
   generated_at: 2026-05-12
   requirements: [UI-SPEC-01, UI-SPEC-03]
   ---

   # OpenWhispr Server — Admin Console UI-SPEC

   **Purpose.** Specify the operator/admin console surface (2 screens: A2 Observability
   hub, A3 Config view) at a level of detail sufficient for Claude Design (visual)
   and Claude Code (Next.js 15 + shadcn/ui v2 implementation) to deliver nightly
   without follow-up questions.

   **Steering rule.** "Толкаемся от спеки бэка" (D-S1) — when design diverges from
   the existing API, simplify the screen, re-engage Claude Design, or defer to
   Phase 7.x. No new API endpoints are introduced by Phase 7.

   <!-- Screen sections A2 and A3 are appended by Plan 04. -->
   <!-- Shared appendix (design tokens, breakpoint matrix, i18n key index, full API endpoint index) is appended by Plan 06. -->

   ## API Reference (verified)

   | Method | Path | Auth | Request | Response (fields) | Source |
   |--------|------|------|---------|-------------------|--------|
   | GET    | /api/stt-config | session+admin | — | { providers: [...], default, ... } | apps/api/src/routes/stt-config.ts:LL |
   | GET    | /api/note-recording-config | session+admin | — | { enabled, maxDurationSeconds, ... } | apps/api/src/routes/note-recording-config.ts:LL |

   <!-- Add a row per route the admin surface touches. Cite file:line for each. -->

   ## Assumptions resolved

   | RESEARCH ID | Claim | Status | Evidence |
   |-------------|-------|--------|----------|
   | A4 | session.user.role exposed | VERIFIED | packages/auth/...:LL |
   | ... | ... | ... | ... |

   ## WIP endpoints (must be empty before Phase 7 closes)

   _(none — populate only if an endpoint is named by SPEC but not yet implemented)_
   ```

   `UI-SPEC-end-user.md`:

   Same shape, but `surface: end-user`, `requirements: [UI-SPEC-02, UI-SPEC-03]`,
   and the API table enumerates every endpoint U1–U13 touch:
   `/api/auth/*` (BA paths), `/api/usage`, `/api/streaming-usage`,
   `/api/transcriptions/list`, `/api/transcriptions/delete`,
   `/api/notes/list`, `/api/notes/search`, `/api/notes/delete`,
   `/api/folders/list`, `/api/conversations/list`,
   `/api/conversations/messages`, `/api/conversations/search`,
   `/api/conversations/delete`.

5. **Self-check.** Run `rg "app\.(get|post|patch|delete|all|put)\(" apps/api/src/routes/`
   and cross-check the resulting endpoint set against your tables. Any endpoint
   named in your table but NOT in the rg output must be either (a) a BA catch-all
   path (move to BETTER_AUTH_PATHS appendix entry) or (b) a WIP entry flagged for
   Plan 07 follow-up. Do not invent endpoints.

## Acceptance criteria

- Both files exist at the paths in `files_to_modify`.
- Each file has the YAML front-matter described above.
- Each file has the `## API Reference (verified)` section with at least one row
  per endpoint named in the relevant 07-SPEC.md "In Scope" table.
- Every row carries a `file:line` citation (or the literal string
  `BETTER_AUTH_HANDLER` for catch-all paths).
- The `## Assumptions resolved` table closes all of RESEARCH § A1–A8.
- The `## WIP endpoints` section is either empty or contains items that Plan 07
  can drain before phase close.
- Markdown lints clean against the existing repo conventions (no trailing
  whitespace, ATX headings, LF line endings).
- English only. No emojis.

## Out of scope (do NOT do)

- Do NOT author screen bodies (Purpose / Roles / Route / Data / Actions / States /
  User journey / Copy keys / Wireframe / shadcn primitives subsections). Those
  land in Plan 04 and Plan 05.
- Do NOT touch `apps/api/src/routes/` (read-only).
- Do NOT add new endpoints (D-S1).
- Do NOT scaffold `apps/web/` (deferred to Phase 8 per RESEARCH Open Q 1).
</task>

<tests>
This plan produces specification scaffolding, not executable code. The
"automated verification" runs after Plan 02 lands (linter tests). For this plan:

- Manual `Read` of both files after writing.
- Grep proof:
  - `grep -c "^| GET\|^| POST\|^| PATCH\|^| DELETE" UI-SPEC-admin.md` ≥ 2
  - `grep -c "^| GET\|^| POST\|^| PATCH\|^| DELETE" UI-SPEC-end-user.md` ≥ 13
  - `grep -E "apps/api/src/routes/.+\\.ts:[0-9]+" UI-SPEC-admin.md` returns ≥ 1 line per row (excluding BA rows)
  - Same for UI-SPEC-end-user.md.
</tests>

<commit_message>
docs(07): scaffold UI-SPEC stubs and pin API shapes

Creates the two UI-SPEC stub files (UI-SPEC-admin.md, UI-SPEC-end-user.md)
with verified API Reference appendix tables citing apps/api/src/routes/
file:line for every endpoint Phase 7 screens reference. Closes RESEARCH
Assumptions Log A1-A8 with file:line evidence. Establishes the
BETTER_AUTH_PATHS allowlist that the spec linter (Plan 03) will consume.

No new API endpoints introduced (D-S1 steering rule honored).

Refs: UI-SPEC-01, UI-SPEC-02
</commit_message>
