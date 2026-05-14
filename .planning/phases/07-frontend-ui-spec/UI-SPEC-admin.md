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

<!-- Shared appendix (design tokens, breakpoint matrix, i18n key index, full API endpoint index) is appended by Plan 06. -->

## A2 — Observability hub

### Purpose

Operator-facing hub of deep-links into the self-hosted Grafana / Tempo / Mimir /
Loki dashboards landed in Phase 6 Plan 11. The screen is a static card grid of
external links — it does NOT call any endpoint on this OpenWhispr Server
installation. All metrics, logs, and traces live in the operator's own LGTM
stack; this screen is a navigation surface only.

### Roles

Operator-only surface. Per Plan 01 § Assumptions A4 (REFUTED) and the WIP
endpoints note: Better Auth's session has no `role` field and there is no
`tenant_members` table. Admin surface is gated at deployment level (Traefik
basic-auth or operator-only network). No application-level role check in v1 —
first registered user = operator by convention. The Next.js layout does NOT
issue a 403 based on session content.

### Route

`/admin/observability` (Next.js App Router segment under
`app/(admin)/admin/observability/page.tsx`). Sidebar entry in the admin shell
labelled by copy key `admin.observability.nav.sidebar.label`.

### Data

No API calls against this server. The card grid is rendered from a static list
defined client-side; each card's `href` is composed from a public environment
variable read at build time.

| Field             | Source                            | Notes                                       |
|-------------------|-----------------------------------|---------------------------------------------|
| `grafanaBaseUrl`  | `process.env.NEXT_PUBLIC_GRAFANA_BASE_URL` (client-side env) | Required; if unset, screen renders error state |
| `tempoBaseUrl`    | `process.env.NEXT_PUBLIC_TEMPO_BASE_URL` (client-side env)   | Optional; falls back to Grafana link        |
| `mimirBaseUrl`    | `process.env.NEXT_PUBLIC_MIMIR_BASE_URL` (client-side env)   | Optional; falls back to Grafana link        |
| `lokiBaseUrl`     | `process.env.NEXT_PUBLIC_LOKI_BASE_URL` (client-side env)    | Optional; falls back to Grafana link        |

No TanStack Query keys — the screen has no async fetch.

### Actions

- Click a dashboard card → opens the target Grafana dashboard in a new tab
  (`target="_blank" rel="noopener noreferrer"`).
- Click "Open Grafana" in the page header → opens Grafana root in a new tab.
- Click a Quick-links row → opens the corresponding LGTM component root in a
  new tab.

There are no destructive actions and no mutations.

### States

| State    | Trigger                                   | UI                                                                 |
|----------|-------------------------------------------|--------------------------------------------------------------------|
| success  | `NEXT_PUBLIC_GRAFANA_BASE_URL` is set     | Card grid (six dashboard cards) + Quick-links card                 |
| error    | `NEXT_PUBLIC_GRAFANA_BASE_URL` unset      | `Alert` with operator instructions (set env var, redeploy)         |
| loading  | N/A                                       | Not applicable — no async fetch                                    |
| empty    | N/A                                       | Not applicable — card list is static                               |

### User journey

1. Operator clicks "Observability" in the admin sidebar.
2. Layout renders without any role check (deployment-level gating is upstream).
3. Card grid appears immediately (no network round-trip on this server).
4. Operator clicks "API tier — request latency" card → Grafana dashboard opens
   in a new tab against the operator's own LGTM stack.
5. If `NEXT_PUBLIC_GRAFANA_BASE_URL` is unset, operator sees an Alert with
   instructions to set the env var and redeploy.

### Copy keys

| Key                                                       | English value                                                    |
|-----------------------------------------------------------|------------------------------------------------------------------|
| `admin.observability.nav.sidebar.label`                   | Observability                                                    |
| `admin.observability.title.heading.text`                  | Observability                                                    |
| `admin.observability.subtitle.body.text`                  | Deep-links to Grafana dashboards for this installation.          |
| `admin.observability.action.open-grafana.label`           | Open Grafana                                                     |
| `admin.observability.card-api-latency.title.label`        | API tier — request latency                                       |
| `admin.observability.card-api-latency.body.label`         | p50, p95, p99 from Fastify hooks                                 |
| `admin.observability.card-worker-queue.title.label`       | Worker — STT job queue                                           |
| `admin.observability.card-worker-queue.body.label`        | BullMQ depth, retries, throughput                                |
| `admin.observability.card-postgres.title.label`           | Postgres — partitions and vacuum                                 |
| `admin.observability.card-litellm.title.label`            | LiteLLM — provider routing                                       |
| `admin.observability.card-security.title.label`           | Security — rate limits and auth failures                         |
| `admin.observability.card-system.title.label`             | System — CPU, RAM, disk, network                                 |
| `admin.observability.quicklinks.title.label`              | Quick links                                                      |
| `admin.observability.quicklinks.loki.label`               | Loki — application logs                                          |
| `admin.observability.quicklinks.mimir.label`              | Mimir — Prometheus metrics                                       |
| `admin.observability.quicklinks.tempo.label`              | Tempo — distributed tracing                                      |
| `admin.observability.quicklinks.alertmanager.label`       | Alertmanager — routing and silences                              |
| `admin.observability.error-env-missing.title.label`       | Grafana endpoint not configured                                  |
| `admin.observability.error-env-missing.body.label`        | Set NEXT_PUBLIC_GRAFANA_BASE_URL and redeploy the web container. |

### Wireframe

```text
+--------------------------------------------------------------+
| Sidebar     | Observability                  [Open Grafana]  |
| - Dashboard | Deep-links to Grafana dashboards.              |
| - Observ.   |                                                |
| - Config    | +----------------+  +----------------+         |
|             | | API latency    |  | Worker queue   |         |
|             | | p95 124 ms     |  | 3 in flight    |         |
|             | +----------------+  +----------------+         |
|             | +----------------+  +----------------+         |
|             | | PG partitions  |  | LiteLLM route  |         |
|             | | 99.4% pruned   |  | 11 req/min     |         |
|             | +----------------+  +----------------+         |
|             | +----------------+  +----------------+         |
|             | | Security       |  | System         |         |
|             | | 7 blocked 24h  |  | CPU 38%        |         |
|             | +----------------+  +----------------+         |
|             |                                                |
|             | Quick links                                    |
|             | - Loki                                         |
|             | - Mimir                                        |
|             | - Tempo                                        |
|             | - Alertmanager                                 |
+--------------------------------------------------------------+
```

Desktop ≥1024px: two-column card grid. Tablet 640–1024: two-column preserved.
Mobile <640: single-column card stack; Quick-links collapses to a vertical list.

See visual: design/screens-admin.jsx#ScreenObservability

### shadcn primitives

`Card`, `Button`, `Alert`, `Badge`, `Separator`

<!-- DESIGN-GAP D-API4: A3 layout rebalancing after "Effective env" block removal. Re-engage Claude Design. -->

## A3 — Config view

### Purpose

Operator-facing read-only view of the STT pipeline configuration and note
recording defaults. Surfaces the server's effective behaviour for the two
config endpoints that already exist in `apps/api/src/routes/`. Per **D-API4**,
the "Effective env" block from Claude Design's original mockup is REMOVED in
v1 — exposing env-var names (even redacted) is a security hot zone with no
backing endpoint, and no `/api/admin/env` route exists. Operator
documentation explains how to override via env vars; the values themselves are
not surfaced in-app.

### Roles

Operator-only surface. Same gating as A2: Better Auth session has no `role`
field (Plan 01 § A4 REFUTED), so admin surface is gated at deployment level
(Traefik basic-auth or operator-only network). No application-level role
check in v1.

### Route

`/admin/config` (Next.js App Router segment under
`app/(admin)/admin/config/page.tsx`). Sidebar entry in the admin shell
labelled by copy key `admin.config.nav.sidebar.label`.

### Data

Two parallel fetches against existing endpoints (verified in Plan 01's
`## API Reference (verified)` table). No new endpoints introduced — honors
D-S1 ("Толкаемся от спеки бэка").

| Endpoint                          | TanStack Query key                  | Response key                | UI mapping                                          |
|-----------------------------------|-------------------------------------|-----------------------------|-----------------------------------------------------|
| `GET /api/stt-config`             | `queryKeys.sttConfig()`             | `defaultModel`              | STT table row: "Default model"                      |
| `GET /api/stt-config`             | `queryKeys.sttConfig()`             | `defaultLanguage`           | STT table row: "Default language"                   |
| `GET /api/stt-config`             | `queryKeys.sttConfig()`             | `availableProviders`        | STT table row: "Available providers" (joined list)  |
| `GET /api/note-recording-config`  | `queryKeys.noteRecordingConfig()`   | `maxDurationSeconds`        | Note table row: "Max duration (s)"                  |
| `GET /api/note-recording-config`  | `queryKeys.noteRecordingConfig()`   | `sampleRateHz`              | Note table row: "Sample rate (Hz)"                  |
| `GET /api/note-recording-config`  | `queryKeys.noteRecordingConfig()`   | `allowedFormats`            | Note table row: "Allowed formats" (joined list)     |
| `GET /api/note-recording-config`  | `queryKeys.noteRecordingConfig()`   | `diarizationEnabled`        | Note table row: "Diarization enabled" (Badge bool)  |

Both queries fire on mount in parallel. Refresh action invalidates both keys.

### Actions

- **Refresh** button (icon: refresh) → invalidates `queryKeys.sttConfig()` and
  `queryKeys.noteRecordingConfig()`; both tables re-fetch.
- **Docs: how to override** link → opens `docs/litellm-target-spec.md` (the
  canonical corporate override example) in a new tab.
- No destructive actions. No mutations. Read-only by design.

### States

| State    | Trigger                                       | UI                                                                              |
|----------|-----------------------------------------------|---------------------------------------------------------------------------------|
| loading  | Either query is `isPending` on first mount    | Two `Skeleton` tables side-by-side (lg) or stacked (mobile)                     |
| success  | Both queries resolved with 2xx                | Two `Card` blocks, each containing a `Table` of key/value rows                  |
| error    | Either query rejected (4xx/5xx/network)       | `Alert` (destructive variant) with Retry button; partial-success degrades gracefully |
| empty    | N/A                                           | Not applicable — config endpoints always return at least default values         |

Known design gap (D-API4): the original Claude Design mockup placed an
"Effective env" card below the two config tables to balance vertical space.
With that block removed in v1, the page is shorter than the design intended.
The mobile/desktop layouts in this SPEC reflect the post-removal balance
(two cards side-by-side on lg; stacked on mobile), but a Claude Design
re-engagement is required to ratify the desktop empty-space treatment. See
the HTML comment marker at the top of this section for the tracked gap.

### User journey

1. Operator clicks "Config" in the admin sidebar.
2. Layout renders without any role check (deployment-level gating upstream).
3. Two `Skeleton` tables flash for a moment while both queries fire in parallel.
4. STT table populates with provider list, default model, default language.
5. Note recording table populates with max duration, sample rate, allowed
   formats, diarization flag.
6. Operator reads values, optionally clicks "Refresh" to re-fetch.
7. Operator clicks "Docs: how to override" → `docs/litellm-target-spec.md`
   opens in a new tab.
8. If either query fails, operator sees an `Alert` with a Retry button.

### Copy keys

| Key                                                  | English value                                                |
|------------------------------------------------------|--------------------------------------------------------------|
| `admin.config.nav.sidebar.label`                     | Configuration                                                |
| `admin.config.title.heading.text`                    | Configuration                                                |
| `admin.config.subtitle.body.text`                    | Server-side STT and note-recording defaults. Read-only.      |
| `admin.config.alert-readonly.body.label`             | Edits require restarting the api container with updated env. |
| `admin.config.stt.title.label`                       | STT config                                                   |
| `admin.config.stt.endpoint.label`                    | GET /api/stt-config                                          |
| `admin.config.stt.row-default-model.label`           | Default model                                                |
| `admin.config.stt.row-default-language.label`        | Default language                                             |
| `admin.config.stt.row-providers.label`               | Available providers                                          |
| `admin.config.note.title.label`                      | Note recording                                               |
| `admin.config.note.endpoint.label`                   | GET /api/note-recording-config                               |
| `admin.config.note.row-max-duration.label`           | Max duration (seconds)                                       |
| `admin.config.note.row-sample-rate.label`            | Sample rate (Hz)                                             |
| `admin.config.note.row-allowed-formats.label`        | Allowed formats                                              |
| `admin.config.note.row-diarization.label`            | Diarization enabled                                          |
| `admin.config.action.refresh.label`                  | Refresh                                                      |
| `admin.config.link.override-docs.label`              | Docs: how to override                                        |
| `admin.config.error-fetch-failed.title.label`        | Could not load configuration                                 |
| `admin.config.error-fetch-failed.body.label`         | Retry, or check the api container logs in Grafana.           |
| `admin.config.error-fetch-failed.retry.label`        | Retry                                                        |

### Wireframe

```text
+--------------------------------------------------------------+
| Sidebar     | Configuration              [Docs] [Refresh]    |
| - Dashboard | Server-side STT and note-recording defaults.   |
| - Observ.   |                                                |
| - Config    | [Alert: read-only]                             |
|             |                                                |
|             | +----------------+  +----------------+         |
|             | | STT config     |  | Note recording |         |
|             | | GET /api/...   |  | GET /api/...   |         |
|             | |----------------|  |----------------|         |
|             | | default model  |  | max duration   |         |
|             | | default lang   |  | sample rate    |         |
|             | | providers      |  | formats        |         |
|             | |                |  | diarization    |         |
|             | +----------------+  +----------------+         |
+--------------------------------------------------------------+
```

Desktop ≥1024px: two cards side-by-side. Tablet 640–1024: two cards
side-by-side preserved. Mobile <640: single-column stacked tables.

See visual: design/screens-admin.jsx#ScreenConfig

### shadcn primitives

`Card`, `Table`, `Skeleton`, `Alert`, `Button`, `Badge`, `Separator`, `Tooltip`

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

# Appendix

> The five sub-appendices below are duplicated verbatim in both UI-SPEC files
> (D-ART6) so each artifact is self-contained for downstream readers.
> Source of truth for design tokens is `design/index.html` (CSS custom
> properties in `<style id="__tokens">`) consumed by `design/ui.jsx`.

## Appendix A — Design tokens

Tailwind 4 places these under the `@theme` directive in `app/globals.css`,
NOT in `tailwind.config.js` (RESEARCH § Pitfall 4). The values below are
transcribed verbatim from `design/index.html` and `design/ui.jsx`.

### Color roles (light theme)

| Role | Value | Notes |
|------|-------|-------|
| `--accent` | `#2563eb` | Primary action; brand blue |
| `--accent-soft` | `color-mix(in oklab, var(--accent) 14%, transparent)` | Focus rings, soft highlights |
| `--accent-fg` | `#ffffff` | Foreground on accent surfaces |
| `--bg` | `#fafafa` | App background |
| `--panel` | `#ffffff` | Card / panel surface |
| `--panel-2` | `#f4f4f5` | Subtle inset / hover surface |
| `--border` | `#e4e4e7` | Default border |
| `--border-strong` | `#d4d4d8` | Input borders, separators |
| `--text` | `#18181b` | Primary foreground |
| `--text-muted` | `#71717a` | Secondary foreground |
| `--text-dim` | `#a1a1aa` | Tertiary / disabled foreground |
| `--danger` | `#dc2626` | Destructive action |
| `--warn` | `#d97706` | Warning state |
| `--ok` | `#059669` | Success state |
| `--info` | `#0284c7` | Informational state |

### Color roles (dark theme — overrides applied by `[data-theme="dark"]`)

| Role | Value |
|------|-------|
| `--bg` | `#09090b` |
| `--panel` | `#111114` |
| `--panel-2` | `#18181b` |
| `--border` | `#26262a` |
| `--border-strong` | `#3f3f46` |
| `--text` | `#fafafa` |
| `--text-muted` | `#a1a1aa` |
| `--text-dim` | `#71717a` |

(`--accent`, `--danger`, `--warn`, `--ok`, `--info` are theme-invariant.)

### Spacing & sizing

| Token | Value | Notes |
|-------|-------|-------|
| `--row-h` (compact) | `32px` | Table row height under `[data-density="compact"]` |
| `--row-h` (default) | `40px` | Default density |
| `--row-h` (comfortable) | `44px` | Under `[data-density="comfortable"]` |
| `--pad` | `14px` | Default cell / container inset |
| `--radius` | `8px` | Default corner radius (cards, buttons, inputs) |

Card radius is `10px`, button radius is `7px`, input radius is `7px`,
dialog radius is `12px` — derived per primitive from `design/index.html`.

### Typography ramp

| Token | Value |
|-------|-------|
| `--font-ui` | `'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif` |
| `--font-mono` | `'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace` |
| Body size | `14px` / line-height `1.45` |
| Page title (`page-head h1`) | `22px` / weight `600` / letter-spacing `-.02em` |
| Card title (`card-h h3`) | `13.5px` / weight `600` |
| Auth headline (`auth-form h2`) | `24px` / weight `600` / letter-spacing `-.02em` |
| Side-panel headline | `28px` / weight `600` / letter-spacing `-.025em` / line-height `1.15` |
| Stat value (`stat .v`) | `26px` / weight `600` / tabular-nums |
| Stat key (`stat .k`) | `11px` / weight `600` / uppercase / letter-spacing `.04em` |
| Label (`label`) | `12.5px` / weight `500` |
| Help / muted (`help`) | `12px` |
| Mono badges (`badge`) | `11px` / mono |

Weight scale used: `400`, `500`, `600`, `700` (Inter); `400`, `500`, `600`
(JetBrains Mono).

### Motion

| Token | Value | Notes |
|-------|-------|-------|
| Progress bar width | `transition: width .3s` | `.progress .bar` |
| Skeleton shimmer | `animation: sk 1.4s ease-in-out infinite` | `.sk` keyframes `0%→200% 0`, `100%→-200% 0` |

No additional motion primitives are declared in `design/index.html`; component-
level transitions (hover, focus) inherit the browser default.

## Appendix B — Breakpoint matrix

| Name | Min width | Tailwind alias | Pattern |
|------|-----------|----------------|---------|
| mobile | 0 | (default, mobile-first) | single column; sidebar collapsed to drawer (Sheet) |
| tablet | 640px | `sm:` | two-column where applicable; sidebar slide-over |
| desktop | 1024px | `lg:` | full layout; sidebar persistent (≥240px) |

Tailwind 4 default breakpoints. Per 07-RESEARCH § Pattern 1 and 07-SPEC.md
constraints. Wide-only optimizations (≥1280px) follow Tailwind's `xl:` alias.

## Appendix C — i18n key index

Every copy key declared in this UI-SPEC suite, alphabetized. The linter
(`pnpm lint:ui-spec`) validates the 5-level dotted schema and global
uniqueness across both files; this index is the human audit trail. Russian
translation is deferred to Phase 10.

| Key | English |
|-----|---------|
| `admin.config.action.refresh.label` | Refresh |
| `admin.config.alert-readonly.body.label` | Edits require restarting the api container with updated env. |
| `admin.config.error-fetch-failed.body.label` | Retry, or check the api container logs in Grafana. |
| `admin.config.error-fetch-failed.retry.label` | Retry |
| `admin.config.error-fetch-failed.title.label` | Could not load configuration |
| `admin.config.link.override-docs.label` | Docs: how to override |
| `admin.config.nav.sidebar.label` | Configuration |
| `admin.config.note.endpoint.label` | GET /api/note-recording-config |
| `admin.config.note.row-allowed-formats.label` | Allowed formats |
| `admin.config.note.row-diarization.label` | Diarization enabled |
| `admin.config.note.row-max-duration.label` | Max duration (seconds) |
| `admin.config.note.row-sample-rate.label` | Sample rate (Hz) |
| `admin.config.note.title.label` | Note recording |
| `admin.config.stt.endpoint.label` | GET /api/stt-config |
| `admin.config.stt.row-default-language.label` | Default language |
| `admin.config.stt.row-default-model.label` | Default model |
| `admin.config.stt.row-providers.label` | Available providers |
| `admin.config.stt.title.label` | STT config |
| `admin.config.subtitle.body.text` | Server-side STT and note-recording defaults. Read-only. |
| `admin.config.title.heading.text` | Configuration |
| `admin.index.card-note.endpoint.text` | GET /api/note-recording-config |
| `admin.index.card-note.title.text` | Note recording |
| `admin.index.card-stt.endpoint.text` | GET /api/stt-config |
| `admin.index.card-stt.title.text` | Speech-to-text |
| `admin.index.lede.body.text` | Server-side configuration for speech-to-text and note recording. Set via env vars; admin can view but not edit in v1. |
| `admin.index.readonly.body.text` | Edits require restarting the api container with updated env. See config.md. |
| `admin.index.readonly.title.text` | Read-only |
| `admin.index.title.heading.text` | Configuration |
| `admin.observability.action.open-grafana.label` | Open Grafana |
| `admin.observability.card-api-latency.body.label` | p50, p95, p99 from Fastify hooks |
| `admin.observability.card-api-latency.title.label` | API tier — request latency |
| `admin.observability.card-litellm.title.label` | LiteLLM — provider routing |
| `admin.observability.card-postgres.title.label` | Postgres — partitions and vacuum |
| `admin.observability.card-security.title.label` | Security — rate limits and auth failures |
| `admin.observability.card-system.title.label` | System — CPU, RAM, disk, network |
| `admin.observability.card-worker-queue.body.label` | BullMQ depth, retries, throughput |
| `admin.observability.card-worker-queue.title.label` | Worker — STT job queue |
| `admin.observability.error-env-missing.body.label` | Set NEXT_PUBLIC_GRAFANA_BASE_URL and redeploy the web container. |
| `admin.observability.error-env-missing.title.label` | Grafana endpoint not configured |
| `admin.observability.nav.sidebar.label` | Observability |
| `admin.observability.quicklinks.alertmanager.label` | Alertmanager — routing and silences |
| `admin.observability.quicklinks.loki.label` | Loki — application logs |
| `admin.observability.quicklinks.mimir.label` | Mimir — Prometheus metrics |
| `admin.observability.quicklinks.tempo.label` | Tempo — distributed tracing |
| `admin.observability.quicklinks.title.label` | Quick links |
| `admin.observability.subtitle.body.text` | Deep-links to Grafana dashboards for this installation. |
| `admin.observability.title.heading.text` | Observability |
| `end-user.account.danger.delete.label` | Delete account |
| `end-user.account.danger.dialog-body.text` | This deletes your transcriptions, notes, conversations, and sessions. Type your email to confirm. |
| `end-user.account.danger.dialog-confirm.label` | Delete account |
| `end-user.account.danger.dialog-input.label` | Type your email to confirm |
| `end-user.account.danger.dialog-title.text` | Delete your OpenWhispr account |
| `end-user.account.danger.title.label` | Danger zone |
| `end-user.account.error.retry.label` | Retry |
| `end-user.account.error.title.text` | Could not load account |
| `end-user.account.nav.sidebar.label` | Account |
| `end-user.account.profile.created.label` | Member since |
| `end-user.account.profile.email.label` | Email |
| `end-user.account.profile.name.label` | Name |
| `end-user.account.profile.title.label` | Profile |
| `end-user.account.profile.verified.label` | Verified |
| `end-user.account.sessions.action-revoke-others.label` | Revoke all other sessions |
| `end-user.account.sessions.action-revoke.label` | Revoke |
| `end-user.account.sessions.col-created.label` | Started |
| `end-user.account.sessions.col-device.label` | Device |
| `end-user.account.sessions.col-expires.label` | Expires |
| `end-user.account.sessions.col-ip.label` | IP address |
| `end-user.account.sessions.title.label` | Active sessions |
| `end-user.account.subtitle.body.text` | Manage your profile, active sessions, and account deletion. |
| `end-user.account.title.heading.text` | Account |
| `end-user.conv-detail.action.back.label` | Back to conversations |
| `end-user.conv-detail.action.copy.label` | Copy transcript |
| `end-user.conv-detail.action.delete.label` | Delete conversation |
| `end-user.conv-detail.action.export-json.label` | Export as JSON |
| `end-user.conv-detail.action.loadearlier.label` | Load earlier messages |
| `end-user.conv-detail.empty.body.text` | This conversation does not contain any messages yet. |
| `end-user.conv-detail.empty.title.text` | No messages |
| `end-user.conv-detail.error.retry.label` | Retry |
| `end-user.conv-detail.error.title.text` | Could not load conversation |
| `end-user.conv-detail.role.assistant.label` | Assistant |
| `end-user.conv-detail.role.system.label` | System |
| `end-user.conv-detail.role.tool.label` | Tool |
| `end-user.conv-detail.role.user.label` | You |
| `end-user.conv-detail.title.heading.text` | Conversation |
| `end-user.conv-list.action.loadmore.label` | Load more |
| `end-user.conv-list.action.search.label` | Search conversations |
| `end-user.conv-list.empty.body.text` | Start a chat in the desktop client to see it here. |
| `end-user.conv-list.empty.title.text` | No conversations yet |
| `end-user.conv-list.error.retry.label` | Retry |
| `end-user.conv-list.error.title.text` | Could not load conversations |
| `end-user.conv-list.nav.sidebar.label` | Conversations |
| `end-user.conv-list.row.action-delete.label` | Delete |
| `end-user.conv-list.subtitle.body.text` | LLM chats started from the desktop client. |
| `end-user.conv-list.table.col-created.label` | Created |
| `end-user.conv-list.table.col-title.label` | Title |
| `end-user.conv-list.table.col-updated.label` | Updated |
| `end-user.conv-list.title.heading.text` | Conversations |
| `end-user.conv-search.action.clear.label` | Clear |
| `end-user.conv-search.action.submit.label` | Search |
| `end-user.conv-search.empty.none.text` | No conversations match this query. |
| `end-user.conv-search.empty.type.text` | Type a query to search your conversations. |
| `end-user.conv-search.error.retry.label` | Retry |
| `end-user.conv-search.error.title.text` | Search failed |
| `end-user.conv-search.input.placeholder.text` | Search your conversations |
| `end-user.conv-search.result.score.label` | Score |
| `end-user.conv-search.title.heading.text` | Search conversations |
| `end-user.note-detail.action.back.label` | Back to notes |
| `end-user.note-detail.action.copy.label` | Copy |
| `end-user.note-detail.action.delete.label` | Delete |
| `end-user.note-detail.action.export-json.label` | Export as JSON |
| `end-user.note-detail.action.export-md.label` | Export as Markdown |
| `end-user.note-detail.empty.body.text` | This note does not exist or was deleted. |
| `end-user.note-detail.empty.title.text` | Note not found |
| `end-user.note-detail.error.retry.label` | Retry |
| `end-user.note-detail.error.title.text` | Could not load note |
| `end-user.note-detail.metadata.created.label` | Created |
| `end-user.note-detail.metadata.duration.label` | Audio duration |
| `end-user.note-detail.metadata.folder.label` | Folder |
| `end-user.note-detail.metadata.participants.label` | Participants |
| `end-user.note-detail.metadata.title.label` | Details |
| `end-user.note-detail.metadata.type.label` | Note type |
| `end-user.note-detail.tabs.content.label` | Content |
| `end-user.note-detail.tabs.enhanced.label` | Enhanced |
| `end-user.note-detail.tabs.transcript.label` | Transcript |
| `end-user.note-detail.title.heading.text` | Note |
| `end-user.notes-list.action.loadmore.label` | Load more |
| `end-user.notes-list.action.search.label` | Search notes |
| `end-user.notes-list.empty.body.text` | Record a note in the desktop client to see it here. |
| `end-user.notes-list.empty.title.text` | No notes yet |
| `end-user.notes-list.error.retry.label` | Retry |
| `end-user.notes-list.error.title.text` | Could not load notes |
| `end-user.notes-list.folders.readonly-body.text` | Folder management is in the desktop client. |
| `end-user.notes-list.folders.title.label` | Folders |
| `end-user.notes-list.nav.sidebar.label` | Notes |
| `end-user.notes-list.row.action-delete.label` | Delete |
| `end-user.notes-list.subtitle.body.text` | Notes recorded with the desktop client. |
| `end-user.notes-list.table.col-created.label` | Created |
| `end-user.notes-list.table.col-folder.label` | Folder |
| `end-user.notes-list.table.col-title.label` | Title |
| `end-user.notes-list.table.col-words.label` | Words |
| `end-user.notes-list.title.heading.text` | Notes |
| `end-user.notes-search.action.clear.label` | Clear |
| `end-user.notes-search.action.submit.label` | Search |
| `end-user.notes-search.empty.none.text` | No notes match this query. |
| `end-user.notes-search.empty.type.text` | Type a query to search your notes. |
| `end-user.notes-search.error.retry.label` | Retry |
| `end-user.notes-search.error.title.text` | Search failed |
| `end-user.notes-search.input.placeholder.text` | Search your notes |
| `end-user.notes-search.result.score.label` | Score |
| `end-user.notes-search.title.heading.text` | Search notes |
| `end-user.signin.action.resendVerification.label` | Resend verification email |
| `end-user.signin.action.signup-link.label` | Don't have an account? Sign up |
| `end-user.signin.error.body.text` | Check your email and password, then try again. |
| `end-user.signin.error.title.text` | Sign-in failed |
| `end-user.signin.error-unverified.body.text` | We have not received confirmation for this email yet. Resend the verification link below. |
| `end-user.signin.error-unverified.sent.text` | Verification email sent. Check your inbox. |
| `end-user.signin.error-unverified.title.text` | Verify your email to sign in |
| `end-user.signin.form.email.label` | Email |
| `end-user.signin.form.password.label` | Password |
| `end-user.signin.form.submit.label` | Sign in |
| `end-user.signin.oidc.github.label` | Continue with GitHub |
| `end-user.signin.oidc.google.label` | Continue with Google |
| `end-user.signin.oidc.sso.label` | Continue with SSO |
| `end-user.signin.subtitle.body.text` | Use your email or your organization SSO. |
| `end-user.signin.title.heading.text` | Sign in to OpenWhispr |
| `end-user.signup.action.signin-link.label` | Already have an account? Sign in |
| `end-user.signup.error-duplicate.title.text` | Email already registered |
| `end-user.signup.error-duplicate.body.text` | This email is already registered. Sign in instead. |
| `end-user.signup.error-generic.title.text` | Sign-up failed |
| `end-user.signup.error-generic.body.text` | Sign-up failed. Please review the form and try again. |
| `end-user.signup.form.email.label` | Email |
| `end-user.signup.form.name.label` | Name |
| `end-user.signup.form.password.label` | Password |
| `end-user.signup.form.submit.label` | Sign up |
| `end-user.signup.oidc.github.label` | Continue with GitHub |
| `end-user.signup.oidc.google.label` | Continue with Google |
| `end-user.signup.oidc.sso.label` | Continue with SSO |
| `end-user.signup.subtitle.body.text` | A confirmation email is sent to verify your address. |
| `end-user.signup.success.body.text` | We sent a verification link to your address. Open it to continue. |
| `end-user.signup.success.title.text` | Check your email |
| `end-user.signup.title.heading.text` | Create your OpenWhispr account |
| `end-user.trx-detail.action.back.label` | Back to list |
| `end-user.trx-detail.action.copy.label` | Copy |
| `end-user.trx-detail.action.delete.label` | Delete |
| `end-user.trx-detail.action.export-json.label` | Export as JSON |
| `end-user.trx-detail.action.export-md.label` | Export as Markdown |
| `end-user.trx-detail.empty.body.text` | This transcription does not exist or was deleted. |
| `end-user.trx-detail.empty.title.text` | Transcription not found |
| `end-user.trx-detail.error.retry.label` | Retry |
| `end-user.trx-detail.error.title.text` | Could not load transcription |
| `end-user.trx-detail.metadata.created.label` | Created |
| `end-user.trx-detail.metadata.duration.label` | Audio duration |
| `end-user.trx-detail.metadata.language.label` | Language |
| `end-user.trx-detail.metadata.model.label` | Model |
| `end-user.trx-detail.metadata.provider.label` | Provider |
| `end-user.trx-detail.metadata.status.label` | Status |
| `end-user.trx-detail.metadata.title.label` | Details |
| `end-user.trx-detail.metadata.words.label` | Word count |
| `end-user.trx-detail.title.heading.text` | Transcription |
| `end-user.trx-list.action.loadmore.label` | Load more |
| `end-user.trx-list.empty.body.text` | Record audio in the desktop client and your transcriptions show up here. |
| `end-user.trx-list.empty.title.text` | No transcriptions yet |
| `end-user.trx-list.error.retry.label` | Retry |
| `end-user.trx-list.error.title.text` | Could not load transcriptions |
| `end-user.trx-list.nav.sidebar.label` | Transcriptions |
| `end-user.trx-list.row.action-delete.label` | Delete |
| `end-user.trx-list.subtitle.body.text` | All audio you have transcribed with the desktop client. |
| `end-user.trx-list.table.col-created.label` | Created |
| `end-user.trx-list.table.col-duration.label` | Duration |
| `end-user.trx-list.table.col-language.label` | Language |
| `end-user.trx-list.table.col-model.label` | Model |
| `end-user.trx-list.table.col-preview.label` | Preview |
| `end-user.trx-list.table.col-provider.label` | Provider |
| `end-user.trx-list.table.col-status.label` | Status |
| `end-user.trx-list.table.col-words.label` | Words |
| `end-user.trx-list.title.heading.text` | Transcriptions |
| `end-user.usage.action.refresh.label` | Refresh |
| `end-user.usage.error.body.text` | Retry, or check the api container logs in Grafana. |
| `end-user.usage.error.retry.label` | Retry |
| `end-user.usage.error.title.text` | Could not load usage |
| `end-user.usage.kpi-limit-reached.body.text` | Whether you are currently throttled. |
| `end-user.usage.kpi-limit-reached.title.label` | Limit reached |
| `end-user.usage.kpi-plan.body.text` | Active subscription plan. |
| `end-user.usage.kpi-plan.title.label` | Plan |
| `end-user.usage.kpi-words-remaining.body.text` | Quota left on your current plan. |
| `end-user.usage.kpi-words-remaining.title.label` | Words remaining |
| `end-user.usage.kpi-words-used.body.text` | Across all transcriptions and notes. |
| `end-user.usage.kpi-words-used.title.label` | Words used |
| `end-user.usage.nav.sidebar.label` | Dashboard |
| `end-user.usage.subtitle.body.text` | Your current consumption against the active plan. |
| `end-user.usage.title.heading.text` | Usage |
| `end-user.verify.error.body.text` | This verification link is invalid or has expired. Sign up again. |
| `end-user.verify.error.cta.label` | Back to sign up |
| `end-user.verify.error.title.text` | Verification failed |
| `end-user.verify.loading.body.text` | Verifying your email... |
| `end-user.verify.success.body.text` | Your email is confirmed. You can now sign in. |
| `end-user.verify.success.cta.label` | Sign in |
| `end-user.verify.success.title.text` | Email verified |
| `end-user.verify.title.heading.text` | Verify your email |

## Appendix D — API endpoint index

Every endpoint either UI-SPEC file references, with HTTP method, auth
requirement, source citation (route `file:line` or BETTER_AUTH_HANDLER for
the `app.all("/api/auth/*", ...)` catch-all mounted at
`apps/api/src/routes/better-auth-handler.ts:61`), and the screen(s) that
consume it. Cross-checked against Plan 01 § API Reference (verified).

| Method | Path | Auth | Source | Screens |
|--------|------|------|--------|---------|
| POST | `/api/auth/sign-in/email` | public | BETTER_AUTH_HANDLER | U1 |
| POST | `/api/auth/sign-up/email` | public | BETTER_AUTH_HANDLER | U2 |
| POST | `/api/auth/sign-out` | session | BETTER_AUTH_HANDLER | shared header logout (all `/app/**`) |
| POST | `/api/auth/verify-email` | public (token) | BETTER_AUTH_HANDLER | U3 |
| POST | `/api/auth/send-verification-email` | public | BETTER_AUTH_HANDLER | U3 |
| GET | `/api/auth/get-session` | session cookie | BETTER_AUTH_HANDLER | U5, layout guards |
| GET | `/api/auth/list-sessions` | session | BETTER_AUTH_HANDLER | U5 |
| POST | `/api/auth/revoke-session` | session | BETTER_AUTH_HANDLER | U5 |
| POST | `/api/auth/revoke-other-sessions` | session | BETTER_AUTH_HANDLER | U5 |
| DELETE | `/api/auth/delete-account` | session | BETTER_AUTH_HANDLER | U5 |
| GET | `/api/auth/sign-in/social/google` | public | BETTER_AUTH_HANDLER | U1, U2 |
| GET | `/api/auth/sign-in/social/github` | public | BETTER_AUTH_HANDLER | U1, U2 |
| GET | `/api/auth/sign-in/social/oidc` | public | BETTER_AUTH_HANDLER | U1, U2 |
| GET | `/api/usage` | session (dual-auth) | `apps/api/src/routes/usage.ts:40` | U4 |
| POST | `/api/streaming-usage` | session (dual-auth) | `apps/api/src/routes/streaming-usage.ts:58` | U4 (write-side; read uses GET above) |
| GET | `/api/stt-config` | session (dual-auth) | `apps/api/src/routes/stt-config.ts:45` | A3 |
| GET | `/api/note-recording-config` | session (dual-auth) | `apps/api/src/routes/note-recording-config.ts:34` | A3 |
| GET | `/api/transcriptions/list` | session | `apps/api/src/routes/transcriptions/list.ts:39` | U6, U7 |
| DELETE | `/api/transcriptions/delete` | session | `apps/api/src/routes/transcriptions/delete.ts:37` | U6, U7 |
| GET | `/api/notes/list` | session | `apps/api/src/routes/notes/list.ts:42` | U8, U9 |
| POST | `/api/notes/search` | session | `apps/api/src/routes/notes/search.ts:51` | U10 |
| DELETE | `/api/notes/delete` | session | `apps/api/src/routes/notes/delete.ts:34` | U8, U9 |
| GET | `/api/folders/list` | session | `apps/api/src/routes/folders/list.ts:43` | U8 |
| GET | `/api/conversations/list` | session | `apps/api/src/routes/conversations/list.ts:56` | U11 |
| GET | `/api/conversations/messages` | session | `apps/api/src/routes/conversations/messages.ts:80` | U12 |
| POST | `/api/conversations/search` | session | `apps/api/src/routes/conversations/search.ts:49` | U13 |
| DELETE | `/api/conversations/delete` | session | `apps/api/src/routes/conversations/delete.ts:35` | U11, U12 |

Zero new endpoints are introduced by Phase 7 (D-S1). The admin surface (A2)
calls no endpoints on this server — its links target the operator's external
Grafana / Tempo / Mimir / Loki dashboards.

## Appendix E — shadcn/ui v2 primitive inventory

Union of every primitive named in any screen's "shadcn primitives"
subsection across both UI-SPEC files. After `apps/web/` scaffolds (Phase 8),
run the block below once to prime the project. Primitive names follow
shadcn/ui v2 canonical kebab-case identifiers (RESEARCH § Standard Stack).

```bash
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add \
  alert \
  alert-dialog \
  badge \
  button \
  card \
  dropdown-menu \
  form \
  input \
  label \
  scroll-area \
  separator \
  sheet \
  skeleton \
  table \
  tabs \
  tooltip
```

Primitives in the union (alphabetized): `alert`, `alert-dialog`, `badge`,
`button`, `card`, `dropdown-menu`, `form`, `input`, `label`, `scroll-area`,
`separator`, `sheet`, `skeleton`, `table`, `tabs`, `tooltip`. `sonner`
(toast) is recommended by shadcn/ui v2 but is not declared as required by
any v1 screen; add at scaffold time if global toast notifications are
desired for Copy / Export confirmations.
