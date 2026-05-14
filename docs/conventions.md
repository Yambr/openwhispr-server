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

---

## Test layout

Phase 15 (STRUCT-01) codifies a uniform test layout across the monorepo.
Every unit test for an `apps/<app>` or `packages/<pkg>` workspace lives
under that workspace's `tests/unit/` directory mirroring the `src/` tree:

```
apps/<app>/
├── src/
│   └── lib/foo.ts
└── tests/
    ├── unit/
    │   └── lib/foo.test.ts         # mirror of src path
    └── integration/                # optional, real-service tests
packages/<pkg>/
├── src/
│   └── guard.ts
└── tests/
    └── unit/
        └── __tests__/guard.test.ts  # __tests__ harness dir preserved
```

**Forbidden:** co-located `*.test.ts` siblings of source files inside
`apps/<app>/src/**` or `packages/<pkg>/src/**`. The
[`pnpm lint:colocated-tests`](../tools/lint-colocated-tests.ts) guard
fires at error severity in `lefthook` pre-commit and in `.github/workflows/ci.yml`.

### Exempt paths

The following directories are explicitly exempt from the
no-colocated-tests rule. Adding a new path here requires an ADR.

| Path | Rationale |
|---|---|
| `tests/e2e/` | Root e2e suite (Playwright + Vitest mock-realtime). |
| `tests/e2e-cjm/` | Phase 13 customer-journey-map Playwright suite. |
| `tests/conformance/` | UI-SPEC + accessibility conformance fixtures. |
| `tests/infra/` | Compose / Helm / migration smoke harnesses. |
| `tools/load-test/` | Dev tooling, not an app or library (Phase 15 CONTEXT Q4 #4 deferred). |
| `tools/test-probe/tests/` | Already-canonical tooling test layout. |

### Enforcement

- **CLI guard** — `tsx tools/lint-colocated-tests.ts` (wired into
  `pnpm lint:colocated-tests`, `lefthook` pre-commit, and CI `lint` job).
  Exit 0 = clean; exit 1 = at least one violation listed on stderr;
  exit 2 = internal error.
- **Coverage** — `tools/lint-colocated-tests.test.ts` covers the guard
  at ≥ 90/90/90/90 (currently 100/100/100/100) via the
  `pnpm test:lint-colocated-tests` script.

Task 0 pivot note: the repo's lint stack is **Biome** (`pnpm lint` =
`biome check .`); no ESLint config exists. The original Phase 15 plan
described this rule as an ESLint plugin, but the absence of any ESLint
runtime made a standalone tsx CLI mirroring `tools/lint-tdd.ts` the
correct pivot. The rule is functionally equivalent and ships zero new
runtime dependencies.

### Migration tooling (one-time, Phase 15-02)

The codemod that performed the actual relocation:

```
tsx tools/migrate-tests.ts --dry-run                       # plan moves
tsx tools/migrate-tests.ts --dry-run --inventory <path.md> # write inventory
tsx tools/migrate-tests.ts --apply                         # execute
```

The codemod uses **ts-morph** (not regex) so that relative imports
inside every moved test file are recomputed against the new directory
depth. The committed inventory artifact for the 15-02 big-bang move
lives at
[`Phase15-MOVE-INVENTORY.md`](../.planning/phases/15-repo-refactor-fsl-relicense-history-scrub-v2/Phase15-MOVE-INVENTORY.md)
and was generated by `--dry-run --inventory`.

A transitional file
[`tools/lint-colocated-tests.legacy-allowlist.txt`](../tools/lint-colocated-tests.legacy-allowlist.txt)
enumerates every legacy co-located path so that `pnpm lint:colocated-tests`
exits 0 during the 15-01 -> 15-02 window. The file is DELETED as the
final commit of 15-02 once `migrate-tests.ts --apply` has relocated
every entry.


## Route groups (apps/web/src/app)

Next.js App Router groups (folders wrapped in `()` parens) are used in
`apps/web/src/app` to attach a shared layout to a set of routes without
affecting the URL path. The repo convention as of Phase 15 (STRUCT-07):

| Group       | URL contribution | Layout responsibility | Contents (today)                |
|-------------|------------------|------------------------|---------------------------------|
| `(public)/` | none (transparent) | unauthenticated shell — sign-in, sign-up, password reset, OIDC callbacks, verify-email | `setup/`, `sign-in/`, `sign-up/`, `verify-email/` |
| `(auth)/`   | none             | post-login authenticated shell — the **authed** user experience (NOT the auth/login forms) | `app/` (the dashboard root) |
| `(admin)/`  | none             | admin-only shell — tenant-admin and owner surfaces | `admin/` |

**Naming note:** `(auth)/` historically reads ambiguously (it could mean
"auth flows" or "authed users"). In this repo it means **authed-user**
routes — the post-login experience. Auth flow pages (sign-in/sign-up/
verify-email) live under `(public)/`. A future rename to `(authed)/`
was considered during Phase 15 plan 02 audit and deferred — touching
the literal folder name requires sweeping every test, every Playwright
selector that references file paths, and every middleware matcher. The
deferred work is tracked under TD-15.h.

**When to introduce a new group:** add a group when a NEW slice of the
app needs a shared layout that the existing three cannot accommodate
(e.g. a future `(api-keys)/` if the BYOK self-service UI grew its own
chrome). Do NOT add a group purely for "namespacing" — that is what
plain folders are for. Each group costs one `layout.tsx` and one mental
model item; the budget is small.

### Canonical mkcert host list (forward-pointer to Phase 17)

The dev TLS stack provisioned by Phase 17's mkcert workflow covers
exactly five `.localhost` vhosts that the Traefik dynamic config wires:

- `api.localhost` — Fastify API container (port 3000). See
  `compose/traefik/dynamic.yml` and the `api`, `api-realtime`,
  `api-audio` routers therein.
- `web.localhost` — Next.js web app (port 3001). See
  `compose/traefik/dynamic.dev.yml` (`web` router, Phase 15 plan 02).
- `app.localhost` — alias retained for backward-compat with pre-Phase-15
  desktop builds; currently captured by the broader `api` router when
  declared. Phase 17 is responsible for the explicit cert + router.
- `grafana.localhost` — Grafana UI (Phase 06 observability stack).
- `mailpit.localhost` — Mailpit dev SMTP UI (Phase 02 dev-tools overlay).

Phase 17 owns the actual cert provisioning + the trust-store integration;
Phase 15 locks the canonical list via the dynamic.dev.yml + this doc.
