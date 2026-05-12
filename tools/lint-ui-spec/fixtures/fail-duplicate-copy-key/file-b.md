# UI-SPEC fixture: duplicate copy-key file B

## A3 — Config view

See visual: design/screens-admin.jsx#ScreenUsage

**Purpose.** Show STT and note-recording config tables.

**Roles.** Admin.

**Route.** `/admin/config`.

**Data.** `GET /api/stt-config` and `GET /api/note-recording-config`
(app.route registrations).

**Actions.** None (read-only).

**States.** Loading, success, empty, error.

**User journey.** Admin opens Admin → Config.

**Copy keys.**

| Key                                | Description                           |
| ---------------------------------- | ------------------------------------- |
| `admin.shared.example.label.text`  | Re-declared — uniqueness violation    |

**Wireframe.**

```text
+-------------------+
| Admin | Config    |
| Nav   | Tables    |
+-------------------+
```

**shadcn primitives.** Table, Card.
