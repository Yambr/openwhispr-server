# UI-SPEC fixture: visual-only sentinel screen

## U7 — Transcription detail

See visual: design/screens-user.jsx#ScreenTrxDetail

**Purpose.** Render a transcription's flat paragraphs plus metadata sidebar.
This fixture exercises the wireframe visual-only sentinel: ASCII rendering
is impractical for this dense layout, so the Wireframe block carries the
sentinel line and defers to the JSX reference instead.

**Roles.** End user (owner of the transcription).

**Route.** `/account/transcriptions/[id]`.

**Data.** `POST /api/notes/search` (app.route registration in
apps/api/src/routes/notes/search.ts) plus
`GET /api/desktop-signin/:provider` for the rebind affordance.

**Actions.** Delete (soft-delete), Copy text, Download original audio.

**States.** Loading, success, empty (deleted), error.

**User journey.** User picks a transcription from U6 list, lands here,
optionally deletes or copies.

**Copy keys.**

| Key                                       | Description       |
| ----------------------------------------- | ----------------- |
| `end-user.trx.detail.metadata.duration`   | Duration label    |

**Wireframe.**

```text
(visual-only — see See visual: line)
```

**shadcn primitives.** Card, Badge, Button, Dialog, Skeleton.
