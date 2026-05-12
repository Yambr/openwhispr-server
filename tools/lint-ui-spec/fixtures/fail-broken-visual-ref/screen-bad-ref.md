# UI-SPEC fixture: broken See-visual reference

## U4 — Usage dashboard (bad ref)

See visual: design/screens-user.jsx#DoesNotExistComponent

**Purpose.** Same shape as the passing fixture but the See visual line
points to a function that does not exist in screens-user.jsx.

**Roles.** End user.

**Route.** `/account/usage`.

**Data.** `GET /api/usage` (app.route registration in usage.ts).

**Actions.** None — read-only.

**States.** Loading, success, empty, error.

**User journey.** Visits Account → Usage.

**Copy keys.**

| Key                                  | Description |
| ------------------------------------ | ----------- |
| `end-user.usage.broken.label.text`   | Label       |

**Wireframe.**

```text
+--------------+
| Nav | Usage  |
+--------------+
```

**shadcn primitives.** Card.
