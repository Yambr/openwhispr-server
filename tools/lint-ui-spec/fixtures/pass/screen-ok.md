# UI-SPEC fixture: passing screen

## U4 — Usage dashboard

See visual: design/screens-user.jsx#ScreenUsage

**Purpose.** Render the signed-in user's aggregate usage KPIs and per-day
charts so they can self-serve answers to "how much did I use this month".

**Roles.** Authenticated end user (web session cookie). Admin can also view
their own usage via the same screen.

**Route.** `/account/usage` (Next.js App Router segment).

**Data.** Read from `GET /api/usage` (registered via app.route in
apps/api/src/routes/usage.ts) plus `POST /api/notes/search` for the
linked recent-notes panel (registered via app.route in
apps/api/src/routes/notes/search.ts). Sign-out uses
`POST /api/auth/sign-out` (Better Auth catch-all). The desktop OAuth
return path uses `GET /api/desktop-signin/:provider` (registered via
`app.get` shorthand in apps/api/src/routes/desktop-signin.ts).

**Actions.** None — read-only screen. Sign-out button posts to Better Auth.

**States.** Loading (skeleton cards), success (KPIs + charts), empty
(no usage yet), error (toast + retry).

**User journey.** Signed-in user clicks Account → Usage in the nav. They
see four KPI cards and two charts. They can sign out from the top bar.

**Copy keys.**

| Key                                         | Description                  |
| ------------------------------------------- | ---------------------------- |
| `end-user.usage.kpi.requests.label`         | "Requests this month" label  |
| `end-user.usage.kpi.minutes.label`          | "Audio minutes" label        |

**Wireframe.**

```text
+----------------------------------------+
| Nav | Usage                            |
|     |                                  |
|     | [KPI] [KPI] [KPI] [KPI]          |
|     |                                  |
|     | Requests/day chart               |
|     | Audio minutes/day chart          |
+----------------------------------------+
```

**shadcn primitives.** Card, Skeleton, Tabs, Button, Badge.
