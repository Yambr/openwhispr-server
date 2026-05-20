# Phase 57 — Track A — Research: Transparent envelope-encryption over Better Auth's adapter

**Researched:** 2026-05-20
**Domain:** 3rd-party adapter decoration + AsyncLocalStorage-bound transaction context + ORM input-field whitelist
**Confidence:** HIGH (every claim has a `node_modules` file:line citation or named source)
**Scope:** Architectural decision support for Fix A (lens-on-transaction) + Fix B (additionalFields ergonomics) called out in `.planning/deferred-items.md` Phase 57 HALT entry.

---

## 1. Problem Statement

We wrap Better Auth's `DBAdapter` (a 3rd-party adapter contract) with a lens
(`packages/data/src/encryption/lens.ts:337` `wrapAdapter`) that envelope-encrypts
marked plaintext columns into 6 `bytea` sidecars per column on write and reverses
the transformation on read.

The current wrap fails to apply to **any write that Better Auth issues inside a
transaction-scoped flow**. There are TWO independent failure seams; either one
on its own would suffice to defeat at-rest encryption. Both must be repaired
in the same phase.

### Seam #1 — transaction-context lens bypass (the AsyncLocalStorage trap)

Code path, verified line-by-line in installed `node_modules`:

1. **Sign-up route enters a transaction-scoped block.**
   `better-auth/dist/api/routes/sign-up.mjs:141`:
   ```js
   return runWithTransaction(ctx.context.adapter, async () => {
     // ... validation + parseUserInput + ctx.context.internalAdapter.findUserByEmail ...
     // ... createUser, linkAccount, createSession (all via createWithHooks) ...
   });
   ```
   `ctx.context.adapter` here is OUR lens-wrapped adapter (the closure returned
   from `wrapAdapter(...)` at `apps/api/src/auth.ts:369`).

2. **`runWithTransaction` calls `adapter.transaction(cb)` AND binds the trx into AsyncLocalStorage.**
   `@better-auth/core/dist/context/transaction.mjs:52-78`:
   ```js
   const runWithTransaction = async (adapter, fn) => {
     return ensureAsyncStorage().then(async (als) => {
       result = await adapter.transaction(async (trx) => {
         return als.run({ adapter: trx, pendingHooks }, fn);
       });
       // ...
     });
   };
   ```
   The `trx` value handed to `als.run` is whatever **the wrapped adapter's
   `transaction` method gives back to the callback**. Whatever ends up in
   `als.run({ adapter: trx, ... })` is what `getCurrentAdapter()` returns for
   every subsequent operation inside `fn`.

3. **Our wrap forwards `transaction` to the inner unwrapped adapter.**
   `packages/data/src/encryption/lens.ts:443`:
   ```ts
   transaction: inner.transaction.bind(inner),
   ```
   So `adapter.transaction(cb)` = `inner.transaction(cb)`. The `trx` returned to
   `cb` is whatever the inner (un-lensed) factory produces.

4. **The inner adapter's `transaction` either passes itself (`createAsIsTransaction`) or builds a fresh factory adapter (real txn path).** Either way, what reaches `als.run` is NOT lens-wrapped.

   - **`config.transaction: false` path** (drizzle adapter default — see
     `@better-auth/drizzle-adapter/dist/index.mjs:442`: `transaction: config.transaction ?? false ? ... : false`):
     `@better-auth/core/dist/db/adapter/factory.mjs:17`:
     ```js
     const createAsIsTransaction = (adapter) => (fn) => fn(adapter);
     ```
     and `factory.mjs:401-408`:
     ```js
     transaction: async (cb) => {
       if (!lazyLoadTransaction) if (!config.transaction)
         lazyLoadTransaction = createAsIsTransaction(adapter);
       // ...
       return lazyLoadTransaction(cb);
     },
     ```
     `adapter` in that closure is the factory's own un-lensed adapter — passed
     to `cb`, then forwarded to `als.run` as the bound adapter for the rest of
     the transaction.

   - **`config.transaction: true` path** (drizzle adapter when explicitly enabled):
     `@better-auth/drizzle-adapter/dist/index.mjs:442-447`:
     ```js
     transaction: config.transaction ?? false ? (cb) => db.transaction((tx) => {
       return cb(createAdapterFactory({
         config: adapterOptions.config,
         adapter: createCustomAdapter(tx)
       })(lazyOptions));
     }) : false
     ```
     A FRESH `createAdapterFactory(...)` adapter is built over the trx-bound
     `tx` and handed to `cb`. Same lens-bypass outcome.

5. **Hooks and follow-up CRUD inside the transaction call `getCurrentAdapter()` — the unwrapped one.**
   `better-auth/dist/db/with-hooks.mjs:25`:
   ```js
   if (!customCreateFn || customCreateFn.executeMainFn)
     created = await (await getCurrentAdapter(adapter)).create({ model, data: actualData, forceAllowId: true });
   ```
   `getCurrentAdapter()` (`@better-auth/core/dist/context/transaction.mjs:20-26`) reads
   `als.getStore()?.adapter` first and falls back to the captured closure adapter only
   if the ALS lookup fails. Inside the transaction it ALWAYS returns the trx-bound
   adapter — unwrapped — and every `createUser`, `linkAccount`, `createSession`
   issued during sign-up bypasses the lens.

**Net effect:** `account` (password + OAuth tokens), `session` (token + previous_token),
and `verification` (value) — every credential write Better Auth issues during
sign-up/sign-in/link/refresh — lands as plaintext at the drizzle insert layer.

### Seam #2 — `additionalFields` whitelist drops sidecar keys

Even if Seam #1 is fixed and the lens fires on every adapter.create, the lens
emits 7 keys per encrypted column (6 sidecars + optional fp) — but Better Auth's
adapter-factory `transformInput` only forwards keys it knows about.

`@better-auth/core/dist/db/adapter/factory.mjs:98-140`:
```js
const transformInput = async (data, defaultModelName, action, forceAllowId) => {
  const transformedData = {};
  const fields = schema[defaultModelName].fields;
  // ...
  for (const field in fields) {
    let value = data[field];
    // ...
    if (newValue !== void 0) transformedData[newFieldName] = newValue;
  }
  return transformedData;
};
```

`schema[defaultModelName].fields` is the union of (a) Better Auth's canonical
model schema (user, account, session, verification) and (b) the operator-supplied
`additionalFields` (`@better-auth/core/dist/db/get-tables.mjs:73, 125, 172, 255`):
```js
...options.account?.additionalFields
...options.session?.additionalFields
...options.user?.additionalFields
...options.verification?.additionalFields
```

If a key isn't in that union, the iteration at line 107 never visits it; the key
is silently dropped before reaching `adapterInstance.create` at line 433.

**Sidecar columns the lens emits** (verified counts via `grep -c '_dek_\|_iv\|_auth_tag\|_ciphertext' packages/data/src/schema/*.ts`):

| Better Auth model | DB table | Lens-tracked columns | Sidecars (6 each) | + fp | Total `additionalFields` |
|-------------------|----------|---------------------|-------------------|------|-------------------------|
| `account` | `account` | `password`, `access_token`, `refresh_token`, `id_token` | 24 | 0 | **24** |
| `session` | `sessions` | `token`, `previous_token` | 12 | 2 (`token_fp`, `previous_token_fp`) | **14** |
| `verification` | `verification` | `value` | 6 | 0 | **6** |
| **Sum** | | **7 columns** | **42** | **2** | **44** |

44 declarations. Hand-maintaining a 44-entry parallel list against the schema
guarantees drift on the next added encrypted column.

---

## 2. Named Patterns That Apply

### 2.1 Decorator Pattern (Gamma et al., *Design Patterns*, 1994)

**Description:** Wrap an object implementing interface `I` with another object
that also implements `I` and forwards each method to the wrapped object, optionally
transforming the inputs/outputs. The wrap is transparent to callers — they hold
an `I` reference and never know whether it is wrapped.

**Applicability:** Exactly what `wrapAdapter` is. The contract `DBAdapter` (re-exported from
`better-auth` and the structural type from `@better-auth/core/db/adapter`)
includes `transaction` as part of `I`. **A correct decorator must wrap EVERY method
on `I`, not most-of-them.** Forwarding `transaction` to `inner.transaction.bind(inner)`
violates the decorator contract because the trx-bound `cb` argument receives an
adapter that is no longer wrapped — the decorator stops decorating mid-flow.

**Code sketch (corrected `lens.ts:443`):**

```ts
return {
  // ... create / update / findOne / etc. (unchanged) ...

  transaction: (cb) =>
    inner.transaction(async (trx) =>
      // Wrap the trx-bound adapter with the same providers + columnMap before
      // handing it to the user callback. Better Auth's runWithTransaction
      // calls cb to als.run({ adapter: <return of cb's first await>, ... }),
      // so the value of `trx` we return here is what binds AsyncLocalStorage
      // for the rest of the transaction.
      cb(wrapAdapter(trx, providers, columnMap))
    ),
};
```

**Sources:**
- *Design Patterns: Elements of Reusable Object-Oriented Software* (Gamma, Helm, Johnson, Vlissides, 1994), Decorator chapter.
- Refactoring.guru — https://refactoring.guru/design-patterns/decorator (TypeScript example).

### 2.2 AsyncLocalStorage transaction-context pattern

**Description:** Use Node's `AsyncLocalStorage` (or `cls-hooked` pre-Node-16) to
bind a "current transaction handle" to the async call chain, so deeply nested
service code can pick up the trx without explicit parameter threading. The
storage's `run(store, fn)` swaps the store for the lifetime of `fn`.

**Applicability:** Better Auth already implements this internally
(`@better-auth/core/dist/context/transaction.mjs`). Our lens does NOT need to
re-implement it; it only needs to participate correctly by ensuring the value
written into the store IS the wrapped variant.

**Reference implementations:**
- `typeorm-transactional` — uses AsyncLocalStorage (or cls-hooked) to propagate trx across `Repository` injections. https://github.com/Aliheym/typeorm-transactional — solves the same shape: "wrapped repo passes wrapped trx to als.run."
- Prisma RFC #5729 "Suggestion: using AsyncLocalStorage for transactions" — https://github.com/prisma/prisma/issues/5729 — discussion of identical bind-and-propagate pattern.

**Antipattern citation:** The CURRENT lens code is the canonical "outer-decorator forwards
the inner primitive verbatim, breaking transparency under a context manager"
trap. The wrap is correct for direct `.create()` calls (lines 374-446 of lens.ts) but
NOT for `als.run`-bound flows. This is structurally identical to the bug in early
versions of `typeorm-transactional` where helper decorators didn't propagate the
trx into the ALS store.

### 2.3 ORM middleware / interceptor / extension

Comparable seams in adjacent ORMs:

| Library | Hook seam | Encrypts on write | Decrypts on read | Transaction transparent? |
|---------|-----------|-------------------|------------------|-------------------------|
| Prisma 4.x | `client.$use(middleware)` | Yes — `prisma-field-encryption` | Yes (params/result rewrite) | Yes (middleware fires inside `$transaction`). https://github.com/47ng/prisma-field-encryption |
| Prisma 6.14+ | `client.$extends(extension)` | Yes — `prisma-field-encryption` ≥0.16 | Yes | Yes — replaces removed `$use` middleware. https://github.com/47ng/prisma-field-encryption |
| TypeORM | EntitySubscriber / `@AfterLoad`+`@BeforeInsert` | Yes | Yes | Yes — subscriber registered on connection, fires inside QueryRunner trx |
| Hibernate (JPA) | `@AttributeConverter` / `@ColumnTransformer` | Yes | Yes | Yes — converter applied at session.flush + entity hydrate, regardless of trx scope. https://thorben-janssen.com/how-to-use-jpa-type-converter-to/ |
| EF Core | `SaveChangesInterceptor` + `IMaterializationInterceptor` | Yes | Yes | Yes — interceptors fire on `SaveChanges` within trx context. https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors |
| AWS DynamoDB Encryption Client (Java) | `AttributeEncryptor` + `AttributeActions` | Yes — declared per-attribute | Yes | N/A (DynamoDB has no multi-statement trx). https://docs.aws.amazon.com/database-encryption-sdk/latest/devguide/ddb-java-using.html |
| AWS Database Encryption SDK (v3) | structured-data encryptor + searchable-encryption beacons | Yes | Yes | N/A. https://docs.aws.amazon.com/database-encryption-sdk/latest/devguide/what-is-database-encryption-sdk.html |
| Better Auth | adapter wrap (our pattern) + `databaseHooks` | **Partial — only direct calls, not trx-scoped** | Partial | **NO — current bug, this research** |

**Key insight:** Every mature ORM solves transparent envelope-encryption at the
hook seam BELOW the transaction abstraction (Prisma middleware fires per
operation regardless of `$transaction`; Hibernate AttributeConverter fires at
flush regardless of session boundary; EF Core SaveChangesInterceptor fires per
SaveChanges regardless of outer scope). Better Auth's adapter is one level
ABOVE the transaction abstraction — the `transaction` method IS the boundary —
so the decorator MUST re-enter wrapping at the trx boundary itself.

### 2.4 Configuration-as-data + codegen for whitelist registration

**Description:** When a 3rd-party library demands a registration table (allowlist,
schema, mapping) that mirrors data the application already owns, **derive the
registration from a single canonical source rather than hand-maintaining a
parallel list**. The source of truth is whichever artifact a developer is most
likely to edit when adding a new column; the registration is computed from it
at module load.

**Applicability to Fix B:** `ENCRYPTED_COLUMNS_MAP` (the lens's column declaration)
IS already a canonical source. The 44 `additionalFields` entries are 1:1 derivable
from it — each `model`/`column` pair in the map produces 6 sidecar entries (+ 1 fp
if `fingerprint` is set), each with `{ type: "string", required: false, input: false }`.

**Code sketch:**

```ts
// apps/api/src/auth.ts (replace lines 388-419 user.additionalFields block + extend
// to session/account/verification)

const SIDECAR_KEYS = [
  "dek_wrapped", "dek_iv", "dek_auth_tag",
  "value_iv", "value_auth_tag", "value_ciphertext",
] as const;

const SIDECAR_FIELD_SPEC = {
  type: "string", required: false, input: false,
} as const;

function deriveSidecarAdditionalFields(
  modelMap: EncryptedColumnMap[string] | undefined,
): Record<string, typeof SIDECAR_FIELD_SPEC> {
  if (!modelMap) return {};
  const out: Record<string, typeof SIDECAR_FIELD_SPEC> = {};
  for (const [col, cfg] of Object.entries(modelMap)) {
    for (const k of SIDECAR_KEYS) {
      // Better Auth's transformInput keys against TS-field names (camelCase),
      // see lens.ts:158 `sidecarFieldNameCamel`. Declare both forms because
      // the schema is the snake_case truth and additionalFields is camelCase.
      const camel = toCamel(`${cfg.sidecarPrefix}_${k}`);
      out[camel] = SIDECAR_FIELD_SPEC;
    }
    if (cfg.fingerprint) {
      out[toCamel(cfg.fingerprint.column)] = SIDECAR_FIELD_SPEC;
    }
  }
  return out;
}

// Then at the betterAuth() call:
betterAuth({
  // ...
  user: {
    additionalFields: {
      locale: { type: "string", required: false, defaultValue: "en", input: true },
      role:   { type: "string", required: false, defaultValue: null, input: false },
      ...deriveSidecarAdditionalFields(ENCRYPTED_COLUMNS_MAP.user),
    },
  },
  account: {
    additionalFields: deriveSidecarAdditionalFields(ENCRYPTED_COLUMNS_MAP.account),
  },
  session: {
    additionalFields: deriveSidecarAdditionalFields(ENCRYPTED_COLUMNS_MAP.session),
  },
  verification: {
    additionalFields: deriveSidecarAdditionalFields(ENCRYPTED_COLUMNS_MAP.verification),
  },
});
```

Single source of truth. Adding a new encrypted column = one line in
`ENCRYPTED_COLUMNS_MAP`. The 44 entries materialize automatically.

**Sources:**
- The general pattern is "Don't Repeat Yourself" applied to declarative
  configuration (Hunt & Thomas, *The Pragmatic Programmer*, 1999, §11).
- Concrete precedent: AWS DynamoDB Encryption Client `AttributeActions` is
  declarative per-attribute; the v3 Database Encryption SDK derives the
  registration from a structured-data schema rather than hand-listed attrs.

---

## 3. Named Antipatterns We're Hitting

### 3.1 "Decorator-bypassed-by-transaction" (transaction-context leak)

**Source / formal name:** Variant of "leaky abstraction" (Joel Spolsky, 2002) +
"escape from outer wrapper" — informally documented in ORM transaction
literature, e.g., Bryan Avery, "Entity Framework Unit of Work Patterns",
https://bryanavery.co.uk/entity-framework-unit-of-work-patterns/ — and in the
TypeORM ecosystem's motivation for `typeorm-transactional`: a vanilla
`Repository` injected into a service does not participate in an outer
`@Transactional()` boundary unless the trx-bound repo replaces the original
in an ALS store.

**Manifestation here:** Lens wraps `create`, `update`, `findOne`, etc. correctly.
But forwarding `transaction` to the inner adapter means the trx-bound adapter
escapes the lens wrap, and every CRUD operation under `runWithTransaction`
runs against the raw adapter. Symptom is silent — no error, no warning — plaintext
just lands at rest.

**Why it bites:** Decorator transparency is a developer-mental-model invariant.
A reviewer reading `wrapAdapter` checks that the 7 CRUD methods are intercepted
and concludes "yes, encryption applies." The hidden 8th method (`transaction`)
that re-introduces the unwrapped adapter into the call stack is exactly the
thing a code review will miss. CLAUDE.md hard rule (no `as any`, etc.) is
defensive against type loopholes, but TS infers `inner.transaction.bind(inner)`
as the correct DBAdapter member — there is no type-level signal.

### 3.2 "Field allowlist silent-drop" (configuration-by-omission)

**Source / formal name:** "Silent failure on unknown input" — a subset of
"Postel's law gone wrong" (RFC 760, 1980, robustness principle) where the
producer is liberal (the lens emits every sidecar key it computed) and the
consumer is conservative (transformInput drops anything not in the schema).
When the consumer doesn't log the drop, the producer has no signal that its
output was discarded.

**Manifestation here:** `transformInput` at `factory.mjs:107-138` iterates ONLY
`schema[model].fields` keys. Sidecar keys aren't in that set. No warning, no
debug log (unless `debugLogs: true`), no exception — just an empty entry in
`transformedData` and the bytea sidecars never reach the SQL layer. The
plaintext column (which the lens deleted) defaults to NULL at the DB layer,
so even reading the row back doesn't surface the bug — it just looks like an
unwritten optional column.

**Why it bites:** The drop is invisible at runtime AND at type-check time.
Better Auth's TypeScript types accept any object on `data` (no exhaustiveness
constraint against the schema), so emitting unknown keys is type-clean. The
only way to detect the drop is end-to-end at the SQL layer — which is exactly
what the Phase 57 RED test does, and exactly what Phase 33's plan didn't.

### 3.3 "Compat sentinel without write-path plumbing" (defence-in-depth-of-imaginary-attack)

**Source / formal name:** Variant of "configuration drift" — declarative state
(migration 0025: nullable plaintext sentinel column + the comment "lens writes
NULL here") that is decoupled from runtime behaviour (lens does NOT write NULL
to that column because the lens never fires).

**Manifestation here:** Migrations 0024 + 0025 + the LOCKER-08 allowlist
(`tools/lint-no-plaintext-secret-columns.ts:109-117 LENS_INTROSPECTION_COMPAT`)
describe a post-lens-write world. The rationale comment at
`apps/api/src/auth.ts:124-159` describes the deferral honestly ("heavier than
the security benefit"). But the world the comment describes never came into
being — the lens was wrapped at the adapter seam, the map was left empty, and
the production INSERT still writes plaintext to the sentinel column. The
LOCKER-08 rationale comment is currently a documented lie (and the
deferred-items entry says so explicitly: "without [Fixes A+B] the existing
rationale comment would be a lie").

**Why it bites:** Future-maintainer effort gets wasted re-deriving the
runtime/declarative gap on every audit. Phase 57's RED test is the first artifact
that materializes the gap into a failing assertion; before it, every read of
the codebase concluded "looks like encryption is on" until someone queried the
table.

### 3.4 "Test-driven schema fix" — banned by CLAUDE.md hard rule 1

Adjacent antipattern: if a sub-agent reached for "edit the production lens to
ignore session.token so the test passes" or "drop the sidecar bytea column from
schema and use a single text column", that would be the canonical CLAUDE.md
violation. The HALT entry correctly refused. The proper fix is a production
architectural change with its own RED/GREEN cycle — exactly what Track A is
designed to become in a re-scoped Phase 57 or in Phase 58.

### 3.5 "Hand-maintained parallel list" — guaranteed drift (Fix B blocker)

**Source / formal name:** "DRY violation" (Hunt & Thomas, 1999); concrete
historical example: any project where `schema.sql` and a hand-maintained
`schema.json` lived side-by-side. The first commit that adds a column to one
and forgets the other reintroduces the bug class.

**Manifestation here (prospective if we go the naive Fix B):** Phase 33-05
notes (`auth.ts:345`) called out the "schema-side additionalFields declarations"
as deferred. Re-introducing them as 44 hand-typed entries means the very next
schema migration that adds (say) `oauth_state.code_verifier` to the lens — or
adds a new fingerprint column to an existing model — silently regresses unless
a reviewer remembers the parallel list. The codegen sketch in §2.4 closes the
gap permanently.

---

## 4. Better Auth Ecosystem Research

### What others have done

**Finding:** No public Better Auth user has shipped transparent envelope-encryption
of canonical model columns through the adapter seam, as of 2026-05-20.

Evidence:
- `better-auth.com/docs/adapters/drizzle` — no mention of adapter wrapping,
  encryption, or `additionalFields` for sidecar columns. (Verified WebFetch.)
- `better-auth.com/docs/guides/create-a-db-adapter` — discusses the `transaction`
  contract ("If `false`, operations run sequentially; otherwise provide a function
  that executes a callback with a `TransactionAdapter`") but gives no guidance on
  wrapping or intercepting an existing adapter. (Verified WebFetch.)
- GitHub issue search for "transparent column encryption adapter wrapper" against
  `better-auth/better-auth` returns zero matches; closest are #1027 (snake_case
  emailVerified casing), #3212 (custom column names), #5386 (drizzle adapter
  field-doesn't-exist), and #6779 (string[] additionalFields broken on pg ≥1.4.x).
- The Better Auth own "secret rotation" feature (rotating `BETTER_AUTH_SECRET`
  via the `secrets: []` versioned array, https://better-auth.com/blog/1-5 and
  https://better-auth.com/docs/reference/security) is application-data envelope
  encryption — it does NOT cover the columns Better Auth itself writes (password
  hash, OAuth tokens, session token, verification value).

### Known relevant Better Auth issues

| Issue | Relevance | Takeaway |
|-------|-----------|----------|
| https://github.com/better-auth/better-auth/issues/2098 — "before databaseHooks for creating objects do not respect returned object" | Hooks can't be relied on as the encryption seam | databaseHooks is NOT a safe alternative to adapter-decoration for this purpose |
| https://github.com/better-auth/better-auth/issues/4732 — "Defaulting Kysely `transaction` to true with 1.3.10+ breaks Cloudflare D1" | Confirms the v1.3.x→1.3.12 regression that walked-back default `transaction: true` | Drizzle adapter still defaults `transaction: false`; if we later enable it we need to confirm PgBouncer transaction mode compatibility |
| https://github.com/better-auth/better-auth/issues/4757 — v1.3.x maintenance plan | Documents the rollback decision | Future v1.4.x intends to opt-in transactions per-adapter; relevant when we upgrade past 1.6.9 |
| https://github.com/better-auth/better-auth/issues/4767 — "data in databaseHooks.session.update.before is limited compared to .create.before" | Hook surface area is asymmetric / unstable | Reinforces "lens at adapter seam, not at hook seam" decision |
| https://github.com/better-auth/better-auth/issues/9056 — "databaseHooks.user.create.before cannot override user ID when generateId: 'uuid' is used with PostgreSQL" | Before-hook returned data is partially-honored | Reinforces #2098: hooks not a reliable mutation seam |
| https://github.com/better-auth/better-auth/issues/7234 — "Drizzle Adapter breaks when using the Effect-based execution model" | Wider drizzle-adapter brittleness signal | Don't reach for Effect; stay on Promise path |
| https://github.com/better-auth/better-auth/issues/6779 — "string[] type in user.additionalFields is broken with Drizzle ORM + pg after 1.4.x update" | additionalFields drizzle path has known bugs on non-trivial types | Stick with `type: "string"` for sidecars (which is what we do); never `"json"` or array |
| https://github.com/better-auth/better-auth/issues/4305 — "CLI failing to generate Drizzle schema with Postgres" | CLI is unreliable for sidecar declaration | Our codegen idea avoids the BA CLI entirely — read directly from our schema |

### Better Auth's secret rotation envelope format ≠ ours

`BETTER_AUTH_SECRETS=[v1, v2, ...]` is the same SHAPE as our KEK rotation
(`KeyProvider[]` in `lens.ts:339`) but operates at a DIFFERENT layer: Better
Auth's envelope wraps application-data (session payloads, verification tokens
encoded into JWTs) BEFORE handing to the adapter; our lens wraps the adapter's
view of credential columns. They're complementary: rotating
`BETTER_AUTH_SECRETS` does not re-encrypt at-rest password hashes; rotating
`MASTER_KEK` does.

### `transaction: true` on the drizzle adapter — current status

Phase 57's GREEN must NOT depend on enabling `transaction: true` in the
drizzleAdapter config, because:

1. PgBouncer transaction-mode + drizzle's `db.transaction(tx => ...)` is a
   known sharp edge (server-side prepared statements + multi-statement
   transactions); see issue #4732 narrative. We run PgBouncer transaction
   mode (`pgbouncer.ini` POOL_MODE=transaction).
2. The lens fix in §2.1 works correctly whether `transaction: false` (current
   `createAsIsTransaction` path: trx == adapter, our wrap re-wraps the adapter
   for the cb scope) or `transaction: true` (real db.transaction: cb receives
   the freshly-built factory adapter over `tx`, our wrap re-wraps it). The fix
   doesn't depend on the toggle.

---

## 5. Recommended approach for Fix A (lens-on-transaction)

### Candidate options

**Option A1 — Wrap `transaction` to re-wrap the trx-bound adapter (RECOMMENDED).**

```ts
// packages/data/src/encryption/lens.ts:443
transaction: (cb) =>
  inner.transaction(async (trx) =>
    cb(wrapAdapter(trx, providers, columnMap))
  ),
```

Trade-offs:
- **Pro:** One-line change; structurally aligns the decorator contract;
  works for both `transaction: false` (`createAsIsTransaction`) and
  `transaction: true` (real drizzle trx) without conditionals; matches the
  "decorator must intercept every method" §2.1 invariant; trivially testable.
- **Pro:** No need to register sidecar columns with Better Auth at all — wait,
  actually no: we still need Fix B because `transformInput` (inside the inner
  factory.create) still drops unknown keys. Fix A alone is necessary-not-sufficient.
- **Con:** Creates a fresh wrapAdapter object per transaction (allocation cost
  is one closure + 9 method bindings — negligible vs. the transaction itself).
- **Con:** If `inner.transaction` is `false` (the literal value, not a function;
  technically allowed by Better Auth's adapter contract per
  `docs/guides/create-a-db-adapter`), the call fails. Defend with a runtime
  guard: `if (typeof inner.transaction !== "function") throw ...`. The drizzle
  adapter always provides a function (verified at `drizzle-adapter/dist/index.mjs:442`),
  so this is paranoia, not a real blocker.

**Option A2 — Pre-wrap and store: hold a single trx-wrapped adapter via closure rebinding.**

Instead of wrapping inside `cb`, swap the `inner` reference in our wrap factory
to a Proxy that delegates to either the original inner or a trx-bound inner
based on an ALS-resolved current trx.

Trade-offs:
- **Pro:** Avoids re-allocating wrap on every transaction.
- **Con:** Re-implements `@better-auth/core/dist/context/transaction.mjs` in
  our package; couples our lens to Better Auth's internal ALS storage handle
  (`__getBetterAuthGlobal().context.adapterAsyncStorage`); fragile across BA
  version bumps. **Reject.**

**Option A3 — Move encryption from adapter-decorator to drizzle-level layer (a Drizzle Studio middleware or per-column codec).**

Trade-offs:
- **Pro:** Decouples from Better Auth entirely; works for any other module that
  hits the same tables (none today, but future-proofing).
- **Con:** Drizzle ORM does not expose a stable middleware API (as of drizzle-orm
  0.45.2). The closest is per-column `transform` in custom column builders,
  which doesn't have access to the KeyProvider chain or the model context.
  Re-implementing the lens at this layer is a multi-week refactor with its own
  surface of bugs; LOCKER-PLAINTEXT-COLS BLOCKING gate makes this riskier than
  the one-line A1. **Reject for Phase 57.** Consider for Phase 60+ if we add
  non-Better-Auth modules that read/write the same tables.

### Recommendation: **Option A1**

The fix is exactly what `.planning/deferred-items.md` lines 28–33 proposed.
No deviation needed. Add the runtime guard for `typeof inner.transaction !== "function"`
to keep behaviour deterministic if a future adapter declares it as `false`.

### Acceptance test shape (beyond the existing RED canary)

The existing `better-auth-envelope-at-rest.test.ts` proves end-to-end correctness
for sign-up/sign-in. Add a tighter unit-level regression to catch the specific
class of bug:

**`packages/data/tests/unit/lens-on-transaction.test.ts`** (new):

```ts
it("transaction wraps the inner trx adapter with the same lens before als.run", async () => {
  const seenAdapters: DBAdapter[] = [];
  const fakeInner: DBAdapter = {
    id: "test",
    transaction: async (cb) => cb(fakeInner),  // createAsIsTransaction shape
    create: async (args) => {
      seenAdapters.push(/* current adapter */ fakeInner);
      return args.data as never;
    },
    // ... stubs for the other methods ...
    options: {} as never,
  };
  const wrapped = wrapAdapter(fakeInner, makeStubProvider(), {
    user: { secret: { sidecarPrefix: "secret" } },
  });

  let receivedInsideTrx: DBAdapter | null = null;
  await wrapped.transaction(async (trx) => {
    receivedInsideTrx = trx;
    await trx.create({ model: "user", data: { secret: "hello" } });
  });

  expect(receivedInsideTrx).not.toBe(fakeInner);     // must NOT be the inner adapter
  expect(receivedInsideTrx?.create.name).not.toBe(fakeInner.create.name); // wrapped
  // and the create call must have invoked encryptColumns —
  // assert via a tracer KeyProvider that recorded a wrapDek call
});
```

This test would have caught the bug at PR time; the e2e test only catches it
once Postgres is in the loop.

---

## 6. Recommended approach for Fix B (additionalFields ergonomics)

### Candidate options

**Option B1 — Codegen from `ENCRYPTED_COLUMNS_MAP` at module load (RECOMMENDED).**

See §2.4 code sketch. `deriveSidecarAdditionalFields(ENCRYPTED_COLUMNS_MAP.<model>)`
materializes the 6 sidecar entries (+ optional fp) per encrypted column. One
function, ~20 LOC. Called inline at the `betterAuth({ user: {...}, account: {...}, ...})`
construction site.

Trade-offs:
- **Pro:** Single source of truth; adding a new encrypted column = one line in the map.
- **Pro:** No drift possible by construction; the registration is a pure function of the map.
- **Pro:** Type-system can verify the `EncryptedColumnMap` shape; the derivation
  is a value-level transform with full type coverage.
- **Con:** Sidecar entries are emitted in TS-field (camelCase) form to match
  Better Auth's `transformInput` keying (`factory.mjs:107`). The lens already
  emits camelCase keys at `lens.ts:158-160` for the same reason. No new concern.
- **Con:** Fingerprint column types — currently they're `bytea` columns but
  Better Auth `additionalFields` only accepts `"string"|"number"|"boolean"|"date"|...`
  per `core/dist/db/type.d.mts`. Use `type: "string"` for fp too — the lens
  produces a `Buffer` value which the drizzle adapter accepts on the bytea
  column regardless of the BA type declaration. Issue #6779 cautions against
  non-trivial types — `"string"` is the safe choice.

**Option B2 — Hand-list all 44 entries with a regression test.**

Trade-offs:
- **Pro:** Trivial to write today; explicit declaration is easy to grep.
- **Con:** Guaranteed drift on the next added encrypted column (§3.5 antipattern).
  Lint rule could enforce parity, but lint is harder than codegen.
- **Reject.**

**Option B3 — Patch Better Auth core to add an `acceptUnknownFields` flag per model.**

Trade-offs:
- **Pro:** Upstream-correct.
- **Con:** Forks Better Auth; PR cycle is months; LOCKER-PLAINTEXT-COLS gate
  is BLOCKING from day one. **Reject for Phase 57.** Consider as an upstream
  contribution after Phase 57 ships.

### Recommendation: **Option B1**

Codegen. Single source of truth. The implementation is the §2.4 sketch.

### Drift-prevention test (new)

**`apps/api/tests/unit/additional-fields-derive.test.ts`** (new):

```ts
// Asserts: for every (model, col) in ENCRYPTED_COLUMNS_MAP, the corresponding
// betterAuth({...}) config has the 6 camelCase sidecar fields declared as
// additionalFields with input:false. If a future commit adds a column to the
// map but the derivation is bypassed (someone hand-edits additionalFields and
// the auto-derive is removed), this test fails.

for (const [model, cols] of Object.entries(ENCRYPTED_COLUMNS_MAP)) {
  for (const [col, cfg] of Object.entries(cols)) {
    for (const k of SIDECAR_KEYS) {
      const field = toCamel(`${cfg.sidecarPrefix}_${k}`);
      expect(authConfig[model].additionalFields[field]).toMatchObject({
        type: "string", required: false, input: false,
      });
    }
    if (cfg.fingerprint) {
      const fp = toCamel(cfg.fingerprint.column);
      expect(authConfig[model].additionalFields[fp]).toMatchObject({
        type: "string", required: false, input: false,
      });
    }
  }
}
```

### Defence-in-depth: schema-to-allowlist parity lint (LOCKER candidate)

Open a LOCKER-09 candidate in `.planning/deferred-items.md` (do not add it to
Phase 57 scope — out-of-scope per the phase's "out_of_scope" list, but record):

`tools/lint-sidecar-additional-fields-parity.ts` — walks
`packages/data/src/schema/*.ts`, finds every column matching the sidecar regex
(`/_(dek_(wrapped|iv|auth_tag)|value_(iv|auth_tag|ciphertext)|fp)$/`), and
asserts that for the host model's Better Auth name, the corresponding
camelCase key appears in `additionalFields`. Catches the case where someone
adds a sidecar column to the schema without registering it.

---

## 7. Test Strategy

| Test layer | File | What it catches | Status |
|------------|------|-----------------|--------|
| Unit — lens.transaction wraps trx | `packages/data/tests/unit/lens-on-transaction.test.ts` | Future revert of Fix A | NEW (Phase 57) |
| Unit — additionalFields drift | `apps/api/tests/unit/additional-fields-derive.test.ts` | Hand-edit removes auto-derive | NEW (Phase 57) |
| Integration — e2e envelope at rest | `apps/api/tests/integration/better-auth-envelope-at-rest.test.ts` | Either Fix A OR Fix B regression, end-to-end | EXISTS (RED today) |
| Property — wrapped-trx invariant | `packages/data/tests/property/wrap-adapter-transaction.test.ts` | Any future adapter wrap that forgets to re-wrap trx | NEW (Phase 57 OR 58) |
| Lint LOCKER-09 candidate | `tools/lint-sidecar-additional-fields-parity.ts` | Sidecar column added to schema but not registered | DEFERRED (Phase 58+) |

**Property test sketch** (the "any wrapped adapter passes wrapped trx to als.run"
invariant from the prompt):

```ts
import fc from "fast-check";

it("for every adapter wrap that intercepts create, the trx-bound adapter inside transaction(cb) must also intercept create", () => {
  fc.assert(fc.property(fc.func(/* random data shapes */), async (input) => {
    const tracer = makeTracingAdapter();
    const wrapped = wrapAdapter(tracer, stubProvider, { user: { secret: { sidecarPrefix: "secret" } } });
    await wrapped.transaction(async (trx) => {
      await trx.create({ model: "user", data: { secret: "x" } });
    });
    // Every create observed at the tracer must have had `secret` ALREADY
    // encrypted (i.e., absent from data + sidecars present)
    for (const call of tracer.observedCreateCalls) {
      expect(call.data.secret).toBeUndefined();
      expect(call.data.secret_value_ciphertext).toBeInstanceOf(Buffer);
    }
  }));
});
```

---

## 8. Doctrine: transparent-encryption adapters in this codebase

> This section is the durable guidance the prompt asked for. It is meant to be
> referenced verbatim by future plans whose scope intersects adapter-decoration,
> encryption-at-rest, or any 3rd-party library with a `transaction` or
> ALS-bound primitive.

**1. Decorator contract is total or it is broken.** Any wrap of a 3rd-party
adapter, repository, DAO, or DBAdapter MUST intercept EVERY method on the
interface, INCLUDING transaction primitives. `inner.transaction.bind(inner)`
is a code smell — flag it on review. The trx-bound argument that the
transaction primitive passes to its callback MUST be re-wrapped with the same
decorator before forwarding, OR the wrap's invariants do not hold inside the
transaction.

**2. ALS-bound context is the canonical seam-jumping trap.** When a library
binds a value into AsyncLocalStorage (Better Auth, OpenTelemetry, fastify
request context, etc.) and then reads it back from deeply-nested code, the
value placed into the storage MUST be the wrapped variant. A decorator that
forwards the underlying primitive verbatim to a context manager defeats itself.

**3. Field-allowlist boundaries demand auto-generation, not hand-listing.**
Any registration table that mirrors data the application already owns (Better
Auth's `additionalFields`, GraphQL schema's `@auth` directives, similar) MUST
be derived from the canonical source at module load. Hand-listed parallel
state is drift-by-default; the codegen pattern is drift-free by construction.

**4. Defence-in-depth via runtime assertion + lint, not via comment.** When a
schema column exists to support a runtime invariant (sentinel column,
sidecar, audit trail), a lint rule or boot-time assertion MUST detect when
the runtime that should write/null/check that column has been bypassed or
removed. Rationale comments age; assertions stay green or fire.

**5. End-to-end-at-the-storage-layer test for every encryption-lens consumer.**
A unit test on the lens proves the lens encrypts. An integration test against
real Postgres proves the bytes at rest are ciphertext. The two are
complementary; ship BOTH for any new module/route/plugin that introduces a
new encrypted column. Pattern:
- Unit: `lens-*.test.ts` against a mock-store adapter.
- Integration: `*-envelope-at-rest.test.ts` against testcontainers Postgres,
  asserts plaintext column IS NULL and sidecars are populated.

**6. Property test the wrap-transaction invariant on first introduction.**
For every adapter-wrapping module, ship a property test that — given any
sequence of operations including transactions — every operation routes
through the wrap. This catches the §3.1 antipattern by construction for
future wraps.

**7. `transaction: true` on the drizzle adapter is opt-in only.** Until
PgBouncer transaction-mode interaction is validated end-to-end (load test
with the BA flag enabled), keep `transaction: false` on the drizzle adapter
config. Track upgrading as a separate phase tied to BA v1.4.x+ upgrade. The
lens fix in this doctrine works regardless of the flag.

**8. Better Auth `databaseHooks` is NOT a safe encryption seam.** Issues
#2098 and #9056 prove the hook's return-data contract is partially honoured.
The adapter-decoration seam is the only seam with the right type contract and
the right call-frequency guarantees.

---

## 9. References

### Primary sources (HIGH confidence — read from installed `node_modules`)

- `node_modules/.pnpm/@better-auth+core@1.6.9.../dist/context/transaction.mjs:52-78` — `runWithTransaction` definition; `als.run({ adapter: trx, ... }, fn)` binds the cb-supplied trx, not the outer adapter.
- `node_modules/.pnpm/@better-auth+core@1.6.9.../dist/context/transaction.mjs:20-26` — `getCurrentAdapter()` reads `als.getStore()?.adapter` first.
- `node_modules/.pnpm/@better-auth+core@1.6.9.../dist/db/adapter/factory.mjs:17` — `createAsIsTransaction = (adapter) => (fn) => fn(adapter)` (the "no real transaction" path when `config.transaction === false`).
- `node_modules/.pnpm/@better-auth+core@1.6.9.../dist/db/adapter/factory.mjs:98-140` — `transformInput` only forwards `schema[model].fields` keys.
- `node_modules/.pnpm/@better-auth+core@1.6.9.../dist/db/adapter/factory.mjs:401-408` — `transaction:` exposed on the factory adapter.
- `node_modules/.pnpm/@better-auth+core@1.6.9.../dist/db/get-tables.mjs:73, 125, 172, 255` — `additionalFields` is merged into `schema[model].fields` per model (user/session/account/verification).
- `node_modules/.pnpm/@better-auth+drizzle-adapter@1.6.9.../dist/index.mjs:442-447` — `transaction: config.transaction ?? false ? ... : false` — drizzle adapter defaults to no-real-trx.
- `node_modules/.pnpm/better-auth@1.6.9.../dist/api/routes/sign-up.mjs:141` — sign-up handler wraps the entire flow in `runWithTransaction(ctx.context.adapter, ...)`.
- `node_modules/.pnpm/better-auth@1.6.9.../dist/db/with-hooks.mjs:25` — `(await getCurrentAdapter(adapter)).create(...)` — every hooked create reads the ALS adapter.

### In-repo evidence (HIGH confidence — read from working tree)

- `packages/data/src/encryption/lens.ts:337-447` — `wrapAdapter` definition; line 443 is the broken `transaction: inner.transaction.bind(inner)`.
- `packages/data/src/encryption/lens.ts:118-160` — `SIDECAR_KEYS` + `toCamel` + `sidecarFieldNameCamel`; emits both snake_case AND camelCase sidecar keys.
- `apps/api/src/auth.ts:124-160` — empty `ENCRYPTED_COLUMNS_MAP` with rationale comment (now a known lie per `.planning/deferred-items.md`).
- `apps/api/src/auth.ts:346-374` — `database:` block: drizzleAdapter factory → wrapAdapter wrap, with no `transaction: true` config.
- `apps/api/src/auth.ts:388-419` — example `additionalFields` for `user.locale` and `user.role` (the working precedent for the §2.4 codegen pattern).
- `apps/api/tests/integration/better-auth-envelope-at-rest.test.ts` — the canonical RED reproduction (committed in c672e1f).
- `packages/data/src/schema/{accounts,sessions,verifications}.ts` — 44 sidecar bytea columns (verified count: 27 + 13 + 6 = 46 raw matches; minus 2 duplicates per `tokenFp` declared but matched twice; net 44 distinct `_dek_*` / `_value_*` columns).
- `.planning/deferred-items.md` lines 14-44 — the HALT entry that defines this research's brief.

### Secondary sources (MEDIUM confidence — WebFetch / WebSearch verified against Better Auth docs)

- https://better-auth.com/docs/adapters/drizzle — Drizzle adapter docs; no transaction/wrap/encryption guidance.
- https://better-auth.com/docs/guides/create-a-db-adapter — adapter contract docs; transaction defined as "`false` or function (cb → TransactionAdapter)".
- https://better-auth.com/docs/concepts/database — databaseHooks reference (user/session/account; verification unmentioned).
- https://better-auth.com/blog/1-5 — Better Auth 1.5 secret-rotation envelope feature (separate layer from ours).
- https://better-auth.com/docs/reference/options — `additionalFields` API surface.

### Tertiary sources (LOW confidence — pattern references)

- Gamma, Helm, Johnson, Vlissides, *Design Patterns* (1994) — Decorator chapter.
- Hunt & Thomas, *The Pragmatic Programmer* (1999) — DRY (§11).
- https://refactoring.guru/design-patterns/decorator — Decorator TS example.
- https://github.com/47ng/prisma-field-encryption — Prisma equivalent; `$use` middleware → `$extends` migration.
- https://github.com/Aliheym/typeorm-transactional — Node ALS transaction-context propagation reference implementation.
- https://github.com/prisma/prisma/issues/5729 — ALS-for-transactions design discussion.
- https://thorben-janssen.com/how-to-use-jpa-type-converter-to/ — JPA AttributeConverter encryption pattern.
- https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors — EF Core interceptor pattern.
- https://docs.aws.amazon.com/database-encryption-sdk/latest/devguide/ddb-java-using.html — DynamoDB AttributeActions.

### Better Auth issues cited

- https://github.com/better-auth/better-auth/issues/2098 — before-hook return-data not honored.
- https://github.com/better-auth/better-auth/issues/4732 — Kysely `transaction: true` 1.3.x regression.
- https://github.com/better-auth/better-auth/issues/4757 — v1.3.x maintenance plan.
- https://github.com/better-auth/better-auth/issues/4767 — session.update.before payload is partial.
- https://github.com/better-auth/better-auth/issues/9056 — before-hook can't override user.id on PG+uuid.
- https://github.com/better-auth/better-auth/issues/7234 — Effect-based execution model breaks drizzle adapter.
- https://github.com/better-auth/better-auth/issues/6779 — `string[]` additionalFields broken on pg ≥1.4.x.
- https://github.com/better-auth/better-auth/issues/4305 — CLI fails to generate drizzle schema on Postgres.

---

## 10. Metadata

**Confidence breakdown:**

- §1 Problem statement: **HIGH** — every code path verified in `node_modules` with file:line; matches `.planning/deferred-items.md` Phase 57 HALT diagnostic.
- §2 Named patterns: **HIGH** for our applicability conclusions (the lens fix mirrors decorator-pattern textbook guidance); **MEDIUM** for the comparison table to other ORMs (verified via docs WebSearch but not exhaustively).
- §3 Antipatterns: **HIGH** — each manifestation cited to file:line.
- §4 BA ecosystem research: **HIGH** for the "no public prior art" finding (verified by negative searches against BA docs + GH issues); **MEDIUM** for individual cited issues (titles checked, full threads not all read).
- §5 Fix A recommendation: **HIGH** — Option A1 is the deferred-items proposal; the unit-test design is straightforward.
- §6 Fix B recommendation: **HIGH** — codegen is mechanical, derives 44 entries from 7 column declarations.
- §7 Test strategy: **HIGH** for the four canonical tests; **MEDIUM** for the LOCKER-09 lint shape (sketched, not implemented).
- §8 Doctrine: **HIGH** — restates verified findings as durable rules.

**Research date:** 2026-05-20.
**Valid until:** Better Auth v1.7.x release (the `transaction` contract or `runWithTransaction` ALS shape changes upstream would invalidate §1 / §2.2). Estimate 60–90 days; check on next BA bump.

**Out-of-scope reminder:** This research drives Track A only. Tracks B–F of Phase 57 are independent and not addressed here.
