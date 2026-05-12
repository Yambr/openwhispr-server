# UI-SPEC fixture: missing-subsection failure

## U4 — Usage dashboard (no Purpose)

See visual: design/screens-user.jsx#ScreenUsage

**Roles.** Authenticated end user.

**Route.** `/account/usage`.

**Data.** `GET /api/usage` (registered via app.route in
apps/api/src/routes/usage.ts).

**Actions.** None — read-only.

**States.** Loading, success, empty, error.

**User journey.** User opens Account → Usage.

**Copy keys.**

| Key                                 | Description |
| ----------------------------------- | ----------- |
| `end-user.usage.kpi.requests.label` | KPI label   |

**Wireframe.**

```text
+----------------------+
| Nav | Usage          |
|     | [KPI] [KPI]    |
+----------------------+
```

**shadcn primitives.** Card, Skeleton.
