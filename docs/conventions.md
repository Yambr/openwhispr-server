# OpenWhispr Server — Conventions

Phase 5-established conventions for future CRUD resource families. Any
new wire-surface resource family (after Phase 5: Notes, Folders,
Conversations, Messages, Transcriptions, API Keys, Settings) MUST
follow these patterns unless an explicit ADR records a deviation.

Authoritative cross-references: `.planning/phases/05-operational-endpoints/05-CONTEXT.md`
locks the underlying decisions (D-22..D-36); this document is the
contributor-facing summary, kept in lockstep.

---

## Soft-delete

Every CRUD resource table MUST carry:

```sql
deleted_at timestamptz NULL
```

Read paths MUST filter `WHERE deleted_at IS NULL` via the shared helper
at `apps/api/src/lib/soft-delete.ts`. Deletes are never destructive on
the table — the soft-delete helper updates `deleted_at = now()`.

Rationale: offline-first clients (Electron desktop, future mobile)
need conflict-free deletes that survive resync. Hard deletes leak
across the sync boundary as "phantom resurrected" rows. D-22.

---

## Client-id idempotency

Every resource accepts an optional `client_<resource>_id` (e.g.
`client_note_id`, `client_folder_id`, `client_conversation_id`,
`client_transcription_id`) for offline-first idempotent retry. Schema:

```sql
client_note_id text NULL
-- PARTIAL UNIQUE INDEX:
CREATE UNIQUE INDEX notes_client_id_unique
  ON notes (tenant_id, user_id, client_note_id)
  WHERE client_note_id IS NOT NULL;
```

`POST /api/<resource>/create` with a duplicate `client_<resource>_id`
returns the existing row at **HTTP 200** (NOT 409 Conflict). The
shared helper is `apps/api/src/lib/client-id-upsert.ts`.

Rationale: the client retries on network blip; retry MUST be safe.
409 forces the client to do its own dedup logic against a server
state it cannot trust. 200-with-existing is the contract. D-24.

---

## Keyset pagination

List endpoints MUST use keyset pagination on the `(created_at, id)`
tuple. Query parameters:

| Param    | Type           | Default | Max  | Notes                                             |
| -------- | -------------- | ------- | ---- | ------------------------------------------------- |
| `limit`  | int            | 50      | 200  | Hard server-side cap; reject `limit > 200` as 400 |
| `before` | ISO 8601 ts    | —       | —    | Returns rows with `created_at < before`           |
| `since`  | ISO 8601 ts    | —       | —    | Returns rows with `created_at > since`            |

Shared helper: `apps/api/src/lib/keyset-pagination.ts`. Never use
offset-based pagination (OFFSET grows linear in pages; breaks under
concurrent inserts; T-INSERT-RACE). D-23.

---

## Full-text search

Searchable columns ship a `tsvector GENERATED ALWAYS AS STORED` plus
a GIN index:

```sql
ALTER TABLE notes ADD COLUMN content_search tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(content, '')), 'B')
  ) STORED;
CREATE INDEX notes_content_search_gin ON notes USING GIN (content_search);
```

Query path MUST use `websearch_to_tsquery('simple', $1)` — NEVER
`to_tsquery` or `plainto_tsquery` (both crash on user input
containing `:` or unbalanced quotes; `websearch_to_tsquery` is the
ONLY safe-for-raw-input variant per Postgres docs).

The `'simple'` configuration is intentional — no en/ru stemming in v1
(Pitfall #9, accepted). Search matches morphological variants only on
exact form. Document this in the API surface; revisit at v2 when we
add per-tenant locale config.

---

## Batch operations

`POST /api/<resource>/batch-create` accepts up to **500 items** per
request; reject `items.length > 500` with `400 {"error":"batch size
exceeds 500"}`. Insert in a single transaction; on `client_<resource>_id`
conflict use `ON CONFLICT DO NOTHING RETURNING` so existing rows are
preserved (D-24 idempotency applies per-item).

Response shape:

```json
{ "created": [{ "client_<resource>_id": "...", "id": "..." }] }
```

---

## Error envelope

Every non-2xx response from a new Phase 5+ endpoint MUST emit:

```json
{ "error": "human-readable message" }
```

The structured `{error: {message, code?}}` shape (BACKEND_SPEC.md:745)
is permitted by the desktop client's `cloud-api-request` passthrough,
but Phase 5 does NOT introduce new structured-error sites. Keep the
simple `{error: string}` shape (D-34) unless explicit consultation
with the wire contract.

**Exception:** `/api/v1/keys/*` uses a `{data: T}` success envelope
(D-28) to match upstream `ApiKeysService.ts`. Error envelope is
unchanged. This is the ONLY Phase 5 endpoint family with a non-direct
success shape.

CONTRACT-01 negative matrix
(`packages/contract-tests/src/negative-matrix.test.ts`) asserts
envelope conformance for every Phase 2-5 route + every out-of-scope
404 path; a missing matrix entry is caught by the Pitfall #6
enumeration test.

---

## RLS (Row-Level Security)

Every new tenant-scoped table MUST:

1. `ENABLE ROW LEVEL SECURITY` AND `FORCE ROW LEVEL SECURITY`
   (the FORCE clause makes the policy apply to the table owner too —
   critical because migrations run as owner).
2. Carry a `tenant_id uuid NOT NULL` column.
3. Declare a USING policy on `current_setting('app.tenant_id')::uuid`:

```sql
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;
CREATE POLICY notes_tenant_isolation ON notes
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

4. Be exercised by a cross-tenant property test in
   `packages/data/src/__tests__/rls-property.test.ts` (fast-check ≥
   100 pairs, runs through PgBouncer transaction mode to assert
   `SET LOCAL app.tenant_id` survives connection multiplexing).

The repo lint at `tools/lint-rls.ts` fails CI if a tenant-scoped table
ships without FORCE RLS.

---

## TDD discipline

Per CLAUDE.md (constitutional, non-negotiable):

- **RED test + GREEN implementation in the same atomic commit.**
  Never land production code without its test.
- **Coverage floor:** ≥ 90% on lines, branches, functions, and
  statements for every new/modified file in the phase.
- **No mocks of internal logic.** Mocks only at process boundaries
  (third-party HTTP, OS time, filesystem). Use testcontainers for
  Postgres / PgBouncer / Valkey-touching code.
- **E2E mandatory** for every user-visible route — at minimum one
  `tests/e2e/*.spec.ts` exercising the route through the real
  docker-compose stack via Traefik TLS.

The gsd-verifier agent enforces all four bars before a plan can
close.

---

## Argon2id for secret hashing

Phase 5 / Plan 09 established the canonical password / API-key hashing
parameters (OWASP 2026 recommendation):

```ts
import { hash, verify } from "@node-rs/argon2";

const params = {
  algorithm: 2,        // argon2id
  memoryCost: 65536,   // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;
```

NEVER use `bcrypt` / `scrypt` / `pbkdf2` for new code. The Argon2id
hash format is self-describing (`$argon2id$v=19$m=65536,t=3,p=1$...`)
so future parameter rotations migrate cleanly.

Argon2id is also used for the `Bearer pak_*` API-key middleware that
activates in Phase 6 (Phase 5 ships the issuance + lifecycle CRUD;
the auth-path integration lands next phase).

---

## File layout

```
apps/api/src/
├── lib/
│   ├── soft-delete.ts             # shared helper
│   ├── client-id-upsert.ts        # shared helper
│   ├── keyset-pagination.ts       # shared helper
│   └── argon2-keys.ts             # Argon2id wrapper (Plan 09)
├── routes/
│   ├── <resource>/
│   │   ├── create.ts
│   │   ├── batch-create.ts
│   │   ├── update.ts              # (PATCH)
│   │   ├── delete.ts              # (DELETE)
│   │   ├── delete-all.ts          # optional
│   │   ├── list.ts
│   │   └── search.ts              # optional
│   └── index.ts                   # ordered registration of every plugin
packages/contract-tests/src/
├── <resource>.test.ts             # per-resource wire shape conformance
└── negative-matrix.test.ts        # cross-cutting envelope invariant
packages/data/
├── migrations/<NNNN>_<feature>.sql
└── src/
    ├── tenant-context.ts          # withTenant() helper
    └── __tests__/rls-property.test.ts
tests/e2e/
└── phase-XX-<resource>.spec.ts    # one per new resource
```
