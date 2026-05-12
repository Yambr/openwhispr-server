---
phase: 07-frontend-ui-spec
plan: 04
type: execute
wave: 1
depends_on: [01, 02]
files_modified:
  - .planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md
autonomous: true
requirements: [UI-SPEC-01, UI-SPEC-03]
must_haves:
  truths:
    - "UI-SPEC-admin.md contains two screen sections: `## A2 — Observability hub` and `## A3 — Config view`"
    - "Each screen contains all 10 required subsections (Purpose, Roles, Route, Data, Actions, States, User journey, Copy keys, Wireframe, shadcn primitives)"
    - "Each screen has a `See visual: design/screens-admin.jsx#<FunctionName>` line pointing to a real export"
    - "All endpoints referenced are limited to: GET /api/stt-config, GET /api/note-recording-config (A3) — and zero endpoints for A2 (deep-links only). No other endpoints introduced. D-API4 (no Effective env block) and D-API5 (A1 dropped) honored."
    - "Every copy key follows `admin.<screen>.<section>.<element>.<prop>` (5-level schema). English values only. Russian deferred to Phase 10."
    - "`pnpm lint:ui-spec` exits 0 with this file in place (plus the empty end-user.md stub from Plan 01)"
  artifacts:
    - path: ".planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md"
      provides: "Full admin UI-SPEC: header + 2 screen sections + API Reference (verified) + Assumptions resolved (carried from Plan 01). Shared appendix appended by Plan 06."
      contains: "## A2 — Observability hub", "## A3 — Config view"
  key_links:
    - from: "## A3 — Config view / Data subsection"
      to: "apps/api/src/routes/stt-config.ts + apps/api/src/routes/note-recording-config.ts"
      via: "inline-code endpoint references"
      pattern: "GET /api/stt-config|GET /api/note-recording-config"
    - from: "Each screen `See visual:` line"
      to: "design/screens-admin.jsx function export"
      via: "linter visual-ref-resolves rule"
      pattern: "See visual: design/screens-admin.jsx#"
---

<role>
You are a GSD executor authoring the admin half of the UI-SPEC. You append
two screen sections to the stub created by Plan 01 and DO NOT touch the
end-user file (that work is Plan 05, running in parallel with you). You honor
D-S1 ("Толкаемся от спеки бэка"): never introduce a new API endpoint.
</role>

<context>
@/Users/nick/openwhispr-server/CLAUDE.md
@/Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-SPEC.md
@/Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-CONTEXT.md
@/Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-RESEARCH.md
@/Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md
</context>

<files_to_read>
- /Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md (Plan 01 stub)
- /Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/design/screens-admin.jsx (for See-visual function names)
- /Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/design/ui.jsx (for shadcn primitive vocabulary + design-token names)
- /Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/design/data.js (for sample data shapes — informational only)
- /Users/nick/openwhispr-server/apps/api/src/routes/stt-config.ts (response shape for A3)
- /Users/nick/openwhispr-server/apps/api/src/routes/note-recording-config.ts (response shape for A3)
- /Users/nick/openwhispr-server/.planning/phases/06-observability-ops-hardening-workers/ (Phase 6 Plan 11 Grafana dashboard names — A2 deep-links target these)
</files_to_read>

<files_to_modify>
- /Users/nick/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md (APPEND screen sections; preserve Plan 01 header + appendix)
</files_to_modify>

<task>
## Objective

Author the two admin screen sections, slotted between Plan 01's header block
and Plan 01's `## API Reference (verified)` block. Each section follows the
per-screen template from RESEARCH § "Per-screen template" with all 10
required subsections in the fixed order.

## Screens to author

### A2 — Observability hub

- **Route:** `/admin/observability`
- **Purpose:** One-paragraph operator-facing hub of deep-links into the
  self-hosted Grafana dashboards landed in Phase 6 Plan 11 (Tempo traces,
  Mimir/Prometheus metrics, Loki logs). No data fetched from
  `apps/api/src/routes/*` — the screen is a card grid of external links.
- **Data:** No API calls; static deep-links derived from
  `process.env.GRAFANA_BASE_URL`. Document the env var read in a Data table
  row with `Source: client-side env`.
- **Actions:** Click a dashboard card → opens Grafana in a new tab.
- **States:** loading = N/A (no fetch); empty = N/A; error = if
  `NEXT_PUBLIC_GRAFANA_BASE_URL` is unset, show an Alert with operator
  instructions; success = card grid.
- **User journey:** Operator clicks Observability in the sidebar; sees the
  card grid; clicks "API tier traces" → Grafana opens in a new tab.
- **Copy keys (sample, not exhaustive):**
  - `admin.observability.title.heading.text`
  - `admin.observability.subtitle.body.text`
  - `admin.observability.card.tempo.title.label`
  - `admin.observability.card.tempo.body.label`
  - `admin.observability.card.mimir.title.label`
  - `admin.observability.card.loki.title.label`
  - `admin.observability.error.envMissing.title.label`
  - `admin.observability.error.envMissing.body.label`
- **Wireframe (ASCII, in a ```text fenced block):** card grid sized for a
  desktop ≥1024px viewport; mention mobile collapse to single column.
- **See visual:** `See visual: design/screens-admin.jsx#<RealFunctionName>` —
  read the file and pick the actual export name for the observability screen.
- **shadcn primitives:** `Card`, `Button`, `Alert`, `Badge`, `Separator`.

### A3 — Config view

- **Route:** `/admin/config`
- **Purpose:** Operator-facing read-only view of the STT pipeline + note
  recording defaults. Per D-API4, the "Effective env" block is REMOVED —
  document this verbatim in the Purpose paragraph so re-engagement with
  Claude Design is unambiguous.
- **Data:** Two table renders, fetched in parallel:
  - `GET /api/stt-config` → table 1: providers, default provider, model list,
    fallback chain. Read the actual response shape from
    `apps/api/src/routes/stt-config.ts` and mirror byte-for-byte.
  - `GET /api/note-recording-config` → table 2: enabled flag, max duration
    seconds, supported codecs, retention policy.
  Document each field with the source response key in a Data table column.
- **TanStack Query keys:** `queryKeys.sttConfig()`, `queryKeys.noteRecordingConfig()`.
- **Actions:** Read-only. One "Refresh" button that invalidates both queries.
  Link to "Operator override docs" pointing to `docs/litellm-target-spec.md`.
- **States:** loading = 2 `<Skeleton>` tables; empty = N/A (config always
  returns at least defaults); error = Alert with Retry; success = two tables.
- **User journey:** Operator opens `/admin/config`; reads STT defaults to
  understand which provider/model is shipping requests; reads note recording
  defaults; clicks "How to override" → docs page.
- **Copy keys (sample):**
  - `admin.config.title.heading.text`
  - `admin.config.stt.title.heading.label`
  - `admin.config.stt.table.header.provider.label`
  - `admin.config.stt.table.header.model.label`
  - `admin.config.stt.table.header.default.label`
  - `admin.config.note.title.heading.label`
  - `admin.config.note.table.header.enabled.label`
  - `admin.config.note.table.header.maxDuration.label`
  - `admin.config.action.refresh.button.label`
  - `admin.config.link.overrideDocs.body.label`
  - `admin.config.error.fetchFailed.body.label`
- **Wireframe (ASCII):** vertical stack — title, STT card with table, divider,
  note-recording card with table, action row at bottom. Per D-API4 the
  "Effective env" block is GONE — the vertical balance reflects that
  (single-column tables on mobile; two-column lg breakpoint).
- **See visual:** real export name from `design/screens-admin.jsx`.
- **shadcn primitives:** `Card`, `Table`, `Skeleton`, `Alert`, `Button`, `Badge`, `Separator`, `Tooltip`.
- **Design-gap marker:** Add a NOTE block at the end of the section:
  ```
  > **Design gap (tracked):** Vertical balance after the removal of the
  > "Effective env" block (D-API4) — re-engage Claude Design for an updated
  > visual for this screen. Linter ignores this note; verifier picks it up.
  ```

## Format constraints (linter contract from Plan 03)

- Each screen section opens with `## <Code> — <Name>` (e.g., `## A2 — Observability hub`).
  Linter recognizes this regex for screen sections.
- Each required subsection appears as either `### <Label>` or as a paragraph
  led by `**<Label>.**` per the RESEARCH template.
- All endpoints inside backticks: `\`GET /api/stt-config\``.
- All copy keys inside backticks, in a table under the "Copy keys" subsection.
- Wireframes inside ```` ```text ```` fences.
- `See visual:` lines as plain paragraphs, no formatting beyond the URL fragment.

## Acceptance criteria

- `## A2 — Observability hub` and `## A3 — Config view` sections exist.
- Each has all 10 required subsections.
- Plan 01's header + API Reference (verified) + Assumptions resolved + WIP
  endpoints sections are preserved untouched.
- `pnpm lint:ui-spec` exits 0 (assuming Plan 05 also lands the end-user file
  cleanly — coordinate with that plan; lint failures must be in this file
  only).
- All copy keys are 5-level dotted, lowercase, English. Russian deferred.
- No new API endpoint referenced anywhere in this file (only GET /api/stt-config
  and GET /api/note-recording-config — both verified in Plan 01).
- A3 carries the D-API4 design-gap NOTE.
- Biome-style markdown (LF endings, no trailing whitespace).
- English only. No emojis.

## Out of scope

- The shared appendix (design tokens, breakpoint matrix, i18n key index, full
  API endpoint index) — Plan 06 writes it.
- The end-user file — Plan 05.
- The linter implementation — already done in Plan 03.
- Re-engaging Claude Design for the A3 visual gap — Phase 7.x backlog;
  Plan 04 only records the gap marker.
</task>

<tests>
- `pnpm lint:ui-spec` exits 0 (in concert with Plan 05's output).
- `grep -c "^## A[23] " UI-SPEC-admin.md` returns ≥ 2.
- `grep -cE "^### (Purpose|Roles|Route|Data|Actions|States|User journey|Copy keys|Wireframe|shadcn primitives)\$" UI-SPEC-admin.md` returns ≥ 20 (10 subsections × 2 screens).
- `grep -c "See visual: design/screens-admin.jsx#" UI-SPEC-admin.md` returns ≥ 2.
- `grep -c "^| \`admin\." UI-SPEC-admin.md` returns ≥ 16 (rough lower bound on copy-key rows).
- `grep "Design gap (tracked)" UI-SPEC-admin.md` returns the A3 marker line.
</tests>

<commit_message>
docs(07): author UI-SPEC-admin.md — A2 Observability + A3 Config

Authors the two admin screen sections per 07-SPEC.md (revised by D-API4
and D-API5 to remove A1 Audit and the "Effective env" block from A3).
Each screen follows the 10-subsection template (Purpose / Roles / Route /
Data / Actions / States / User journey / Copy keys / Wireframe / shadcn
primitives) and carries a See-visual reference to the corresponding JSX
function in design/screens-admin.jsx.

Encodes the A3 design-gap marker (D-API4 vertical-balance follow-up for
Claude Design re-engagement).

`pnpm lint:ui-spec` GREEN in concert with Plan 05's end-user file.
No new API endpoints introduced (D-S1).

Refs: UI-SPEC-01, UI-SPEC-03
</commit_message>
