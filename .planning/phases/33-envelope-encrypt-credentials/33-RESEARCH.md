# Phase 33: Envelope encryption wired to Better Auth credential columns — Research

**Researched:** 2026-05-16
**Domain:** AES-256-GCM envelope encryption at the Drizzle/Better-Auth ORM boundary; multi-migration column lifecycle (add bytea → backfill → drop plaintext); KEK rotation; boot-time env validation; AST-locker authorship.
**Confidence:** HIGH on the existing primitives (envelope.ts, KeyProvider) — all read in full and verified against unit tests. HIGH on the schema column inventory and Better Auth adapter shape (read from vendored node_modules). MEDIUM on the lens architecture choice (Drizzle does not document a column-level transparent-transform pattern that fan-outs 1→4; the chosen wrap-adapter approach is the cleanest fit but is novel in this codebase). HIGH on the 3-migration split rationale (matches 0005's precedent for breaking auth-table changes inside drizzle's enclosing transaction).

## Summary

Phase 33 closes CR-02 / CRIT-FIX-02 from `.planning/review/data.md:32-46`: eight Better-Auth credential columns currently stored as `text` (plaintext) must move to envelope-encrypted bytea. The `packages/data/src/encryption/` primitives (envelope.ts, EnvKeyProvider, the KeyProvider interface + selectProvider dispatcher) are fully implemented and unit-tested, but have zero production callers — verified by repo-wide grep (`encryptValue|decryptValue|EnvKeyProvider` only appears in `packages/data/tests/**` and one comment-only reference in `tools/`).

The work splits into five atomic commits (33-01..33-05) on top of three SQL migrations:
- **0019_envelope_encrypt_secret_columns_add.sql** — additive: 4 new bytea columns per credential column (32 new columns total across 4 tables); plaintext columns remain.
- **Node-side backfill** — idempotent migrator that reads each plaintext column, encrypts via `encryptValue(selectProvider(), Buffer)`, and writes the 4 bytea fields.
- **0020_envelope_encrypt_secret_columns_drop_plaintext.sql** — drops the 8 plaintext columns AFTER the lens is wired and integration tests are green.

The Drizzle lens does NOT live at the column level (Drizzle's `customType` only supports 1→1 single-column mappings — see `packages/data/src/schema/_helpers.ts:13` for the precedent — and our envelope shape is 1→4). Instead, the lens wraps Better Auth's drizzleAdapter at the `create / update / findOne / findMany` interface boundary, intercepting the 8 column names and inflating/deflating the EncryptedRow shape transparently.

**Primary recommendation:** Implement the lens as an adapter wrapper (approach C in Q6 below) that takes a `KeyProvider` (not raw key) and a column-name registry, sitting between `betterAuth({ database: ... })` and `drizzleAdapter(...)`. Add MASTER_KEK boot-time validation in `apps/api/src/index.ts` + `apps/worker/src/index.ts` co-located with the existing BYOK guard (which already runs on the same module-top side-effect path). 0019/0020 follow the Phase 32 RLS migration test pattern verbatim.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (verbatim from 33-CONTEXT.md `<decisions>`)

**Migration split (CONTEXT D-1):**
- 3 separate SQL migrations (additive 0019 → backfill via Node script → drop-plaintext 0020) provides safe rollback windows.
- 0019 (additive) lands first; can be rolled back independently.
- Backfill is non-DDL; runs on the live DB.
- 0020 (drop plaintext) lands LAST, atomic with the lens commit going live (so traffic moving from "read both columns, prefer ciphertext" to "read ciphertext only" happens in one transaction).

**Lens implementation (CONTEXT D-2):**
- `packages/data/src/encryption/lens.ts` — new file; uses existing `envelope.ts` primitives.
- Drizzle has no native column-level lens API.
- DB-level VIEW + INSTEAD OF triggers REJECTED because key material must stay in Node process (would leak via `pg_stat_activity`).

**Key derivation (CONTEXT D-3):**
- `MASTER_KEK` env is the AES-256 key directly (not a passphrase that needs KDF). 32 raw bytes, base64-encoded for transport.
- Per-row DEK is generated via `crypto.randomBytes(32)` and wrapped under `MASTER_KEK` (AES-256-GCM with separate IV).
- No PBKDF2/Argon2 for KEK derivation.

**Boot-time refusal (CONTEXT D-4):**
- `validateMasterKek()` called from api + worker entry-points at boot.
- Exit code 78 (EX_CONFIG per BSD sysexits).

**LOCKER-PLAINTEXT-COLS allowlist policy (CONTEXT D-5):**
- After 0020 drops plaintext columns, the locker should find zero violations. Allowlist seeded empty.
- Locker introduction LOCKED to AFTER 0020 lands, same atomic commit as schema cleanup (no allowlist churn).

**Atomic-commit cadence (CONTEXT D-6):**
- 33-01: `0019` migration + migration test (RED → GREEN, atomic).
- 33-02: Lens (`lens.ts`) + envelope.ts coverage gap fill + unit tests for round-trip / tampered / wrong-KEK / rotation.
- 33-03: Backfill Node migrator + idempotent re-run test.
- 33-04: Schema declarations switch to bytea-only columns + Better Auth integration test (sign-in/out/password-reset/OAuth) on real PG testcontainer + boot-time refusal test.
- 33-05: `0020` plaintext drop + lens-only schema declarations + LOCKER-PLAINTEXT-COLS + DISCIPLINE Rule 15 + CLAUDE.md mirror + lefthook/CI wiring + docs/security.md §12. Single atomic commit per LOCKER-07 precedent.

### Claude's Discretion

- Exact filenames for backfill helper (`backfill.ts` vs `migrations/scripts/...`).
- Linter regex scope (Q12 — text-only vs text+varchar+char).
- Exit-code mechanics for boot-time refusal (Q9 — 78 is the locked recommendation; alternative codes acceptable if implementation reality differs).
- Test-fixture sharing strategy across 33-02 unit tests and 33-04 integration tests.

### Deferred Ideas (OUT OF SCOPE)

- Encryption of `users.password_hash` — see Q4 below; this column EXISTS (`packages/data/src/schema/users.ts:27`) but is NOT in the Phase 33 scope of 8 columns. Listed as deferred.
- Encryption of audit-log payloads.
- KMS provisioner sidecar container.
- Phase 34 tenantPlugin retirement — separate phase; landing order 33 → 34.
- Encryption of non-credential columns (notes content, transcriptions, etc.).
- KEK escrow / split-trust schemes.
- HSM integration.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CRIT-FIX-02 | `.planning/review/data.md` CR-02: wire envelope-encryption to Better Auth credential columns; close plaintext-bearer / plaintext-OAuth-token / plaintext-reset-token / plaintext-PKCE-verifier surface. | Q1+Q2 confirm envelope primitives are production-grade and ready. Q4 enumerates exact columns. Q5+Q6 define the lens architecture. Q7+Q8 define the migration cadence. Q9 covers the boot-time guard. Q10 defines the integration tests. |
| DATA-05 (REQUIREMENTS.md:70) | "At-rest encryption for sensitive columns (bearer tokens, LiteLLM virtual keys, third-party API keys) via KEK/DEK pattern; KEK supplied via env / Vault / KMS adapter" — currently marked `[x]` but is materially false until lens wires up. | Phase 33 closes this. Subsequent phases extend to non-credential columns (api_keys.key_hash is already Argon2id — separate posture). |
| ROADMAP Phase 33 | "Envelope encryption wired to Better Auth credential columns (CR-8 closure)" — ROADMAP.md:82. Says migration `0018_envelope_encrypt_secret_columns.sql`; CONTEXT supersedes to **0019** (verified by `ls migrations/*.sql` — 0018 is Phase 32's). | Number drift acknowledged in CONTEXT pre-flight; planner uses 0019/0020. |
| DISCIPLINE Rule 15 | New constitutional locker: AST-scan refuses `text(<credential-col>)` in schema files. | Q12 covers scope decision + LOCKER-07 atomic-commit precedent. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| AES-256-GCM crypto primitive | Node process (packages/data/src/encryption) | — | Node `crypto` — never DB-side (CONTEXT D-2). |
| KEK source / provider abstraction | Node process (packages/data/src/encryption/key-provider.ts) | — | Already implemented. KEK material never crosses to PG. |
| Plaintext ↔ ciphertext column mapping (the "lens") | Node process — Better Auth adapter wrapper | Drizzle ORM (raw column R/W) | The lens sits between Better Auth's high-level model semantics (user/session/account/verification) and Drizzle's row-level R/W. PG only ever sees bytea columns. |
| Boot-time KEK validation | Node process — api+worker entry modules | — | Co-located with existing BYOK guard at `apps/api/src/index.ts:64-73` + `apps/worker/src/index.ts:14-26`. |
| 4-bytea-per-credential column storage | PostgreSQL (data tier) | — | Drizzle migration adds 32 new bytea columns; backfill populates; 0020 drops 8 text columns. |
| Backfill batch processing | Node process — one-shot CLI under `packages/data/src/encryption/` | Drizzle (raw `pg` pool query) | Mirrors `migrate.ts:65-90` `ensureLitellmDatabase()` precedent: short-lived script with own pool, idempotent SELECT-then-process loop, `--dry-run` flag. |
| LOCKER-PLAINTEXT-COLS AST scan | Node process — `tools/lint-no-plaintext-secret-columns.ts` | — | Same shape as the six existing LOCKER-01..06 lints (DISCIPLINE.md:36-42). Uses TypeScript compiler API or babel parser (consistent with existing lockers). |
| KEK rotation operational flow | Operator runbook + Node backfill | — | Dual-env pattern (`MASTER_KEK_CURRENT` + `MASTER_KEK_PREVIOUS`); re-wrap pass touches only the 4 bytea columns per row (not value_ciphertext). See Q11. |

## 15 Question Answers

### Q1. envelope.ts API — exact exports + signatures

**File: `packages/data/src/encryption/envelope.ts`**

- **Line 37-44** — `interface EncryptedRow` with 6 bytea fields (NOT 4 as CONTEXT initially suggested):
  ```ts
  dek_wrapped: Buffer;      // wrapped DEK ciphertext
  dek_iv: Buffer;           // 12-byte IV used to wrap the DEK
  dek_auth_tag: Buffer;     // 16-byte GCM tag over wrapped DEK
  value_iv: Buffer;         // 12-byte IV used to encrypt the plaintext
  value_auth_tag: Buffer;   // 16-byte GCM tag over value_ciphertext
  value_ciphertext: Buffer; // AES-256-GCM(DEK, plaintext)
  ```
- **Line 46-74** — `encryptValue(provider: KeyProvider, plaintext: Buffer): Promise<EncryptedRow>`. Accepts a `KeyProvider` (not a raw key), generates `randomBytes(32)` DEK, encrypts plaintext under DEK, then calls `provider.wrapDek(dek)` for the KEK-side wrap. Best-effort `dek.fill(0)` in finally (line 71-73).
- **Line 76-87** — `decryptValue(provider: KeyProvider, row: EncryptedRow): Promise<Buffer>`. Inverse path.
- **Line 50-52** — runtime guard: `Buffer.isBuffer(plaintext)` — TypeError on non-Buffer. Tests cover at `envelope.test.ts:96-100`.
- **Line 32** — `import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"`. Algorithm string `"aes-256-gcm"` literal at line 35 (inlined elsewhere to satisfy verification grep per `env-key-provider.ts:18-19` comment).

**Critical correction to CONTEXT line 35:** CONTEXT says "ADD `<col>_ciphertext bytea`, `<col>_dek_wrapped bytea`, `<col>_iv bytea`, `<col>_tag bytea` (4 new bytea columns per credential column → 32 new columns total)". This is **wrong by 2 columns per credential column**. The actual EncryptedRow shape has **6 bytea fields** (dek_wrapped, dek_iv, dek_auth_tag, value_iv, value_auth_tag, value_ciphertext). 0019 must add **6 bytea per credential column = 48 new bytea columns total**, not 32. The planner MUST correct this number when authoring 0019.

**Confidence:** HIGH — read envelope.ts line-by-line, cross-checked against envelope.test.ts which exercises all 6 fields (`tests/unit/__tests__/envelope.test.ts:62-67`: a/b ciphertext comparison touches `value_ciphertext`, `value_iv`, `dek_wrapped`, `dek_iv` — confirming the wire shape).

### Q2. KeyProvider abstraction + Vault/KMS stubs

**File: `packages/data/src/encryption/key-provider.ts`**

- **Line 20-42** — `interface KeyProvider`:
  ```ts
  readonly id: string;
  getKek(): Promise<Buffer>;                    // 32-byte buffer
  wrapDek(dek: Buffer): Promise<{wrapped, iv, authTag}>;
  unwrapDek(wrapped, iv, authTag): Promise<Buffer>;
  ```
- **Line 49-61** — `selectProvider()` reads `OPENWHISPR_KEY_PROVIDER` env, defaults to `"env"`, dispatches to `EnvKeyProvider | VaultKeyProvider | KmsKeyProvider`. Throws `Unknown key provider: ${id}` on unknown value (line 59).

**EnvKeyProvider (production, `env-key-provider.ts:21-65`):**
- Caches KEK per-instance in `this.kek` (line 23). Reads `process.env.MASTER_KEK`, decodes base64url, validates 32-byte length (line 31-35).
- `wrapDek` (line 40-54) — AES-256-GCM with `randomBytes(12)` IV per call. Validates DEK is 32 bytes (line 41-43).
- `unwrapDek` (line 56-64) — `createDecipheriv` + `setAuthTag` + `Buffer.concat([decipher.update(...), decipher.final()])` — `final()` throws on auth-tag mismatch.

**VaultKeyProvider (`vault-key-provider.ts`)** and **KmsKeyProvider (`kms-key-provider.ts`)** are **STUBS** — confirmed by full read. Both 27-28 lines, all three methods throw `NOT_IMPLEMENTED` (`"VaultKeyProvider not implemented in v1; HashiCorp Vault adapter deferred"`). Tests at `tests/unit/__tests__/key-provider.test.ts:38` confirm instantiation succeeds but every method throws.

**Are stubs invoked anywhere in production?** No. Grep `selectProvider|VaultKeyProvider|KmsKeyProvider` across `apps/` returns only:
- `apps/api/scripts/check-default-secrets.ts:68` — checks `MASTER_KEK` is set + not in deny-list. Does NOT call into encryption module. Treats MASTER_KEK as a bootstrap-bash-managed secret.
- No `apps/api/src/**` or `apps/worker/src/**` imports the encryption module today.

**MD-02 from review (data.md:84-86):** flagged that stub providers fail loudly only at first call. Phase 33 inherits this — the planner should consider routing `selectProvider()` validation INTO `validateMasterKek()` boot-time guard so a `OPENWHISPR_KEY_PROVIDER=vault` misconfiguration in v1 fails at boot, not on first encrypted-row write.

**Confidence:** HIGH.

### Q3. Provider selection at boot

**Current state:** `selectProvider()` is called nowhere in `apps/`. The function exists; nothing wires it.

**Phase 33 must add the call site.** Recommended location:

1. `apps/api/src/index.ts` — after the BYOK guard at line 64-73, before OTel bootstrap import (line 79). Insert:
   ```ts
   import { validateMasterKek } from "@openwhispr/data/encryption";
   validateMasterKek({ provider: process.env.OPENWHISPR_KEY_PROVIDER ?? "env" });
   ```
2. Mirror to `apps/worker/src/index.ts` after line 26 (the BYOKGuardError catch block).

Where the new `validateMasterKek()` lives: **`packages/data/src/encryption/boot.ts`** (new file; co-located with the other encryption primitives). Function should (a) call `selectProvider()` to instantiate the chosen provider, (b) call `provider.getKek()` synchronously-awaited so misconfiguration manifests as a thrown error here rather than at first encrypted-row write, (c) re-throw a typed `MasterKekValidationError` so the entry-point catch can emit a fatal log + `process.exit(78)`.

The `OPENWHISPR_KEY_PROVIDER` env var is documented (`key-provider.ts:46-48`) and the test suite verifies its dispatch (`key-provider.test.ts:31-50`). Phase 33 does NOT introduce the env var — it already exists; Phase 33 starts USING it.

**Confidence:** HIGH (call-site location is determined by mirroring BYOK guard precedent at `apps/api/src/index.ts:64-73`).

### Q4. Schema layout — credential columns

**accounts table (`packages/data/src/schema/accounts.ts`, table name `"account"`):**

| Line | Column declaration | In Phase 33 scope? |
|------|-------------------|---------------------|
| 15 | `id: uuid().primaryKey().defaultRandom()` | No |
| 16-18 | `tenantId: uuid().notNull().references(tenants.id)` | No |
| 19-21 | `userId: uuid().notNull().references(users.id, {onDelete: "cascade"})` | No |
| 22 | `providerId: text("provider_id").notNull()` | No |
| 23 | `accountId: text("account_id").notNull()` | No |
| **24** | **`accessToken: text("access_token")`** | **YES (1 of 8)** |
| **25** | **`refreshToken: text("refresh_token")`** | **YES (2 of 8)** |
| **26** | **`idToken: text("id_token")`** | **YES (3 of 8)** |
| 27 | `accessTokenExpiresAt: timestamp(...)` | No |
| 28 | `refreshTokenExpiresAt: timestamp(...)` | No |
| 29 | `scope: text("scope")` | No (per CONTEXT scope; not a credential) |
| **30** | **`password: text("password")`** | **YES (4 of 8)** |
| 31-32 | createdAt/updatedAt timestamps | No |

**sessions table (`packages/data/src/schema/sessions.ts`, table name `"sessions"`):**

| Line | Column declaration | In Phase 33 scope? |
|------|-------------------|---------------------|
| 24 | `id: uuid().primaryKey().defaultRandom()` | No |
| 25-27 | `tenantId: uuid().notNull().references(tenants.id)` | No |
| 28-30 | `userId: uuid().notNull().references(users.id, {onDelete:"cascade"})` | No |
| **34** | **`token: text("token").notNull()`** | **YES (5 of 8)** |
| 35 | `expiresAt: timestamp(...)` | No |
| **42** | **`previousToken: text("previous_token")`** | **YES (6 of 8)** |
| 43 | `previousTokenExpiresAt: timestamp(...)` | No |
| 44 | `ipAddress: text("ip_address")` | No |
| 45 | `userAgent: text("user_agent")` | No |
| 46-47 | createdAt/updatedAt | No |

Index implications: `sessions_token_unique` (`sessions.ts:53`) is a UNIQUE index on `token`. **Phase 33 must drop this index** — uniqueness over bytea-ciphertext is meaningless because each call generates a fresh DEK+IV (so the same plaintext token produces a different ciphertext on every encryption). Replacement: keep uniqueness at the **plaintext level** via the same code paths Better Auth already uses (token generation is `crypto.randomUUID()`-style; collisions across the keyspace are astronomically improbable), but enforce at the **application layer** rather than DB layer. Same for the partial index `sessions_previous_token_idx` (sessions.ts:56) — bytea ciphertext is not useful as a lookup column. **The SECURITY DEFINER function `lookup_session_by_previous_token(text)` (referenced at sessions.ts:39-41) was the canonical lookup path under plaintext** — it requires a parallel rewrite. The lens must intercept the lookup BY token at the adapter layer, not the DB layer. This is a non-trivial architectural consideration the planner MUST address — see Q15.

**verification table (`packages/data/src/schema/verifications.ts`, table name `"verification"`):**

| Line | Column declaration | In Phase 33 scope? |
|------|-------------------|---------------------|
| 12 | `id: uuid().primaryKey().defaultRandom()` | No |
| 13-15 | `tenantId: uuid().notNull().references(tenants.id)` | No |
| 16 | `identifier: text("identifier").notNull()` | No |
| **17** | **`value: text("value").notNull()`** | **YES (7 of 8)** |
| 18 | `expiresAt: timestamp(...)` | No |
| 19-20 | createdAt/updatedAt | No |

**oauth_state table (`packages/data/src/schema/oauth_state.ts`, table name `"oauth_state"`):**

| Line | Column declaration | In Phase 33 scope? |
|------|-------------------|---------------------|
| 12 | `id: uuid().primaryKey().defaultRandom()` | No |
| 13-15 | `tenantId: uuid().notNull().references(tenants.id)` | No |
| 16 | `provider: text("provider").notNull()` | No |
| 17 | `callbackUrl: text("callback_url").notNull()` | No |
| 18 | `scheme: text("scheme").notNull()` | No |
| **19** | **`codeVerifier: text("code_verifier").notNull()`** | **YES (8 of 8)** |
| 20 | `expiresAt: timestamp(...)` | No |
| 21 | `consumedAt: timestamp(...)` | No |

**users.password_hash (NOT in scope — deferred):**
- `packages/data/src/schema/users.ts:27` — `passwordHash: text("password_hash")`.
- CR-02 review (data.md:36-41) does NOT name `users.password_hash` — only `account.password`. This is because Better Auth 1.6.9 stores the password under `account.password` (provider_id="credential"), and `users.password_hash` is a legacy column from Phase 02 / Plan 01 (per the comment at `users.ts:9-13`).
- Verify pre-execution: does Better Auth actually write to `account.password` or `users.password_hash`? Plan 33-04 integration test must assert this. If `users.password_hash` is written to in production, Phase 33 scope must extend to a 9th column; CONTEXT lists it as Deferred but the planner should empirically verify.

**Confirmed total: 8 columns across 4 tables.** Per CONTEXT scope.

**Confidence:** HIGH on column identification. MEDIUM on the password_hash deferral — verify against runtime behavior in Plan 33-04 integration test.

### Q5. Better Auth integration point

**File: `apps/api/src/auth.ts`**

- **Line 225-235** — drizzleAdapter wiring:
  ```ts
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  })
  ```
- `oauth_state` is NOT in this schema map. It's a custom table written by the OAuth shim handlers in `apps/api/src/routes/desktop-signin.ts` (per CONTEXT line 24's mention — actual route name to verify in 33-04 plan-prep), not by Better Auth itself. The lens for `oauth_state.code_verifier` is therefore a separate hook, not part of the Better Auth adapter wrapper.

**Better Auth hook surface:**
- `databaseHooks` config option (verified in `node_modules/.../better-auth/dist/context/helpers.mjs:22-25, 43-45`). Supports `before/after` `create/update/delete/findOne/findMany` per model. This is a row-level hook, not a column-level transform.
- The `drizzleAdapter` returned from `better-auth/adapters/drizzle` is itself a thin wrapper that produces an `Adapter` interface with `create`, `update`, `findOne`, `findMany`, etc. (interface verified by usage in `node_modules/.../better-auth/dist/plugins/organization/adapter.mjs:386, 424, 502, 548`).

**Where the lens intercepts:** wrap the adapter at construction time. The natural pattern is:
```ts
const baseAdapter = drizzleAdapter(db, { provider: "pg", schema: {...} });
const encryptingAdapter = wrapWithEncryptionLens(baseAdapter, {
  keyProvider: selectProvider(),
  encryptedColumns: {
    account: ["accessToken", "refreshToken", "idToken", "password"],
    sessions: ["token", "previousToken"],
    verification: ["value"],
  },
});
return betterAuth({ database: encryptingAdapter, ... });
```

This requires Phase 33 to know Better Auth's `Adapter` interface shape. The vendored `node_modules/.../better-auth/dist/adapters/drizzle/` is the source of truth; the Plan 33-02 task SHOULD include reading it to confirm the exact method signatures before authoring `lens.ts`.

**`oauth_state.code_verifier` lens:** sits at the route handler level — `apps/api/src/routes/desktop-signin.ts` (or wherever the row is written/consumed). Plan 33-04 must inventory call sites with `grep -rn "code_verifier\|oauth_state" apps/api/src` and inject the lens there. CONTEXT does NOT specifically address this; the planner must surface it.

**Confidence:** HIGH on wrap-adapter approach; MEDIUM on `oauth_state` lens (separate code paths, planner-prep needed).

### Q6. Drizzle column-level transform precedent + lens architecture choice

**Precedent in this codebase:**
- `packages/data/src/schema/_helpers.ts:13-17` — `tsvector` `customType<{ data: string; notNull: true }>` for full-text search. Single column, opaque text, no transform. This is the ONLY customType in the codebase. It is a passive type tag, not a transform.

**No existing precedent for read/write encryption-style transforms.** Phase 33 introduces the pattern.

#### Three lens architectures considered

**(a) Drizzle `customType` with `fromDriver` / `toDriver`:**
- Drizzle's `customType` API supports `fromDriver(value)` (called on every R) and `toDriver(value)` (called on every W) — see `drizzle-orm/pg-core/columns/custom.ts` in the installed package.
- **Verdict: REJECTED for this fan-out.** customType maps **one** column ↔ **one** value. Our envelope produces 6 bytea fields per credential column. We'd need either (i) JSON-pack all 6 fields into a single jsonb column (LOSES the per-field index/typing/rotation handle; harder to re-wrap during rotation), or (ii) declare 6 separate customType columns and a separate hydration layer to assemble them — which is approach (c) by another name.
- The customType path WOULD work IF we collapsed the EncryptedRow shape to a single `bytea` blob with length-prefixed framing (TLV). This is an alternative the planner could consider, but it diverges from `envelope.ts`'s current 6-bytea wire shape and loses easy DEK-only re-wrap during KEK rotation.

**(b) Drizzle middleware / query interceptor:**
- Drizzle has no documented stable middleware/interceptor API. The `db.execute()` and `db.transaction()` paths run raw; the `.select() / .insert() / .update() / .delete()` builders compile to SQL at call time with no post-build hook.
- **Verdict: REJECTED.** Would require monkey-patching the Drizzle prototype, which violates DISCIPLINE Rule 4 (no internal mocks) by analogy and is brittle across Drizzle minor versions (the project pins drizzle-orm 0.45.x — see pnpm dependency in `node_modules/.pnpm/better-auth@1.6.9_...drizzle-orm@0.45.2`).

**(c) Adapter wrapper at the Better Auth ↔ Drizzle boundary [CHOSEN]:**
- Better Auth's adapter interface is documented and stable (per the vendored source at `node_modules/.../better-auth/dist/`). Method signatures: `create({model, data})`, `update({model, where, update})`, `findOne({model, where, select?})`, `findMany({model, where?, limit?, offset?, sortBy?})`, `delete({model, where})`, `count({model, where?})`, `deleteMany`.
- The wrapper intercepts each method:
  - **on write (`create`, `update`):** for each field in the input that matches a column in the encrypted-column registry, call `encryptValue(provider, Buffer.from(plaintext))`, and replace the single field with the 6 underlying bytea field-writes. Forward the transformed `data`/`update` to `baseAdapter`.
  - **on read (`findOne`, `findMany`):** call `baseAdapter` to get rows back, then for each row, for each encrypted column in the registry, call `decryptValue(provider, {dek_wrapped, dek_iv, dek_auth_tag, value_iv, value_auth_tag, value_ciphertext})` and re-bind the plaintext to the original column name. Better Auth sees plaintext.
- **Verdict: CHOSEN.** Reasons:
  1. Boundaries are well-defined and well-documented (Better Auth Adapter interface is part of Better Auth's public API).
  2. The lens is a pure Node-side concern — KEK material never crosses to PG.
  3. Lens code lives in ONE file (`packages/data/src/encryption/lens.ts` per CONTEXT D-2) and is testable in isolation against a mock `Adapter` implementation (allowed: mocking at the Better Auth boundary is mocking an external interface, not internal logic).
  4. `oauth_state.code_verifier` integrates via the same helper functions (`encryptColumn / decryptColumn`) called manually at the OAuth shim route — same code path, no new module.
  5. Better Auth's `databaseHooks` (vendored at `helpers.mjs:22-25`) provide a fallback hook surface for any plugin that calls into `adapter.create()` via a different code path — but those hooks operate on row-level data, not the underlying DB, so they would see plaintext (correct behavior).

**Changes needed in `apps/api/src/auth.ts`:**
- Import `wrapWithEncryptionLens` from `@openwhispr/data/encryption`.
- Wrap the `drizzleAdapter(...)` return value.
- Pass `selectProvider()` and the column registry.

**Recommendation:** approach (c) — adapter wrapper.

**Confidence:** HIGH on adapter-wrapper feasibility; MEDIUM on exact Adapter interface (planner must read the vendored Better Auth adapter dist before writing tests).

### Q7. Migration pattern: add bytea + backfill + drop text — precedent check

**Precedent in `packages/data/migrations/`:**

The CLOSEST precedent is **`0005_session_token_plain.sql`** (read in head — first 50 lines surveyed). It does the **inverse** transform (drop bytea, add text) but in ONE migration:
1. DROP dependent index (line ~25: `DROP INDEX IF EXISTS "sessions_previous_token_hash_idx"`).
2. DROP dependent function (line ~30: `DROP FUNCTION IF EXISTS lookup_session_by_previous_token(bytea)`).
3. **TRUNCATE TABLE sessions** (line ~34) — destructive; allowed because "Phase 02 is dev-only; no production data exists" (comment line 11). This will not be safe for Phase 33 — production data may exist (especially if Phase 33 lands post-public-release).
4. DROP COLUMN token_hash + previous_token_hash.
5. ADD COLUMN token text + previous_token text.
6. Create new index + new function.

All five DDL stages run inside drizzle-orm/migrator's enclosing transaction (line 17 comment: "All four DDL stages run inside drizzle-orm/migrator's enclosing transaction; partial application is impossible").

**Why the 3-migration split is correct (CONTEXT D-1) and not a single CTE migration:**
- **Rollback windows:** if backfill discovers data quality issues (e.g., a row has plaintext that can't be encrypted because it's NULL-but-NOT-NULL via concurrent writes), 0019 can be reverted independently because plaintext columns are intact. A single atomic migration would force a full rollback to before 0019, losing the diagnostic state.
- **No TRUNCATE acceptable in Phase 33:** unlike 0005, Phase 33 lands post-public-release-prep; there will be production session/account/verification/oauth_state rows. The migration cannot destroy them.
- **Drizzle migrator transactional limits:** drizzle-orm/migrator runs each migration file in its own transaction. A single 0019 doing `ALTER ADD COLUMN bytea; UPDATE ... SET ciphertext = encrypt(plaintext); ALTER DROP plaintext` would require the encryption to happen in SQL — which means pgcrypto + KEK material crossing into PG (rejected by CONTEXT D-2).
- **Node-side backfill MUST be a separate non-DDL step** because the encrypt path is Node-only.

**Verdict: 3-migration split is correct.** Single-CTE migration is INFEASIBLE for this transform because the encryption logic cannot run in SQL.

**Confidence:** HIGH.

### Q8. Backfill mechanics

**Where backfill lives:**
- **Recommended: `packages/data/src/encryption/backfill.ts`** (CONTEXT-specifies this file in `<specifics>` line 160).
- Should expose a CLI entry point + an exported function so it's testable:
  ```ts
  export interface BackfillOptions {
    pool: Pool;                  // raw `pg` pool, not Drizzle
    provider: KeyProvider;
    dryRun?: boolean;
    batchSize?: number;          // default 100
    table: "account" | "sessions" | "verification" | "oauth_state";
    plaintextColumn: string;
    bytePrefix: string;          // e.g., "access_token" — the prefix for the 6 bytea cols
  }
  export async function backfillColumn(opts: BackfillOptions): Promise<{processed: number; skipped: number}>;
  ```
- CLI shape (mirrors `packages/data/src/migrate.ts` which is the existing migration runner pattern):
  ```bash
  pnpm --filter @openwhispr/data exec tsx src/encryption/backfill.ts --table account --column access_token [--dry-run]
  ```

**Idempotency strategy:**
- Per-row check: `WHERE access_token IS NOT NULL AND access_token_ciphertext IS NULL` — only encrypts rows that have plaintext but no ciphertext yet. Idempotent re-run finds nothing to do.
- Batch-fetch with `LIMIT $batchSize OFFSET $offset` OR keyset on `id`. Mirrors the audit_log partition rebuild pattern in `0014_audit_log_partition.sql` (the most carefully-written migration per review at data.md:148).
- Each batch wrapped in a transaction with `withTenant(tx, row.tenantId)` — Phase 32's fail-closed RLS posture means rows are tenant-scoped and the backfill MUST set the GUC per-row (or per-batch grouped by tenant_id).
- **Phase 32 RLS interaction**: the backfill connects as `openwhispr_owner` (BYPASSRLS) per the `client.ts` two-pool pattern — owner does NOT need `withTenant`. This is faster AND correct. Document the choice explicitly.

**Migration runner integration:**
- `packages/data/src/migrate.ts:65-90` shows the `ensureLitellmDatabase()` pattern — a Node-side step that runs alongside drizzle migrations. The backfill should follow the same shape but **run AFTER drizzle `migrate()` returns**. Update `migrate.ts` (or a sibling script) to invoke backfill at the right point, OR document the operator step as a separate manual command (`pnpm migrate && pnpm migrate:backfill-encryption`).
- **Recommendation:** separate manual command. Reason: 0019 + backfill + 0020 cadence requires the operator to verify backfill output between migrations; a hands-off auto-run would couple them in a way that defeats CONTEXT D-1's rollback-window goal.

**Confidence:** HIGH on the algorithm; MEDIUM on the exact CLI shape (planner discretion).

### Q9. Boot-time MASTER_KEK validation

**Existing precedent for boot-time env validation:**
- **`apps/api/scripts/check-default-secrets.ts:60-86`** — checks 10 required keys including `MASTER_KEK` (line 68). Exits 1 if unset or matches deny-list. This is invoked by the API container ENTRYPOINT **before** `node dist/index.js` runs (per script header comment, lines 4-5). It validates `MASTER_KEK` is set but does NOT validate length or base64url decodability — that's Phase 33's net-new contribution.
- **`apps/api/src/index.ts:64-73`** — runtime BYOK guard. `assertBYOKConfig()` throws `BYOKGuardError`; caller catches, logs fatal via sync pino, exits 1. Runs at module-top before any other import.
- **`apps/worker/src/index.ts:14-26`** — mirror pattern.

**Where to hook `validateMasterKek()`:**
- Co-locate with BYOK guard. In `apps/api/src/index.ts`, insert AFTER line 73 (after `assertBYOKConfig` catch block) and BEFORE line 79 (OTel bootstrap import). Same for worker after line 26.
- The validation must:
  1. Read `process.env.MASTER_KEK` and verify it's set + 32-byte length post-base64url-decode. This is **already implemented** at `env-key-provider.ts:25-37` inside `getKek()`. Calling `await new EnvKeyProvider().getKek()` synchronously-awaited at boot performs the validation.
  2. Also test `OPENWHISPR_KEY_PROVIDER` — if set to `kms` or `vault`, refuse boot in v1 (the stubs would silently appear to work, then fail loud on first encrypted-row write — MD-02 in data.md:84-86).
  3. On failure, log fatal via sync pino, exit with code 78 (BSD `EX_CONFIG`).

**Exit code 78 recommendation (CONTEXT D-4):**
- BSD sysexits convention: `EX_CONFIG = 78` means "configuration error". This is operator-distinguishable from `1` (generic error) and surfaces cleanly in systemd / Docker exit-status inspection.
- The existing BYOK guard uses `process.exit(1)` (apps/api/src/index.ts:70). Phase 33 should use `78` — but document the convention so a future review doesn't homogenize the exit codes.
- Caveat: docker-compose `restart: on-failure` interprets ANY non-zero exit as failure, so 78 vs 1 doesn't change restart behavior. It DOES change `docker inspect`-visible exit codes and `kubectl describe pod` event logs.

**New module:** `packages/data/src/encryption/boot.ts`
```ts
export class MasterKekValidationError extends Error { ... }
export async function validateMasterKek(opts?: {provider?: string}): Promise<void> {
  // 1. selectProvider() based on OPENWHISPR_KEY_PROVIDER
  // 2. If provider is kms|vault, throw "v1 stub provider not supported at boot"
  // 3. await provider.getKek() — this triggers EnvKeyProvider's length+decodability check
  // 4. on any throw → wrap in MasterKekValidationError, re-throw
}
```

**Confidence:** HIGH.

### Q10. Better Auth flow integration tests

**Existing test patterns:**
- `tests/e2e-cjm/steps/password-reset.steps.ts:118` — hits `/api/auth/reset-password` against the live compose stack.
- `tests/e2e-cjm/steps/transcribe.steps.ts:123-129` — hits `/api/auth/sign-in/email`, expects 200, captures cookies.
- These are CJM (Customer Journey Map) e2e tests using `postJsonRaw` against `apiBaseURL`.

**Phase 33 integration tests must:**

1. **Live testcontainer Postgres** — use `bootMigratedPostgres()` from `packages/data/src/__tests__/helpers.ts:65-168`. This already applies all migrations including 0019 (once authored) and 0020.

2. **Test file locations (per CONTEXT specifics line 163):**
   - `packages/data/src/__tests__/encryption-lens.integration.test.ts` — adapter-wrapper unit + integration tests
   - **Recommend new file**: `apps/api/src/routes/__tests__/better-auth-encryption.integration.test.ts` — full Better Auth flow tests
   - Note `apps/api/src/__tests__/` directory does NOT exist (verified by `ls`). Convention in this repo is co-located `*.test.ts` next to source (LOCKER policy from DISCIPLINE — colocated-tests gate exists per Phase 32 SUMMARY line 52). Plan 33-04 must clarify co-location vs `__tests__` subdir.

3. **Per-flow assertions:**

   ```ts
   // Sign-in flow
   const signupRes = await fetch(`${api}/api/auth/sign-up/email`, {
     method: "POST",
     headers: { "content-type": "application/json" },
     body: JSON.stringify({ email, password: "test-pw-12345!", name: "Test" }),
   });
   expect(signupRes.status).toBe(200);

   // Raw DB read — assert ciphertext, not plaintext
   const ownerPool = new Pool({ connectionString: ownerUri });
   const { rows } = await ownerPool.query<{
     password_ciphertext: Buffer | null;
     password_iv: Buffer | null;
     // …
   }>(`SELECT password_ciphertext, password_value_iv FROM "account" WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]);
   expect(rows[0]!.password_ciphertext).toBeInstanceOf(Buffer);
   expect(rows[0]!.password_ciphertext!.toString("utf8")).not.toBe("test-pw-12345!"); // never plaintext

   // Sign-in still succeeds with plaintext password (lens decrypts)
   const signinRes = await fetch(`${api}/api/auth/sign-in/email`, {
     method: "POST",
     headers: { "content-type": "application/json" },
     body: JSON.stringify({ email, password: "test-pw-12345!" }),
   });
   expect(signinRes.status).toBe(200);
   ```

4. **Tampered-ciphertext rejection test:** read a row, flip one bit in `password_value_ciphertext`, write it back, attempt sign-in → expect 401 + GCM auth-tag error in server logs (not 500 — the lens must catch the throw and route to the canonical 401 envelope per AUTH-04).

5. **All four flows (sign-in / sign-out / password-reset / OAuth):** mirror the e2e-cjm steps with raw DB assertions inserted post-flow.

6. **Boot-time refusal test:** spawn the api binary with `MASTER_KEK` unset → expect exit 78 + log line containing `MasterKekValidationError`. Same with wrong-length KEK (e.g., 16 bytes). Pattern mirrors `apps/api/scripts/check-default-secrets.test.ts` which already exists (referenced at the grep output).

7. **Test fixture: real Better Auth instance + real PG** — build the auth instance against the testcontainer URI exactly as `apps/api/src/index.ts` does, but with `appDb` pointed at the testcontainer's appUri.

**Test runtime budget estimate:** ~30s per flow (testcontainer boot ~15s + 4 flows × 3-4s each = ~30s). Full Phase 33 integration suite: <2 minutes. Phase 32's e2e was 3 tests in similar time (per 32-SUMMARY:48).

**Confidence:** HIGH.

### Q11. KEK rotation pattern

**Operationally simpler approach: dual-env (`MASTER_KEK_CURRENT` + `MASTER_KEK_PREVIOUS`):**

```ts
class EnvKeyProvider {
  async unwrapDek(wrapped, iv, authTag) {
    try {
      return await unwrapWith(this.currentKek, wrapped, iv, authTag);
    } catch (err) {
      if (this.previousKek) {
        return await unwrapWith(this.previousKek, wrapped, iv, authTag);
      }
      throw err;
    }
  }
  async wrapDek(dek) { return wrapWith(this.currentKek, dek); }
}
```

**Operational flow:**
1. Operator generates new KEK (`openssl rand -base64 32`).
2. Deploy with `MASTER_KEK_CURRENT=<new>` AND `MASTER_KEK_PREVIOUS=<old>`. App now reads either, writes only the new.
3. Run re-wrap migrator: for each row, `decryptValue` (succeeds via current OR previous fallback), `encryptValue` (re-wraps under current). Touches only the 6 bytea cols per row.
4. Once re-wrap completes, deploy with `MASTER_KEK_PREVIOUS` removed. Old KEK retired.

**Why simpler than single-pass migrator:**
- The migrator approach requires offline / read-only deploy window. Dual-env path is online.
- Failure mode is well-isolated: a row that fails BOTH current and previous indicates corruption, not rotation incompleteness.
- Mirrors industry pattern (AWS KMS key rotation, GCP CMEK rotation) which all use overlapping-key windows.

**Tests in 33-02 (per CONTEXT):**
- Generate KEK_v1, encrypt rows, swap to (current=v2, previous=v1), assert all old rows still decrypt.
- Encrypt new rows; assert they decrypt under v2 only (raise under v1 alone).
- Retire v1 (set previous=undefined), assert old rows that weren't re-wrapped raise on decrypt.

**Property test:** for N random plaintexts, encrypt half under v1 and half under v2, mix them, set dual-env (current=v2, previous=v1), assert all N decrypt successfully.

**Confidence:** HIGH.

### Q12. DISCIPLINE Rule 15 scope (LOCKER-PLAINTEXT-COLS)

**File: `tools/lint-no-plaintext-secret-columns.ts` (NEW)**

**Regex scope recommendation: text + varchar + char — be inclusive:**
```ts
const FORBIDDEN_DECLS = /(text|varchar|char)\(\s*["'](access_token|refresh_token|id_token|password|value|token|previous_token|code_verifier)["']\s*\)/;
```

**Why include varchar/char:** A future developer (or a copy-paste from another Drizzle codebase) could declare a credential column as `varchar("token", 255)` or similar. The locker's value is in catching future drift, not just today's text-only state. The marginal cost of the extra regex is zero.

**Allowlist policy (CONFIRMS CONTEXT D-5: NO ALLOWLIST):**
- Locker ships in Plan 33-05 ONLY — same atomic commit as 0020 plaintext drop + schema declarations switch to bytea-only.
- The transition window (post-0019, pre-0020) does NOT have the locker enabled, so the 8 plaintext column declarations don't trigger violations.
- After 33-05 lands: locker is active, allowlist is empty, any future `text("password")` etc. in `packages/data/src/schema/**` fails CI.
- **Recommendation: NO ALLOWLIST.** Single-PR transition window is acceptable because 33-05 is itself an atomic commit per LOCKER-07 precedent. CONTEXT D-5's first option ("lock the locker introduction to AFTER 0020 lands, in the same atomic commit as the schema cleanup") is correct and confirmed.

**LOCKER-07 precedent (DISCIPLINE Rule 14 fine print at DISCIPLINE.md:44):**
- "The integration gate (lefthook + `make lint:lockers` + ci.yml + nightly.yml + Makefile + DISCIPLINE.md/CLAUDE.md mirror + `tools/lockers-allowlist-diff.ts`) ships in the SINGLE atomic commit of Phase 31 / Plan 31-07 (LOCKER-07/08/09) — verifier rejects splits."
- Plan 33-05 must mirror this multi-artifact atomic commit shape: linter source + DISCIPLINE Rule 15 amend + CLAUDE.md mirror + lefthook hook + ci.yml job + nightly.yml job + `make lint:lockers` wiring — ALL in one commit.

**WARN-only ledger consideration:** LOCKER-04/05/06 ship WARN-only-on-land per DISCIPLINE.md:44, flipping to BLOCKING in named future phases. LOCKER-01/02/03 ship BLOCKING from day one. **Recommendation: LOCKER-PLAINTEXT-COLS ships BLOCKING from day one.** Justification: the locker is introduced AFTER all 8 plaintext columns are dropped (33-05), so it has zero pre-existing violations to triage; there's no allowlist to grow, no inventory to drain. This is structurally identical to LOCKER-01/02/03's day-one-blocking posture.

**Coverage requirement:** ≥ 90/90/90/90 on the linter source. The linter is a tsx CLI like the other six lockers; test pattern is `tools/__tests__/lint-no-plaintext-secret-columns.test.ts` with positive (allowed declarations) and negative (refused declarations) fixtures.

**Confidence:** HIGH.

### Q13. Phase 32 carryover

**Read `.planning/phases/32-rls-fail-closed/32-DEFERRED.md`:**

11 deferred failures, categorized:
- **Category A (5 tests):** assert pre-Phase-32 fail-open RLS behavior; now obsolete.
  - `0003_better_auth_tenant_defaults.test.ts` (5 cases) — touches users/sessions/account/verification. **OVERLAP with Phase 33 tables.**
  - `bootstrap-roles.test.ts` — role-bootstrap assertion.
  - `settings-rls.test.ts` — `tenant_settings`/`user_settings` (NOT Phase 33 tables).
- **Category B (2 tests):** brittle assertions exposed.
  - `worker-rls-property.test.ts` — BullMQ worker; NOT Phase 33 tables.
  - `audit-log-actions.test.ts` — file-level failure.
- **Category C (multiple):** suspected testcontainer parallelism issues, not real regressions.

**Phase 33 impact:**
- Category A's `0003_better_auth_tenant_defaults.test.ts` touches `account` and `verification` tables, which are also Phase 33's targets. Phase 33's migration 0019 + 0020 will FURTHER break this test (it asserts column DEFAULTs / GUC-bound DEFAULTs on tables whose schema is changing again). **Action: Plan 33-04 must add the test to "expected-to-fail" inventory OR confirm with Phase 41 owner whether to delete the test outright as part of 33 closure.** Recommend the latter — the test asserts behavior that no longer exists.
- Category C — Phase 33's testcontainer-heavy integration tests will run concurrently with these flaky tests if both are in scope. Mitigation: pin Phase 33's vitest config to `--pool=forks --poolOptions.forks.singleFork=true` to serialize testcontainer boots (or rely on the Phase 32 SUMMARY note that running suites in isolation makes them green).

**Confidence:** HIGH.

### Q14. CI testcontainer time budget

**Reuse: `bootMigratedPostgres` from `packages/data/src/__tests__/helpers.ts:65-168`:**
- Already supports the openwhispr_owner + openwhispr_app two-role topology.
- Already provisions pg_partman 5.2.4 (required for migration 0014; transitively required by anything calling `bootMigratedPostgres` after 2026-04-01).
- Phase 32's migration test (0018-rls-fail-closed.test.ts:24-26) uses `withPgPartman: true` — Phase 33 should mirror.

**Estimated runtime:**
- Container boot: ~12-15s (testcontainers-postgres 17.5-pgpartman warm cache; cold ~30s).
- Drizzle migrate(): ~3-5s for 20 migrations.
- Plan 33-01 migration test (0019 add-bytea): ~3 tests × 2s each = ~6s.
- Plan 33-02 lens unit tests: <1s each (in-process, no DB).
- Plan 33-03 backfill test: ~5s (real PG, 1 round of encrypt-100-rows).
- Plan 33-04 integration tests: ~30s (4 flows + boot-time refusal × testcontainer).
- **Total CI delta for Phase 33: ~60-90 seconds.** Within budget per memory:testcontainers-cleanup-audit constraints.

**Memory:testcontainers-cleanup-audit lesson:** Phase 33 tests MUST register an explicit `afterAll` that calls `await container.stop()` (Phase 32 0018-test does this at line 28-30). Failing to do so leaks containers + volumes across test runs.

**Confidence:** HIGH.

### Q15. Architectural pitfalls specific to encryption-at-rest in RLS-fail-closed multi-tenant env

**Pitfall 1: KEK loss = data loss.** If KEK_v1 is lost and rows are encrypted only under it (no overlap-window KEK_v2 deployed before retirement), the rows become permanently undecryptable. Mitigation: dual-env (Q11), KEK backup procedure documented in `docs/security.md` §12, KEK escrow listed as deferred but documented.

**Pitfall 2: RLS prevents the lens from reading its own key material if KEK ever lived in a tenant-scoped table.** The Phase 33 design stores KEK in `MASTER_KEK` env, NOT in the DB — so this pitfall is avoided BY DESIGN. The planner must explicitly preserve this invariant: KEK material must never move to a tenant-scoped DB table.

**Pitfall 3: Lens runs as `openwhispr_app` (RLS-subject) for all Better Auth queries.** The lens itself is Node-side, but its DB writes/reads pass through Better Auth's adapter which uses `appDb` (`apps/api/src/auth.ts:25-29` makes this explicit). Phase 32's fail-closed RLS means every query MUST be wrapped in `withTenant(tenantId)`. The lens does not add a new code path here — it intercepts the SAME Better Auth queries — so the existing tenant-context middleware (`packages/data/src/tenant-context.ts`) covers it. **Plan 33-04 integration test MUST verify** that a request without `withTenant` returns 0 rows / raises 42501 on Phase 33's new bytea columns (mirror Phase 32 e2e test).

**Pitfall 4: Indexes on bytea ciphertext are useless.** As noted in Q4:
- `sessions_token_unique` UNIQUE index on `sessions.token` (text) becomes meaningless when token moves to bytea (every plaintext → different ciphertext). DROP the index in 0020.
- `sessions_previous_token_idx` partial index on `previous_token` — same.
- `SECURITY DEFINER function lookup_session_by_previous_token(text)` — accepts plaintext token from the route handler, queries `WHERE previous_token = $1`. After Phase 33: function CANNOT query plaintext anymore. Either (a) rewrite to accept the lens-encrypted shape (4 bytea params + auth tag) — bad, leaks crypto to PG; OR (b) move the lookup to Node-side: the lens iterates session rows under the tenant, decrypts in-process, compares to candidate plaintext. **(b) is correct for Phase 33** but has a complexity cost: O(N) decryption per token lookup. Acceptable because the lookup happens at most a few times per session-rotation event, and `previous_token` is a partial index (only 5-minute-overlap rows). The planner MUST surface this and plan the function rewrite / function removal in 33-04 or 33-05.

**Pitfall 5: Backfill of `sessions.token` collides with active sessions.** While the backfill runs, Better Auth's adapter is writing NEW sessions to the plaintext column (pre-lens-deploy state). Backfill skips rows already-encrypted but a row could be inserted between SELECT and UPDATE. Mitigation: backfill in `SERIALIZABLE` isolation, or accept a small re-run window (idempotent backfill handles it).

**Pitfall 6: Better Auth's cookie-cache shortcircuits the adapter for session reads.** `apps/api/src/auth.ts:416-419` — `cookieCache: { enabled: true, maxAge: 5*60 }` means Better Auth issues a signed JWT cookie containing session_data, and `getSession()` reads from the cookie for 5 min before re-querying the DB. **The lens is NOT involved in cookie-cache reads.** This is fine for the encryption-at-rest model (the cookie is encrypted by BETTER_AUTH_SECRET; the at-rest threat is DB dumps). Plan 33-04 integration test must NOT rely on cookie-cache being off — assertions about ciphertext must happen against raw DB reads, not against Better Auth's getSession response.

**Pitfall 7: Drizzle schema decls in `accounts.ts / sessions.ts / verifications.ts / oauth_state.ts` must change in 33-04 / 33-05.** Pre-33-04: declarations have BOTH plaintext (text) AND ciphertext (bytea×6) columns; the lens drives which is read/written. Post-33-05: declarations have ONLY bytea×6 columns; the lens is the only access path. The planner must sequence the schema-declaration edits with the migration order: bytea columns added in 33-01 (declared as nullable bytea in schema files at the same time so Drizzle doesn't reject the schema mismatch during migration tests), text columns dropped from schema files in 33-05 (atomic with 0020 SQL).

**Pitfall 8: Phase 32's RLS NULLIF pattern must be inherited.** 0019/0020 do NOT touch RLS policies (they only add/drop columns). But if any new index, function, or trigger is introduced, it must use the NULLIF pattern from `0018_rls_fail_closed.sql:11-14`. The planner MUST surface this and verify all 0019/0020 SQL is compatible with Phase 32's policies.

**Pitfall 9: Squawk lint (`pnpm lint:migrations`).** Phase 32 verified 0018 passes squawk lint (`0018-rls-fail-closed.test.ts:101-110`). 0019 will add 48 nullable bytea columns — large but should pass squawk (ADD COLUMN nullable is fast in PG 17 ≥ 11; no rewrite). 0020 will DROP COLUMN × 8 — needs `--unsafe-drop` or similar squawk exception (DROP COLUMN is metadata-only in PG but squawk may flag it). Plan 33-01 and 33-05 must verify squawk output and add explicit waivers if needed.

**Pitfall 10: Boot-order: lens depends on env-validated provider.** If `validateMasterKek()` is added to api/worker entrypoints but the lens construction at `apps/api/src/auth.ts` happens lazily (per-request via buildAuth), the lens construction will RE-INVOKE `selectProvider()` and re-read MASTER_KEK. This is fine (idempotent + provider caches KEK per-instance). But Plan 33-04 must ensure the lens is constructed ONCE at app boot (with `buildAuth(...)` returning a singleton) and not per-request — both for perf (avoid re-decoding KEK per request) and to fail-loud at boot if env drifted between validate and use.

**Confidence:** HIGH on identified pitfalls; planner should treat each as a discrete acceptance criterion.

## Standard Stack

### Core (already in place — Phase 33 USES these, doesn't add)
| Library | Version | Purpose | Where |
|---------|---------|---------|-------|
| `node:crypto` | Node 24 LTS | AES-256-GCM primitives | envelope.ts, env-key-provider.ts |
| `drizzle-orm` | 0.45.2 | ORM; bytea column type | already used throughout schema/ |
| `pg` | (pinned via Drizzle) | raw Pool for backfill | matches migrate.ts:74 admin pool pattern |
| `better-auth` | 1.6.9 | adapter wrapper target | apps/api/src/auth.ts |
| `vitest` | (workspace pin) | unit + integration test runner | colocated *.test.ts |
| `@testcontainers/postgresql` | (workspace pin) | real PG for migration + integration | bootMigratedPostgres() |

### Supporting (potentially new for Phase 33)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| TypeScript compiler API (ts) | already vendored | AST scan for LOCKER-PLAINTEXT-COLS | tools/lint-no-plaintext-secret-columns.ts |

**No new external dependencies required.**

## Common Pitfalls (consolidated from Q15)

See Q15 for the full list of 10 architectural pitfalls. Top three for planner attention:

### Pitfall: Lens cookie-cache shortcircuit
**What goes wrong:** Integration tests that read session data through Better Auth's getSession() see plaintext from the signed JWT cookie, not from the DB. Tests must read the raw DB to verify ciphertext.
**How to avoid:** All "ciphertext-on-disk" assertions use a separate `pg` Pool to `SELECT *_ciphertext FROM <table>` — never trust Better Auth response shape.

### Pitfall: Session lookup-by-token loses index
**What goes wrong:** `sessions.token` becomes bytea ciphertext; the unique-index lookup-by-token path used by Better Auth's bearer-auth becomes a sequential scan + Node-side decrypt.
**How to avoid:** Plan 33-04 must address: either accept the O(N) cost (per-tenant sessions are <100; tolerable), OR add a non-encrypted token-fingerprint column (e.g., SHA-256 of plaintext, indexed) so lookup-by-token-hash works in O(log N). The SHA-256 fingerprint approach reintroduces a determinism handle but does NOT leak the bearer (one-way hash) — this is the same shape as `api_keys.key_hash` (Argon2id). **Recommend: SHA-256 fingerprint column.** Trade-off acknowledged.

### Pitfall: Backfill races with live writes
**What goes wrong:** Between SELECT-and-encrypt and UPDATE, a new row could be inserted with plaintext-only.
**How to avoid:** SERIALIZABLE isolation per batch OR accept re-run window (idempotent backfill handles it). The latter is simpler; pre-flight verify count of plaintext-without-ciphertext is 0 before authorizing 0020.

## Code Examples

### Adapter wrapper (Q6 architecture C, sketch)

```ts
// packages/data/src/encryption/lens.ts
import type { Adapter } from "better-auth/types";
import { encryptValue, decryptValue, type KeyProvider } from "./index.js";

export interface EncryptionLensConfig {
  keyProvider: KeyProvider;
  encryptedColumns: Record<string, string[]>; // model → column names
}

export function wrapWithEncryptionLens(base: Adapter, cfg: EncryptionLensConfig): Adapter {
  const enc = async (model: string, data: Record<string, unknown>) => {
    const cols = cfg.encryptedColumns[model] ?? [];
    const out: Record<string, unknown> = { ...data };
    for (const col of cols) {
      const pt = data[col];
      if (pt == null) continue;
      const row = await encryptValue(cfg.keyProvider, Buffer.from(String(pt), "utf8"));
      delete out[col];
      out[`${col}_ciphertext`] = row.value_ciphertext;
      out[`${col}_value_iv`] = row.value_iv;
      out[`${col}_value_auth_tag`] = row.value_auth_tag;
      out[`${col}_dek_wrapped`] = row.dek_wrapped;
      out[`${col}_dek_iv`] = row.dek_iv;
      out[`${col}_dek_auth_tag`] = row.dek_auth_tag;
    }
    return out;
  };
  const dec = async (model: string, row: Record<string, unknown> | null) => {
    if (!row) return row;
    const cols = cfg.encryptedColumns[model] ?? [];
    const out: Record<string, unknown> = { ...row };
    for (const col of cols) {
      const ct = row[`${col}_ciphertext`] as Buffer | null | undefined;
      if (!ct) { out[col] = null; continue; }
      const pt = await decryptValue(cfg.keyProvider, {
        value_ciphertext: ct,
        value_iv: row[`${col}_value_iv`] as Buffer,
        value_auth_tag: row[`${col}_value_auth_tag`] as Buffer,
        dek_wrapped: row[`${col}_dek_wrapped`] as Buffer,
        dek_iv: row[`${col}_dek_iv`] as Buffer,
        dek_auth_tag: row[`${col}_dek_auth_tag`] as Buffer,
      });
      out[col] = pt.toString("utf8");
      // optionally delete the bytea fields from the returned shape so
      // Better Auth doesn't see them
    }
    return out;
  };

  return {
    ...base,
    async create(opts) { return base.create({ ...opts, data: await enc(opts.model, opts.data) }); },
    async update(opts) { return base.update({ ...opts, update: await enc(opts.model, opts.update) }); },
    async findOne(opts) { return dec(opts.model, await base.findOne(opts)); },
    async findMany(opts) {
      const rows = await base.findMany(opts);
      return Promise.all(rows.map((r: any) => dec(opts.model, r)));
    },
    // delete, count, etc. pass through unchanged
  };
}
```

(Sketch — exact `Adapter` interface to be confirmed against vendored Better Auth dist during Plan 33-02 task.)

### Boot-time validator

```ts
// packages/data/src/encryption/boot.ts
import { selectProvider } from "./key-provider.js";

export class MasterKekValidationError extends Error {
  override readonly name = "MasterKekValidationError";
  constructor(msg: string, readonly cause?: unknown) { super(msg); }
}

export async function validateMasterKek(): Promise<void> {
  const provider = selectProvider();
  if (provider.id !== "env") {
    throw new MasterKekValidationError(
      `OPENWHISPR_KEY_PROVIDER=${provider.id} not supported in v1; only "env" is implemented`,
    );
  }
  try {
    await provider.getKek();
  } catch (err) {
    throw new MasterKekValidationError(
      `MASTER_KEK validation failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}
```

```ts
// apps/api/src/index.ts (insertion after BYOK guard, before OTel import)
import { validateMasterKek, MasterKekValidationError } from "@openwhispr/data/encryption";

try {
  await validateMasterKek();
} catch (err) {
  if (err instanceof MasterKekValidationError) {
    const bootLog = pino({ name: "api-boot" }, pino.destination({ sync: true, dest: 2 }));
    bootLog.fatal({ err }, "MASTER_KEK validation refused boot");
    process.exit(78); // EX_CONFIG
  }
  throw err;
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (workspace-wide) |
| Config file | `packages/data/vitest.config.ts` (data unit) + root-level for integration |
| Quick run command | `pnpm --filter @openwhispr/data exec vitest run --no-coverage <pattern>` |
| Full suite command | `pnpm --filter @openwhispr/data test` + `pnpm --filter @openwhispr/api test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| 33.M1 (0019 migration) | 6 new bytea cols added per credential col | migration | `pnpm -F @openwhispr/data exec vitest run migrations/__tests__/0019-envelope-encrypt-secret-columns-add.test.ts` | ❌ Wave 0 |
| 33.M2 (lens encrypt) | encryptValue round-trips through wrap-adapter | unit | `pnpm -F @openwhispr/data exec vitest run src/encryption/lens.test.ts` | ❌ Wave 0 |
| 33.M3 (lens decrypt + tampered reject) | findOne returns plaintext; tampered ciphertext throws | unit | (same as above) | ❌ Wave 0 |
| 33.M4 (KEK rotation) | dual-env provider decrypts under current + previous; rejects after retire | property | `pnpm -F @openwhispr/data exec vitest run src/encryption/kek-rotation.property.test.ts` | ❌ Wave 0 |
| 33.M5 (backfill idempotency) | second run finds 0 rows to process | integration | `pnpm -F @openwhispr/data exec vitest run src/encryption/backfill.test.ts` | ❌ Wave 0 |
| 33.M6 (sign-in flow) | password ciphertext on disk; sign-in succeeds | integration | `pnpm -F @openwhispr/api exec vitest run src/routes/__tests__/better-auth-encryption.integration.test.ts -t sign-in` | ❌ Wave 0 |
| 33.M7 (sign-out flow) | sessions.token ciphertext on disk; sign-out clears | integration | (same -t sign-out) | ❌ Wave 0 |
| 33.M8 (password-reset flow) | verification.value ciphertext on disk; reset link decrypts | integration | (same -t password-reset) | ❌ Wave 0 |
| 33.M9 (OAuth flow) | oauth_state.code_verifier + account.{access,refresh,id}_token ciphertext on disk; callback decrypts all four | integration | (same -t oauth) | ❌ Wave 0 |
| 33.M10 (boot refusal) | unset MASTER_KEK → exit 78 | integration | `pnpm -F @openwhispr/api exec vitest run scripts/master-kek-boot.test.ts` | ❌ Wave 0 |
| 33.M11 (0020 drop migration) | 8 plaintext columns dropped; indexes dropped; function rewritten | migration | `pnpm -F @openwhispr/data exec vitest run migrations/__tests__/0020-envelope-encrypt-secret-columns-drop-plaintext.test.ts` | ❌ Wave 0 |
| 33.M12 (LOCKER-PLAINTEXT-COLS) | text("password") in schema refused; varchar variants refused; non-credential text() permitted | unit | `pnpm exec vitest run tools/__tests__/lint-no-plaintext-secret-columns.test.ts` | ❌ Wave 0 |
| 33.E1 (e2e fail-closed compatibility) | encrypted-column lookup fails-closed without app.tenant_id (Phase 32 inheritance) | e2e | `E2E=1 pnpm exec vitest run tests/e2e/envelope-encrypt-credentials.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** filtered vitest run for that task's tests (≤5s typical, ≤30s for testcontainer integration).
- **Per wave merge:** `pnpm --filter @openwhispr/data test && pnpm --filter @openwhispr/api test`.
- **Phase gate:** full suite + e2e green; coverage ≥ 90/90/90/90 on diff per DISCIPLINE Rule 2.

### Wave 0 Gaps
- [ ] `packages/data/migrations/0019_envelope_encrypt_secret_columns_add.sql` — additive migration
- [ ] `packages/data/migrations/__tests__/0019-envelope-encrypt-secret-columns-add.test.ts` — migration test
- [ ] `packages/data/src/encryption/lens.ts` — adapter wrapper
- [ ] `packages/data/src/encryption/lens.test.ts` — unit tests
- [ ] `packages/data/src/encryption/boot.ts` — validateMasterKek + MasterKekValidationError
- [ ] `packages/data/src/encryption/boot.test.ts` — unit tests
- [ ] `packages/data/src/encryption/backfill.ts` — idempotent backfill
- [ ] `packages/data/src/encryption/backfill.test.ts` — integration test
- [ ] `packages/data/src/encryption/kek-rotation.property.test.ts` — property test for dual-env rotation
- [ ] `apps/api/src/routes/__tests__/better-auth-encryption.integration.test.ts` (or co-located) — 4-flow integration
- [ ] `apps/api/scripts/master-kek-boot.test.ts` — boot-refusal subprocess test
- [ ] `tests/e2e/envelope-encrypt-credentials.test.ts` — e2e fail-closed + encryption
- [ ] `packages/data/migrations/0020_envelope_encrypt_secret_columns_drop_plaintext.sql` — drop plaintext
- [ ] `packages/data/migrations/__tests__/0020-envelope-encrypt-secret-columns-drop-plaintext.test.ts` — migration test
- [ ] `tools/lint-no-plaintext-secret-columns.ts` — LOCKER source
- [ ] `tools/__tests__/lint-no-plaintext-secret-columns.test.ts` — locker tests
- [ ] `tools/lint-no-plaintext-secret-columns.allowlist.txt` — empty file (per CONTEXT D-5)
- [ ] DISCIPLINE.md amend (add Rule 15)
- [ ] CLAUDE.md mirror (Engineering Discipline section update)
- [ ] `docs/security.md` §12 (encryption at rest)
- [ ] lefthook.yml + ci.yml + nightly.yml + Makefile updates for LOCKER-PLAINTEXT-COLS

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Better Auth (existing); lens does not change auth posture |
| V3 Session Management | yes | sessions.token encrypted at rest; cookie-cache untouched |
| V4 Access Control | yes | RLS (Phase 32) gates encrypted-column rows by tenant_id |
| V5 Input Validation | no | no new input surfaces |
| V6 Cryptography | **yes** | AES-256-GCM via node:crypto; no hand-rolling; envelope pattern (industry-standard for KMS-backed systems) |
| V9 Communications | no | no new wire surfaces |
| V14 Configuration | yes | MASTER_KEK boot-time validation; loud-fail per Phase 14 BYOK convention |

### Known Threat Patterns for the stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| DB dump leaks plaintext credentials | Information Disclosure | envelope encryption (this phase) |
| Lost KEK → permanent data inaccessibility | Denial of Service | dual-env rotation pattern + documented backup procedure in docs/security.md §12 |
| KEK in source / commit history | Information Disclosure | check-default-secrets.ts (existing) + base64url loud-fail at boot |
| Tampered ciphertext yields incorrect plaintext | Tampering | GCM auth tag (mandatory; tested via envelope.test.ts:70-94) |
| IV reuse under same key | Information Disclosure (catastrophic) | `randomBytes(12)` per call; regression test at envelope.test.ts:59-68 |
| Side-channel via timing on auth-tag verify | Information Disclosure | node:crypto's constant-time `final()` |
| KEK in pg_stat_activity / query logs | Information Disclosure | KEK material never crosses into PG; rejected by CONTEXT D-2 |
| Lens fails-open on decrypt error | Information Disclosure | lens MUST propagate decrypt errors as 401/500 (NOT return plaintext-or-empty); test at 33.M3 verifies |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plaintext bearers + OAuth tokens in DB | AES-256-GCM envelope encryption with per-row DEK | This phase | DB dump no longer leaks credentials |
| `sessions_token_unique` UNIQUE text index | bytea ciphertext + Node-side O(N) tenant-scoped lookup (or new SHA-256 fingerprint column for O(log N)) | This phase | Lookup-by-token semantics preserved at app layer |
| `lookup_session_by_previous_token(text)` SECURITY DEFINER | rewritten OR removed; lens performs lookup Node-side | This phase | Function signature changes — surfaces in 33-05 |
| Phase 32 dead-code envelope module | Phase 33 production-wired envelope module | This phase | MD-01 review finding closed |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Better Auth's Drizzle adapter exposes a stable `Adapter` interface with `create / update / findOne / findMany / delete / count / deleteMany` methods that can be wrapped at construction time without monkey-patching internals | Q5, Q6 | [VERIFIED via vendored source — `node_modules/.../better-auth/dist/plugins/organization/adapter.mjs:386,424,502,548` shows `adapter.create({...})` / `adapter.update({...})` calls; the Adapter interface is part of Better Auth's public API. CITED] |
| A2 | `users.password_hash` (`users.ts:27`) is NOT in scope because Better Auth 1.6.9 stores credential-provider passwords in `account.password`, not `users.password_hash` | Q4 | [ASSUMED — based on Better Auth's documented credential-provider design and the fact that `apps/api/src/auth.ts:225-235` does not declare `passwordHash` as a Better Auth additionalField. **Plan 33-04 integration test must verify** by signing up via Better Auth and asserting `account.password IS NOT NULL` while `users.password_hash IS NULL`. If wrong, scope extends to a 9th column.] |
| A3 | Phase 32's NULLIF-cast RLS pattern is automatically inherited by Phase 33 because 0019/0020 do not redeclare RLS policies | Q15 Pitfall 8 | [VERIFIED — read 0018_rls_fail_closed.sql in full; ADD COLUMN / DROP COLUMN do not affect existing CREATE POLICY bodies. CITED] |
| A4 | Drizzle migrator runs each .sql file in its own transaction, so 0019 and 0020 cannot be coalesced into a single CTE without losing the rollback window | Q7 | [CITED — `packages/data/migrations/0005_session_token_plain.sql:17` comment "All four DDL stages run inside drizzle-orm/migrator's enclosing transaction"] |
| A5 | testcontainers-postgres warm-cache boot is ~12-15s; cold ~30s | Q14 | [ASSUMED — matches Phase 32 e2e duration; not separately benchmarked] |
| A6 | `sessions_token_unique` UNIQUE index cannot be preserved over bytea because each plaintext encrypts to a different ciphertext | Q4, Q15 Pitfall 4 | [VERIFIED — by inspection of envelope.test.ts:59-68 which proves IV+DEK randomization yields distinct ciphertexts for same plaintext. CITED] |
| A7 | Exit code 78 (EX_CONFIG) is BSD sysexits convention for "configuration error" | Q9 | [CITED — BSD sysexits.h; locked in CONTEXT D-4] |
| A8 | Better Auth's cookie-cache (`apps/api/src/auth.ts:416-419`) reads from a signed JWT cookie, not from the adapter, for up to 5 minutes after session creation | Q15 Pitfall 6 | [CITED — `apps/api/src/auth.ts:407-419` comment block + Better Auth 1.6.9 documented cookieCache behavior] |
| A9 | The `oauth_state` table is written by route handlers in `apps/api/src/routes/` (NOT by Better Auth's adapter), so the lens for `code_verifier` requires a separate hook outside the adapter wrapper | Q5 | [VERIFIED — `apps/api/src/auth.ts:225-235` schema map does NOT include oauth_state; the table is only declared in Drizzle schema; route handler call sites must be enumerated in Plan 33-04 prep.] |
| A10 | LOCKER ships BLOCKING from day one (no WARN-only flip) because it lands AFTER all violations are removed | Q12 | [ASSUMED — pattern matches LOCKER-01/02/03; differs from LOCKER-04/05/06 which had pre-existing inventory to triage] |

**Items requiring user confirmation before Plan 33-04 execution:** A2 (password_hash scope) — empirical verification, but recommend planning for the +1 column case (graceful expand-scope rather than re-scope mid-phase).

## Open Questions

1. **Should `sessions.token` get a SHA-256 fingerprint sidecar column?**
   - What we know: bytea ciphertext kills the unique index + lookup-by-token semantics; Node-side O(N) lookup is acceptable for low-cardinality cases.
   - What's unclear: is `sessions.token` queried by lookup-by-token frequently enough that O(N) scan per tenant is a problem? Better Auth's bearer plugin (`auth.ts:206`) likely does lookup-by-token on every authenticated request → this IS the hot path.
   - Recommendation: ADD a `token_fingerprint bytea(32)` column with a unique index, populated as `sha256(plaintext_token)`. Lens computes fingerprint on encrypt; lookups use fingerprint. SHA-256 is one-way; no plaintext recovery risk. Same shape as `api_keys.key_hash` (Argon2id). Plan 33-04 must surface and resolve.

2. **What is the production status of the `lookup_session_by_previous_token(text)` SECURITY DEFINER function (migration 0005)?**
   - What we know: function exists; takes plaintext token; queries `sessions WHERE previous_token = $1`. After 33-05, `previous_token` is bytea ciphertext — function CANNOT work as written.
   - What's unclear: which apps/api code paths call this function? (`grep -rn lookup_session_by_previous_token apps/`)
   - Recommendation: Plan 33-04 prep must enumerate call sites + decide rewrite vs remove. Likely outcome: REMOVE the SQL function entirely and replace with Node-side iteration over the partial-index'd tenant-scoped session rows.

3. **Does `users.password_hash` ever get written to in production?** (See A2.)
   - Recommendation: empirical answer at Plan 33-04 start; if YES, expand scope to 9 columns.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker (testcontainers) | migration + integration tests | ✓ (per memory:smoke-before-full-e2e) | — | — |
| `openwhispr/postgres:17.5-pgpartman` image | bootMigratedPostgres | ✓ (built locally) | 17.5 | rebuild via `docker build compose/postgres` |
| Node 24 LTS | all of Phase 33 | ✓ | — | — |
| pnpm | test execution | ✓ | workspace pin | — |
| MASTER_KEK env (production) | runtime | operator-supplied | — | tools/bootstrap.sh autogenerates |

**Missing dependencies with no fallback:** none.

## Sources

### Primary (HIGH confidence — verified by full file read)
- `packages/data/src/encryption/envelope.ts` (full) — Q1
- `packages/data/src/encryption/key-provider.ts` (full) — Q2, Q3
- `packages/data/src/encryption/env-key-provider.ts` (full) — Q2, Q9, Q11
- `packages/data/src/encryption/kms-key-provider.ts` (full) — Q2
- `packages/data/src/encryption/vault-key-provider.ts` (full) — Q2
- `packages/data/src/encryption/index.ts` (full) — Q1
- `packages/data/src/schema/{users,accounts,sessions,verifications,oauth_state}.ts` (full each) — Q4
- `packages/data/src/schema/index.ts` (full) — Q15 Pitfall 3
- `packages/data/src/schema/_helpers.ts` (full) — Q6 customType precedent
- `packages/data/migrations/0018_rls_fail_closed.sql` (full) — Q15 Pitfall 8
- `packages/data/migrations/__tests__/0018-rls-fail-closed.test.ts` (full) — Q10 test pattern
- `packages/data/src/__tests__/helpers.ts` (full) — Q14
- `packages/data/tests/unit/__tests__/envelope.test.ts` (full) — Q1 wire shape, Q15 Pitfall 4 ciphertext randomization
- `apps/api/src/auth.ts` (full) — Q5
- `apps/api/src/index.ts` (lines 1-80) — Q3, Q9
- `apps/worker/src/index.ts` (full) — Q3, Q9
- `apps/api/scripts/check-default-secrets.ts` (full) — Q9
- `tests/e2e/rls-fail-closed.test.ts` (lines 1-80) — Q10
- `.planning/phases/33-envelope-encrypt-credentials/33-CONTEXT.md` (full) — scope
- `.planning/phases/32-rls-fail-closed/32-SUMMARY.md` (full) — Phase 32 carryover
- `.planning/phases/32-rls-fail-closed/32-DEFERRED.md` (full) — Q13
- `.planning/review/data.md` (lines 1-160) — CR-02 source
- `.planning/DISCIPLINE.md` (full) — Q12 LOCKER policy
- `.planning/ROADMAP.md` (lines 78-90) — Phase 33 entry

### Secondary (HIGH confidence — verified by targeted reads + grep)
- `node_modules/.pnpm/better-auth@1.6.9.../dist/context/helpers.mjs:22-25,43-45` — databaseHooks surface
- `node_modules/.pnpm/better-auth@1.6.9.../dist/plugins/organization/adapter.mjs:386,424,502,548` — Adapter interface usage
- `packages/data/migrations/0005_session_token_plain.sql` (head — first 50 lines) — Q7 multi-stage DDL precedent
- `packages/data/tests/unit/__tests__/key-provider.test.ts` — Q2 stub validation

### Tertiary (MEDIUM confidence — derived from prior phase or pattern)
- DISCIPLINE Rule 15 phrasing (LOCKER-07 multi-artifact atomic commit) — derived from existing LOCKER-04/05/06 patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every primitive already exists; Phase 33 uses, doesn't add.
- Architecture (lens approach C): MEDIUM — chosen with reasoning, but novel in this codebase; planner must read Better Auth's Adapter interface dist files before authoring lens.ts.
- Column inventory: HIGH — read every schema file line-by-line.
- Migration cadence: HIGH — confirmed against 0005 precedent.
- Pitfalls: HIGH — enumerated and individually grounded.
- Tests: HIGH on pattern (matches Phase 32); MEDIUM on exact runtime budgets.
- LOCKER: HIGH (matches LOCKER-07 precedent).

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (30 days — stack is stable; planner-execution within Phase 33 should reference fresh)
