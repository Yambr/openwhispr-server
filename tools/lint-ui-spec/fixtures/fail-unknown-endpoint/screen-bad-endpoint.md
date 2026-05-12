# UI-SPEC fixture: unknown-endpoint failure

## U99 — Imaginary screen

See visual: design/screens-user.jsx#ScreenUsage

**Purpose.** Reference an endpoint that does not exist.

**Roles.** End user.

**Route.** `/account/imaginary`.

**Data.** `GET /api/this-endpoint-does-not-exist` — not implemented anywhere.

**Actions.** None.

**States.** Loading, success, empty, error.

**User journey.** Should never resolve.

**Copy keys.**

| Key                                  | Description |
| ------------------------------------ | ----------- |
| `end-user.imaginary.body.title.text` | Title       |

**Wireframe.**

```text
+----------+
| Nothing  |
+----------+
```

**shadcn primitives.** Card.
