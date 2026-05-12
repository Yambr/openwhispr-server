---
phase: 07-frontend-ui-spec
plan: 05
type: execute
wave: 1
depends_on: [01, 02]
files_modified:
  - .planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md
autonomous: true
requirements: [UI-SPEC-02, UI-SPEC-03]
must_haves:
  truths:
    - "UI-SPEC-end-user.md contains 13 screen sections: U1 sign-in, U2 sign-up, U3 verify-email, U4 usage dashboard, U5 account, U6 transcriptions list, U7 transcription detail, U8 notes list, U9 note detail, U10 notes search, U11 conversations list, U12 conversation detail, U13 conversations search"
    - "Each screen has all 10 required subsections per linter rule 1"
    - "U4 (D-API6) drops the 'Latest activity' feed and U4 design-gap marker is encoded"
    - "U1 (D-UX2) renders 'Forgot password?' as a disabled placeholder and the U1 design-gap marker is encoded"
    - "U7 (D-API1) renders the transcript as flat paragraphs without timecodes — UI-SPEC says 'plain paragraphs'"
    - "U5 (D-API2) sessions list uses the Better Auth catch-all endpoints (list-sessions, revoke-session, revoke-other-sessions)"
    - "U8 (D-UX5) folders sidebar is read-only — no create/rename/delete affordances documented"
    - "Every endpoint referenced is verified by Plan 01 or matches BETTER_AUTH_PATHS"
    - "Every copy key is `end-user.<screen>.<section>.<element>.<prop>` (5-level)"
    - "All 10 required subsections present under each `## U1`..`## U13` heading (Purpose, Roles, Route, Data, Actions, States, User journey, Copy keys, Wireframe, shadcn primitives) — verified by content inspection. Linter gate runs in Wave 2 (Plan 06), not here."
  artifacts:
    - path: ".planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md"
      provides: "Full end-user UI-SPEC: header + 13 screen sections + API Reference (verified) + Assumptions resolved. Shared appendix appended by Plan 06."
      contains: "## U1", "## U13", "Forgot password (disabled)", "transcript as plain paragraphs"
  key_links:
    - from: "U1/U2/U3/U5 sessions actions"
      to: "BETTER_AUTH_PATHS allowlist (catch-all)"
      via: "inline-code endpoint refs"
      pattern: "POST /api/auth/sign-in/email|GET /api/auth/list-sessions|POST /api/auth/revoke-session"
    - from: "U4 / U6 / U7 / U8 / U9 / U10 / U11 / U12 / U13 endpoint refs"
      to: "apps/api/src/routes/{usage,streaming-usage,transcriptions,notes,folders,conversations}/*"
      via: "linter endpoint-exists rule"
      pattern: "(GET|POST) /api/(usage|streaming-usage|transcriptions|notes|folders|conversations)"
    - from: "Each screen `See visual:` line"
      to: "design/screens-user.jsx function exports"
      via: "linter visual-ref-resolves rule"
      pattern: "See visual: design/screens-user.jsx#"
---

<role>
You are a GSD executor authoring the end-user half of the UI-SPEC. You write
13 screen sections (U1–U13) appended to the Plan 01 stub. You honor every
locked decision: D-API1 (flat transcript), D-API2 (BA sessions), D-API6 (no
activity feed), D-UX1 (email+password kept), D-UX2 (forgot-password disabled),
D-UX3 (no PAK UI), D-UX4 ("Continue with SSO" label), D-UX5 (folders read-only).
You DO NOT touch the admin file (Plan 04). You DO NOT introduce new endpoints
(D-S1).
</role>

<context>
@/Users/dev/openwhispr-server/CLAUDE.md
@/Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-SPEC.md
@/Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-CONTEXT.md
@/Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-RESEARCH.md
@/Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md
</context>

<files_to_read>
- /Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md (Plan 01 stub)
- /Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/design/screens-user.jsx (for See-visual function names)
- /Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/design/ui.jsx
- /Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/design/data.js
- /Users/dev/openwhispr-server/apps/api/src/routes/usage.ts
- /Users/dev/openwhispr-server/apps/api/src/routes/streaming-usage.ts
- /Users/dev/openwhispr-server/apps/api/src/routes/transcriptions/ (list + delete)
- /Users/dev/openwhispr-server/apps/api/src/routes/notes/ (list + search + delete)
- /Users/dev/openwhispr-server/apps/api/src/routes/folders/ (list)
- /Users/dev/openwhispr-server/apps/api/src/routes/conversations/ (list + messages + search + delete)
- /Users/dev/openwhispr-server/apps/api/src/routes/better-auth-handler.ts
- /Users/dev/openwhispr-server/apps/api/src/routes/delete-account.ts
</files_to_read>

<files_to_modify>
- /Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md (APPEND 13 screen sections between header and API Reference appendix)
</files_to_modify>

<task>
## Objective

Author 13 screen sections following the per-screen template. Order them
alphabetical-by-route (the default writer's-discretion choice per D-ART):

1. `## U1 — Sign in` — Route `/sign-in`
2. `## U2 — Sign up` — Route `/sign-up`
3. `## U3 — Verify email` — Route `/verify-email`
4. `## U4 — Usage dashboard` — Route `/app`
5. `## U5 — Account` — Route `/app/account`
6. `## U6 — Transcriptions list` — Route `/app/transcriptions`
7. `## U7 — Transcription detail` — Route `/app/transcriptions/[id]`
8. `## U8 — Notes list` — Route `/app/notes`
9. `## U9 — Note detail` — Route `/app/notes/[id]`
10. `## U10 — Notes search` — Route `/app/notes/search`
11. `## U11 — Conversations list` — Route `/app/conversations`
12. `## U12 — Conversation detail` — Route `/app/conversations/[id]`
13. `## U13 — Conversations search` — Route `/app/conversations/search`

(Sorting note: the alphabetical-by-route order would be `/app, /app/account,
/app/conversations, ..., /sign-in, /sign-up, /verify-email` — but presenting
auth first matches user mental model. Writer's discretion per D-ART. Pick one
order, document the choice in a one-line comment at the top of the section
block, and be consistent.)

## Per-screen content (locked decisions to enforce)

### U1 — Sign in
- Email + password form (D-UX1).
- OIDC button row: Google, GitHub, "Continue with SSO" (D-UX4 generic label).
- "Forgot password?" link rendered as static disabled text (D-UX2) — copy-key
  `end-user.signin.action.forgotPassword.link.disabled` with English value
  "Forgot password? — coming soon, contact your operator."
- **Design-gap marker** at end of section:
  ```
  > **Design gap (tracked):** Visual treatment of the disabled "Forgot password?"
  > affordance (D-UX2) — re-engage Claude Design.
  ```
- Endpoints: `POST /api/auth/sign-in/email`, `GET /api/auth/sign-in/social/:provider`.

### U2 — Sign up
- Email + password + confirm-password form.
- "Continue with SSO" + Google + GitHub OIDC row.
- Endpoint: `POST /api/auth/sign-up/email`.

### U3 — Verify email
- Reads `?token=` from query.
- Shows success / error states + sign-in CTA.
- Endpoint: `POST /api/auth/verify-email` (Better Auth catch-all handles
  whichever exact path the installed version exposes — confirm in Plan 01;
  if the path is GET-based, document accordingly).

### U4 — Usage dashboard
- 4 KPI cards (D-API6: NO Latest-activity feed).
- Charts: Requests/day line + Audio-minutes/day bar + By-provider breakdown.
- Endpoints: `GET /api/usage`, `POST /api/streaming-usage` (verified in Plan 01 — `apps/api/src/routes/streaming-usage.ts:57` registers this as POST, NOT GET).
- TanStack Query keys: `queryKeys.usage()`, `queryKeys.streamingUsage()`.
- **Design-gap marker:**
  ```
  > **Design gap (tracked):** Grid balance after the removal of the
  > "Latest activity" panel (D-API6) — re-engage Claude Design.
  ```

### U5 — Account
- Profile block (read-only from `GET /api/auth/get-session`).
- Sessions list (D-API2): `GET /api/auth/list-sessions`, with
  `POST /api/auth/revoke-session` per row and a "Revoke all other sessions"
  button calling `POST /api/auth/revoke-other-sessions`.
- Delete-account block: `DELETE /api/auth/delete-account` with a confirm
  modal that requires typing the user's email to enable.
- DO NOT add a PAK management section (D-UX3 — deferred to Phase 7.x).

### U6 — Transcriptions list
- Keyset-paginated table (`GET /api/transcriptions/list`).
- Columns from the verified response shape (Plan 01): `created_at`, `text`
  (truncated preview), `word_count`, `audio_duration_ms`, `provider`, `model`,
  `language`, `status`.
- Row click → U7. Row action: Delete (`DELETE /api/transcriptions/delete`)
  via shared confirm modal pattern (defined in the appendix by Plan 06; this
  screen references it as `<DeleteConfirmDialog>`).

### U7 — Transcription detail
- Flat paragraph rendering of `text` (D-API1: NO timecodes; Claude Design's
  00:00 / 00:42 markers are decorative-only in the mockup).
- Side panel: metadata (`word_count`, `audio_duration_ms`, `provider`,
  `model`, `language`, `status`, `created_at`).
- Actions: Copy to clipboard (client-side), Export .md (client-side Blob),
  Export .json (client-side Blob), Delete (`DELETE /api/transcriptions/delete`).
- Endpoint: `GET /api/transcriptions/list?id=...` (single-row filter; verify
  the API supports this in Plan 01's verified shape; if not, document the
  fallback of fetching the full first page and filtering client-side).

### U8 — Notes list
- Left sidebar: folders tree (D-UX5: read-only, no create/rename/delete UI),
  `GET /api/folders/list`.
- Main: notes table (`GET /api/notes/list?folderId=...`).
- Row action: Delete (`DELETE /api/notes/delete`).
- Search affordance navigates to U10.

### U9 — Note detail
- Full content: `content`, `transcript`, `enhanced_content`,
  `enhancement_prompt`, `audio_duration_seconds`, `participants`, `note_type`,
  folder breadcrumb.
- Actions: Copy / Export .md / Export .json (client-side) / Delete.
- Endpoint: `GET /api/notes/list?id=...`.

### U10 — Notes search
- `POST /api/notes/search` (verified in Plan 01 — `apps/api/src/routes/notes/search.ts:50` registers this as POST via `app.route({ method: "POST", url: "/api/notes/search", ... })`, NOT GET). Query string `q=...` becomes a JSON body field.
- Result rows link to U9.

### U11 — Conversations list
- `GET /api/conversations/list`, keyset paginated.
- Row click → U12. Row action: Delete (`DELETE /api/conversations/delete`).

### U12 — Conversation detail
- Messages thread (`GET /api/conversations/messages?conversation_id=...`).
- Each message shows role, content, metadata.
- Actions: Copy entire transcript / Export .json / Delete conversation.

### U13 — Conversations search
- `POST /api/conversations/search` (verified in Plan 01 — `apps/api/src/routes/conversations/search.ts:48` registers this as POST via `app.route({ method: "POST", url: "/api/conversations/search", ... })`, NOT GET). Query string `q=...` becomes a JSON body field.
- Result rows link to U12.

## Cross-screen conventions (document once at top of the file body)

After the header that Plan 01 created, before U1, insert a brief
`## Conventions` H2 that lists:

- **Auth gate:** Better Auth session cookie. Middleware does cookie-existence
  check; layout does full session validation. (Cite RESEARCH § Pattern 1.)
- **i18n:** every visible string carries a copy key `end-user.<screen>.<section>.<element>.<prop>`.
  English values inline. Russian deferred to Phase 10.
- **State patterns:** every fetching screen specifies all 4 states. `N/A`
  with reason is allowed (linter accepts).
- **Delete pattern:** single shared `<DeleteConfirmDialog>` component (named
  but defined in the Plan 06 appendix).
- **Export pattern:** client-side `Blob` from the already-fetched data;
  no server-side export endpoint exists (D-API3 carry-forward).
- **Query key factory:** `queryKeys.*` per RESEARCH § Pattern 2; document
  the canonical keys in each screen's Data subsection.

Mark this `## Conventions` H2 with a comment to instruct the linter to skip
it from the screen-section sweep (the linter only considers `## (A|U)\d+`
headings). No special handling needed since linter regex filters by code prefix.

## Format constraints (linter contract)

Same as Plan 04. See `tools/lint-ui-spec.config.ts` for the exact patterns.

## Acceptance criteria

- All 13 screen sections exist with the exact `## U<N> — <Name>` heading shape.
- Each has all 10 required subsections.
- U1 carries the forgot-password design-gap marker; U4 carries the activity-
  feed design-gap marker.
- U7's "Data" subsection says "transcript rendered as flat paragraphs (no
  timecodes)" verbatim.
- U5's Data table cites `GET /api/auth/list-sessions` etc. (BA catch-all).
- No new endpoint introduced — every endpoint either:
  - Exists in `apps/api/src/routes/` (verified Plan 01), or
  - Matches the BETTER_AUTH_PATHS allowlist.
- Every copy key follows the 5-level schema.
- All 10 required subsections present under each U1..U13 heading by manual
  content inspection. The cross-file `pnpm lint:ui-spec` gate runs in Wave 2
  (Plan 06) — the linter binary is authored in parallel by Plan 03 and may
  not exist when Plan 05 runs.
- Markdown style consistent with Plan 04 (LF, ATX headings, no trailing ws).
- English only. No emojis.

## Out of scope

- Shared appendix (Plan 06).
- Admin file (Plan 04).
- Re-engaging Claude Design — markers only.
- Authoring Russian translations.
- Wiring `apps/web/` (Phase 8).
</task>

<tests>
- Content inspection (NOT `pnpm lint:ui-spec` — that runs in Plan 06):
- `grep -cE "^## U([1-9]|1[0-3]) — " UI-SPEC-end-user.md` returns 13.
- `grep -c "Design gap (tracked):" UI-SPEC-end-user.md` returns ≥ 2 (U1 + U4 markers).
- `grep -c "See visual: design/screens-user.jsx#" UI-SPEC-end-user.md` returns 13.
- `grep -c "flat paragraphs" UI-SPEC-end-user.md` returns ≥ 1 (U7 D-API1).
- `grep -cE "GET /api/auth/list-sessions|POST /api/auth/revoke-session|POST /api/auth/revoke-other-sessions" UI-SPEC-end-user.md` returns ≥ 3 (U5 D-API2).
- `! grep -E "PAK manager|virtual key" UI-SPEC-end-user.md` (D-UX3: no PAK UI).
- `grep -c "Continue with SSO" UI-SPEC-end-user.md` returns ≥ 2 (U1 + U2).
- Coverage on linter unchanged; this plan only adds spec content, no new code.
</tests>

<commit_message>
docs(07): author UI-SPEC-end-user.md — U1..U13 (13 screens)

Authors the 13 end-user screen sections per 07-SPEC.md as revised by
CONTEXT decisions:
- D-UX1: email/password kept in U1/U2/U3
- D-UX2: U1 "Forgot password?" disabled, design-gap marker encoded
- D-UX3: no PAK manager web UI (deferred 7.x)
- D-UX4: "Continue with SSO" generic OIDC button label
- D-UX5: U8 folders sidebar read-only
- D-API1: U7 transcript = flat paragraphs (no timecodes)
- D-API2: U5 sessions via Better Auth catch-all
- D-API6: U4 drops Latest-activity feed, design-gap marker encoded

Each screen has the 10-subsection template with copy-key tables,
state matrix, user-journey, ASCII wireframe, and See-visual reference
to design/screens-user.jsx. `pnpm lint:ui-spec` GREEN in concert with
Plan 04's admin file.

No new API endpoints introduced (D-S1).

Refs: UI-SPEC-02, UI-SPEC-03
</commit_message>
