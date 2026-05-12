# UI-SPEC fixture: jagged-wireframe failure

## U4 — Usage dashboard (jagged)

See visual: design/screens-user.jsx#ScreenUsage

**Purpose.** Identical shape to the passing fixture but the wireframe block
contains lines of wildly unequal length and lacks the visual-only sentinel.

**Roles.** End user.

**Route.** `/account/usage`.

**Data.** `GET /api/usage` (app.route registration).

**Actions.** None.

**States.** Loading, success, empty, error.

**User journey.** Visits Account → Usage.

**Copy keys.**

| Key                                | Description |
| ---------------------------------- | ----------- |
| `end-user.usage.jagged.label.text` | Label       |

**Wireframe.**

```text
+--------------------------------------------------------+
| Nav | Usage dashboard with a very long top header line |
| short
| also short
+--------------------------------------------------------+
```

**shadcn primitives.** Card, Skeleton.
