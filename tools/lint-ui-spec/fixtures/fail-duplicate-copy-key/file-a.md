# UI-SPEC fixture: duplicate copy-key file A

## A2 — Observability hub

See visual: design/screens-admin.jsx#ScreenUsage

**Purpose.** Surface system observability KPIs to the admin.

**Roles.** Admin.

**Route.** `/admin/observability`.

**Data.** `GET /api/usage` (app.route registration).

**Actions.** None.

**States.** Loading, success, empty, error.

**User journey.** Admin opens Admin → Observability.

**Copy keys.**

| Key                                | Description           |
| ---------------------------------- | --------------------- |
| `admin.shared.example.label.text`  | Shared example label  |
| `bad_key`                          | Malformed schema      |

**Wireframe.**

```text
+-------------------+
| Admin | Obsrv     |
| Nav   | KPIs      |
+-------------------+
```

**shadcn primitives.** Card, Badge.
