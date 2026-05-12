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
backing endpoint, and there is no `GET /api/admin/env` route. Operator
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
