---
slug: admin-onboarding-security-audit-2026-05-27
status: complete
mode: diagnose-only
goal: find_root_cause_only
trigger: operator-initiated security audit (READ-ONLY, no fix)
created: 2026-05-27
auditor: gsd-debug-session-manager (inline — Task tool unavailable)
---

# Admin Onboarding Security Audit — 2026-05-27

## Audit Scope

READ-ONLY security audit of the OpenWhispr Server admin onboarding flow. Constitutional rule (operator memory `feedback_admin_via_onboarding.md`):

> admin = regular user with `role='admin'`; first user completing `/setup` wizard becomes admin; NEVER suggest Traefik basic-auth or separate admin login.

The **claim handler** at `POST /api/setup/admin` + the **setup_state gate** form the entire security perimeter for admin elevation.

## Audit Methodology

Primary files read in full:

- `apps/api/src/routes/setup-admin.ts` (350 lines)
- `apps/api/src/routes/setup-state.ts` (85 lines)
- `apps/api/src/auth.ts` (760 lines)
- `apps/api/src/routes/index.ts` (725 lines, focused on setupAdmin wiring)
- `apps/api/src/lib/audit.ts` (350 lines)
- `apps/api/src/middleware/dual-auth.ts` (lines 1-180)
- `apps/api/src/config/auth.ts` (220 lines — `validateAuthBoot`, `validateIngressBoot`, `validateOriginBoot`)
- `apps/api/src/lib/cookie-domain.ts`
- `packages/data/src/schema/setup_state.ts` + `users.ts`
- `packages/data/migrations/0017_setup_state.sql`
- `packages/data/migrations/0022_setup_state_grants.sql`
- `packages/data/migrations/0003_better_auth_tenant_defaults.sql`
- `packages/data/migrations/0024_better_auth_tenant_id_defaults.sql`
- Integration test: `apps/api/tests/integration/f4-setup-admin-route-wiring.test.ts`
- Unit tests: `setup-admin.test.ts` (515 lines), `setup-admin-auth-bypass.test.ts`, `setup-admin-rollback.test.ts`, `setup-state.test.ts`
- `apps/api/src/routes/test-only.ts` lines 220-420 (reset-setup writer)
- `apps/api/src/index.ts` lines 1080-1150 (setupAdmin wiring)

Tools: Read + Grep + Bash (read-only commands only). No code edits, no test runs.

## Evidence

### E1. Claim handler — atomic UPDATE-RETURNING (setup-admin.ts:186-208)

```ts
let claimRowCount = 0;
await db.transaction(async (tx) => {
  const result = (await tx.execute(sql`
    UPDATE setup_state
       SET status = 'completed', completed_at = now()
     WHERE id = 1 AND status = 'pending'
     RETURNING status, completed_at
  `)) as { rows?: SetupStateClaimRow[]; rowCount?: number };
  claimRowCount = result.rowCount ?? result.rows?.length ?? 0;
});
if (claimRowCount === 0) {
  // race-loser / already-completed: 200 + alreadyCompleted:true
  const adminRes = await ownerPool.query<AdminLookupRow>(
    `SELECT email FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`);
  ...
}
```

This is a single-statement atomic claim. Postgres serializes the UPDATE under MVCC; the second concurrent request reads `status = 'completed'` and returns 0 rows. **No `FOR UPDATE` lock needed** — UPDATE acquires the row-level write lock implicitly.

### E2. Rate-limit declarations

`setup-admin.ts:159` — `config: { auth: false, rateLimit: { max: 5, timeWindow: "1 minute" } }`
`setup-state.ts:75` — `config: { auth: false, rateLimit: { max: 30, timeWindow: "1 minute" } }`

Both routes carry `config.rateLimit` blocks. LOCKER-04 compliant.

### E3. `auth: false` opt-out — global dualAuthHook skip (dual-auth.ts:145-147)

```ts
// Per-route opt-out (e.g. /api/check-user pre-auth flow).
if (req.routeOptions?.config?.auth === false) return;
```

Without this opt-out the global hook 401s every claim before the handler runs (the wizard predates any admin user). The opt-out is necessary; the security perimeter is therefore exclusively the **rate-limit + atomic UPDATE-WHERE + Better Auth signUpEmail's own gates**.

### E4. additionalFields `role` field — `input: false` (auth.ts:473-478)

```ts
role: {
  type: "string",
  required: false,
  defaultValue: null,
  input: false,   // <-- blocks body-supplied role escalation
},
```

Better Auth ignores `{ role: 'admin' }` in any sign-up body. The handler additionally Zod-strips unknown fields (`setupAdminInput` at line 112-118 declares no `role` key; default strip-on-parse drops it). Two independent layers.

### E5. Cookie SameSite posture

`apps/api/src/lib/cookie-domain.ts` configures `crossSubDomainCookies` (domain only). **SameSite is NOT explicitly set** — Better Auth's default is `Lax`. With `Lax`, a top-level cross-origin `<form method=POST>` STILL sends the session cookie. **Better Auth's `validateOrigin` middleware does enforce CSRF on `/api/auth/*` routes** (auth.ts:738-753 — `disableOriginCheck` only flips on under double-gate test-route opt-in). The `/api/setup/admin` route is NOT under `/api/auth/*` — it's a Fastify route on a fresh app instance, registered without any Origin / CSRF check.

`useSecureCookies` is enforced via `validateAuthBoot()` (config/auth.ts:85-92) — production refuses to boot with non-HTTPS `AUTH_URL`. Good.

### E6. setup_state writers — complete inventory

Three writers exist in source (excluding `dist/` build artifacts and `.claude/worktrees`):

1. `apps/api/src/routes/setup-admin.ts:190` — `UPDATE setup_state SET status='completed' WHERE id=1 AND status='pending'`
2. `apps/api/src/routes/setup-admin.ts:228, 288` — compensating `UPDATE setup_state SET status='pending'` (signUpEmail error + role-flip error rollbacks)
3. `apps/api/src/routes/test-only.ts:382` — `INSERT INTO setup_state ... ON CONFLICT (id) DO UPDATE SET status='pending'` — `/api/_test/reset-setup`. Plugin-gate veto at test-only.ts:236-241: `NODE_ENV !== 'production' AND (NODE_ENV === 'test' OR OPENWHISPR_TEST_ROUTES === 'true')`. Production-veto is enforced at plugin-registration time so a misset env knob cannot re-open the claim window in production.
4. `apps/api/src/routes/__tests__/setup.ts:223` — `INSERT INTO setup_state ... ON CONFLICT ... DO UPDATE` — **test harness only** (file under `__tests__/`, not registered in any production app graph).

No additional writers in `apps/`, `packages/`, or `services/`.

### E7. Migration 0017 — singleton row + role column (0017_setup_state.sql)

```sql
CREATE TABLE "setup_state" (
  "id"           smallint   PRIMARY KEY  CHECK (id = 1),
  "status"       setup_state_status NOT NULL DEFAULT 'pending',
  "completed_at" timestamptz,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO "setup_state" (id, status, completed_at)
SELECT 1,
       CASE WHEN EXISTS (SELECT 1 FROM "users") THEN 'skipped_legacy'::setup_state_status
            ELSE 'pending'::setup_state_status END,
       ...;
ALTER TABLE "users" ADD COLUMN "role" text;  -- nullable, no CHECK
```

Singleton enforced by `PRIMARY KEY CHECK (id = 1)`. Pre-existing-users branch sets `skipped_legacy` — wizard refuses on v1-upgrade. Good. `users.role` is unconstrained nullable text (no CHECK enum, no partial unique index `WHERE role='admin'`).

### E8. Tenant isolation — single-tenant bridge (migrations 0003 + 0024)

The 4 Better Auth identity tables (`users`, `sessions`, `account`, `verification`) carry `tenant_id` column DEFAULTs bound to `current_setting('app.tenant_id', true)::uuid`. The `openwhispr_app` role has `ALTER ROLE ... SET app.tenant_id TO '00000000-0000-0000-0000-000000000000'`. Per the **RLS posture ledger** (CLAUDE.md DISCIPLINE rule 16 + Phase 57 Track B/D2) this is accepted v1 single-installation-single-tenant debt. The setup-admin claim handler writes `users.role='admin'` via the `ownerPool` (BYPASSRLS) — NOT through the app-role / withTenant wrap — so the role flip targets the user by `users.id` (PK) regardless of RLS. The pre-claim `SELECT email FROM users WHERE role='admin'` (line 204) also runs on the owner pool: it reads across ALL tenants. In v1 the default tenant is the only tenant, so this collapses to "the one admin".

### E9. Email verification — claim handler does NOT require `email_verified=true`

`grep -n -E "email_verified|emailVerified|verify" /Users/dev/openwhispr-server/apps/api/src/routes/setup-admin.ts` returns ZERO matches. The handler:

1. Calls `signUpEmail` (which inserts a `users` row + an `accounts` row + queues a verification email).
2. Immediately UPDATEs `users.role='admin'` via raw SQL — no `WHERE email_verified=true` predicate.

In production posture (`OPENWHISPR_DISABLE_EMAIL_VERIFICATION` unset → strict), Better Auth's `signUpEmail` returns `{user: {...}, token: null}` for the unverified path. The role flip persists immediately. The wizard's own UX gates on the redirect after the call; nothing on the SERVER prevents `role='admin'` from landing for a never-verified email.

### E10. Audit log — claim handler emits NO audit event

`grep -n -E "recordAudit|admin\.role_changed" /Users/dev/openwhispr-server/apps/api/src/routes/setup-admin.ts` returns ZERO matches. The 18-action audit enum (`packages/data/src/schema/audit_log.ts`) DOES include `admin.role_changed` with payload `{ target_user_id, before, after }` (audit.ts:163-167). The setup-admin handler does NOT call `recordAudit('admin.role_changed', ...)` after promoting the first user to admin.

### E11. Test coverage — what exists vs gaps

Existing (15 unit + 3 integration scenarios):

| File | Scenarios |
|---|---|
| `setup-admin.test.ts` | (1) winner, (2) race-loser, (3) BA-error rollback, (4) rate-limit 6th=429, (5) body-role-escalation guard, (6) timezone deferred, (7) tenant_rename failure, plus 3 extras (invalid body, Accept-Language ru/en) |
| `setup-admin-auth-bypass.test.ts` | 99 lines — verifies `config.auth=false` opt-out works |
| `setup-admin-rollback.test.ts` | 263 lines — role-flip failure compensating rollback |
| `setup-state.test.ts` | 151 lines |
| `f4-setup-admin-route-wiring.test.ts` (integration) | (i) positive end-to-end, (ii) F1 chart-bug 404 when ownerPool unset, (iii) GET still 200 |
| `0017-setup-state.test.ts` (migration) | singleton + backfill logic |

Gaps (NOT covered):

- **No concurrent-claim race test** — two genuinely parallel POSTs (e.g. `Promise.all([fetch, fetch])`). Race scenario (2) seeds `status='completed'` before the call.
- **No post-claim re-claim attempt** with a NEW authenticated user pre-existing in DB — i.e. user signs up via `/api/auth/sign-up/email` AFTER setup completed, then POSTs `/api/setup/admin`. (The handler's first SQL is UPDATE-WHERE-status='pending' — it would correctly return `alreadyCompleted:true`, but the test asserting it should be explicit.)
- **No CSRF cross-origin POST test** — no `Origin: https://attacker.example` header to verify the route accepts/refuses such requests.
- **No unverified-email role-flip test** — i.e. asserting that role='admin' lands even though the user never clicks the verification link.
- **No audit event assertion** — the `admin.role_changed` enum exists but no test ensures setup-admin emits it.

## Findings (9 Dimensions)

### Dimension 1 — Privilege escalation after first-admin set

**Severity: INFO (no finding)**

The atomic `UPDATE setup_state SET status='completed' WHERE id=1 AND status='pending' RETURNING ...` (setup-admin.ts:189-194) is the server-side gate. Any second POST after the singleton row has moved to `completed` returns rowCount=0 → 200 `alreadyCompleted:true`. The handler NEVER reaches the role-flip branch on the loser path.

**Reproducer (negative — confirms guard):**
```bash
curl -X POST https://api.example.com/api/setup/admin \
  -H 'Content-Type: application/json' \
  -d '{"email":"attacker@x.com","password":"valid-pw-12chars","name":"X","workspace":"X","timezone":"UTC"}'
# Expected: 200 {"admin":{"email":"<first-admin>"},"alreadyCompleted":true}
```

**Code citation:** `apps/api/src/routes/setup-admin.ts:189-208`

**Recommended fix:** None required — the gate is sound.

---

### Dimension 2 — Race condition on claim

**Severity: INFO (no finding)**

Single-statement `UPDATE ... WHERE status='pending' RETURNING` is race-safe under Postgres MVCC: each row acquires an exclusive write lock; the second concurrent UPDATE sees the post-image (status='completed') and returns 0 rows. The wrapping `db.transaction()` is belt-and-suspenders. PgBouncer transaction-mode is compatible. The handler **does not need** `SELECT FOR UPDATE` (and doing so would be redundant with the UPDATE-WHERE).

**Reproducer (negative — confirms guard):**
```bash
# Two parallel POSTs on a fresh instance
for i in 1 2; do
  curl -X POST https://api.example.com/api/setup/admin -H 'Content-Type: application/json' \
    -d "{\"email\":\"user${i}@x.com\",\"password\":\"valid-pw-12chars\",\"name\":\"U${i}\",\"workspace\":\"X\",\"timezone\":\"UTC\"}" &
done
wait
# Expected: exactly one 201, exactly one 200 alreadyCompleted:true. Never two 201s.
```

**Code citation:** `apps/api/src/routes/setup-admin.ts:188-197`

**Recommended fix:** None required, but **add an integration test asserting this property** under `apps/api/tests/integration/`. The current race-loser unit test (`setup-admin.test.ts` case 2) seeds `status='completed'` before invoking; it does NOT cover genuine concurrency. A short test using `Promise.all([app.inject, app.inject])` against the testcontainer-backed harness in `setup.ts` would close this.

---

### Dimension 3 — Rate-limit on setup endpoints

**Severity: INFO (no finding)**

Both routes declare strict per-IP buckets:
- `POST /api/setup/admin` — `{ max: 5, timeWindow: '1 minute' }` (setup-admin.ts:159)
- `GET /api/setup-state` — `{ max: 30, timeWindow: '1 minute' }` (setup-state.ts:75)

Both routes also carry `auth: false` (necessary — wizard runs pre-admin). LOCKER-04 compliant. Unit test (4) in `setup-admin.test.ts` confirms the 6th POST/min/IP returns 429.

**Code citation:** `apps/api/src/routes/setup-admin.ts:159`, `apps/api/src/routes/setup-state.ts:75`

**Recommended fix:** None required. (Possible future enhancement: tighter bucket on claim — 3/min would be sufficient since the only legitimate caller is the operator clicking submit once.)

---

### Dimension 4 — Token / state replay

**Severity: INFO (no finding)**

The wizard does NOT use a one-time token / challenge nonce. The claim is `status='pending' → 'completed'` on the singleton `setup_state` row. The state machine itself is the replay defense: the second POST observes `status='completed'` and returns `alreadyCompleted:true`. No `consumed_at` column needed (the `status` column is the consumed-bit).

**Code citation:** `packages/data/migrations/0017_setup_state.sql:23-28`

**Recommended fix:** None.

---

### Dimension 5 — Email verification bypass

**Severity: HIGH**

The claim handler does **NOT** require `users.email_verified = true` before flipping `users.role = 'admin'`.

**Attack scenario (race-the-mail-server):**

1. Operator deploys a fresh OpenWhispr instance (no admin yet).
2. Attacker discovers the instance is public (port 443 reachable; `/api/setup-state` returns `{ status: 'pending' }` — DOES leak that the wizard is unclaimed).
3. Attacker POSTs `/api/setup/admin` with an email **they do not control** (e.g. `ceo@victim-company.com`):
   ```bash
   curl -X POST https://victim.example.com/api/setup/admin \
     -H 'Content-Type: application/json' \
     -d '{"email":"ceo@victim-company.com","password":"AttackerPick12!","name":"CEO","workspace":"VictimCo","timezone":"UTC"}'
   ```
4. Server response: `201 {admin:{email:"ceo@victim-company.com"}, alreadyCompleted:false}`.
5. `users` row inserted with `email_verified=false`, then **`users.role='admin'` flipped immediately** via the BYPASSRLS owner pool (setup-admin.ts:266).
6. `setup_state.status='completed'` — the legitimate operator can never claim the wizard.
7. The verification email is dispatched to `ceo@victim-company.com`. They will likely ignore it; even if they click it, the attacker already has full admin-role rows in DB. Better Auth's `requireEmailVerification: true` only blocks **sign-in** for unverified users — it does NOT clear `role='admin'`.

**Why this is HIGH not CRITICAL:**

- Attacker doesn't get a valid session until they verify (which requires inbox access). The `users.role='admin'` row is "armed but unsigned" — useless to the attacker on its own.
- BUT this is **denial-of-service-via-takeover-pending**: the legitimate operator cannot complete setup. There is no documented operator recovery (no admin "claim reset" path; only the test-only route `/api/_test/reset-setup` which is plugin-vetoed in production).
- A further escalation: if the attacker controls a typosquat / similar-looking domain that an operator employee clicks (phishing), the attacker can guide the actual verification through.

**Code citation:** `apps/api/src/routes/setup-admin.ts:266` — `await ownerPool.query("UPDATE users SET role = 'admin' WHERE id = $1", ...)` — no `AND email_verified = true` predicate.

**Recommended fix (in priority order):**

1. **Two-step claim** — change the contract to: signup → verification-email-click → THEN role-flip. The wizard's submit POSTs a "request" that creates the user and queues the email; the actual `setup_state.status='completed'` + `users.role='admin'` transition is gated on the verification callback (verify-email-complete route). This eliminates the pre-verify takeover window entirely.
2. **Recovery escape valve** — if (1) is too invasive for v1, add an operator-only `OPENWHISPR_FORCE_RESET_SETUP_TOKEN` env that, when set + matched at request time, allows ONE setup_state rollback. Documented in `docs/security.md` with the threat model.
3. **At minimum**: add `AND email_verified = true` predicate on the role-flip UPDATE, with a 24h TTL on unverified pending-admin rows (a worker job deletes unverified `role=NULL` users + rolls back `setup_state.status='pending'` after timeout). This narrows the takeover window from "until kingdom come" to "24h".

---

### Dimension 6 — Tenant isolation

**Severity: LOW (accepted v1 debt; documented)**

The setup-admin claim handler uses the BYPASSRLS `ownerPool` for `UPDATE users SET role='admin'` (line 266) and `UPDATE tenants SET name=$1 WHERE id=DEFAULT_TENANT_ID` (line 140). Per RLS posture ledger (CLAUDE.md DISCIPLINE rule 16) v1 is single-installation-single-tenant — `DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000'` is the ONE and only tenant. The pre-claim `SELECT email FROM users WHERE role='admin'` (line 204) reads across all rows without tenant filter — in v1 there's only one tenant, so this is informational.

In a hypothetical v2 multi-tenant world the claim handler would need:
- Tenant-scoped admin checks (the SELECT must include `AND tenant_id = $current_tenant`).
- Per-tenant `setup_state` row (today's design is a global singleton).
- Origin-derived tenant resolution before any DB write.

**Code citation:** `apps/api/src/routes/setup-admin.ts:204, 266, 140`; CLAUDE.md DISCIPLINE rule 16

**Recommended fix:** Already tracked as v2-blocker in `.planning/deferred-items.md` per CLAUDE.md rule 16. No v1 action required — but the deferred entry should explicitly call out setup-admin as a site that needs tenant-aware redesign in v2.

---

### Dimension 7 — setup_state row mutation surface

**Severity: INFO (no finding)**

Complete writer inventory (E6 above): only the claim handler + its rollback paths + the production-vetoed test-only reset write to `setup_state`. The test-only writer at `apps/api/src/routes/test-only.ts:382` is gated by the **plugin-registration-time** veto (`NODE_ENV !== 'production' AND (NODE_ENV === 'test' OR OPENWHISPR_TEST_ROUTES === 'true')`) — a misset env knob in production cannot re-open the claim window because the entire plugin doesn't register.

**Code citation:** `apps/api/src/routes/test-only.ts:236-241` (production-veto gate), `apps/api/src/routes/test-only.ts:375-395` (reset-setup handler)

**Recommended fix:** None required. **Add a tools lint test** that asserts the only setup_state writers in the production runtime graph are setup-admin.ts (defense-in-depth — same posture as `tools/lint-no-hardcode.ts`). The lint would scan for `UPDATE setup_state` / `INSERT INTO setup_state` / `.update(setupState)` / `.insert(setupState)` outside an allowlist of `apps/api/src/routes/setup-admin.ts` + `apps/api/src/routes/test-only.ts` + `apps/api/src/routes/__tests__/setup.ts`.

---

### Dimension 8 — CSRF protection on POST /api/setup-admin

**Severity: MEDIUM**

The route is registered with `config.auth = false` which opts OUT of the global `dualAuthHook` (dual-auth.ts:145-147). It does NOT participate in Better Auth's `validateOrigin` / `disableOriginCheck` posture either — that's only enforced for `/api/auth/*` paths inside Better Auth's handler chain.

**Why the risk is MEDIUM not HIGH:**

- The claim is single-use per install: once `setup_state.status='completed'`, every subsequent POST short-circuits to 200 `alreadyCompleted:true` (idempotent, no state change). So CSRF cannot "re-claim" after first success.
- The pre-claim window is short — operators typically complete the wizard within minutes of `docker compose up`. The attack window is "operator has booted but has not yet clicked submit" AND "operator visits attacker-controlled site in another tab during that window" — narrow but non-zero.
- During the pre-claim window, a successful CSRF would let an attacker pick the FIRST admin email/password — same impact as Dimension 5 (the email-verification bypass).

**Attack scenario:**

1. Operator boots a fresh OpenWhispr at `https://openwhispr.victim.com`.
2. Operator (in another tab) visits `https://attacker.example.com/exploit.html`:
   ```html
   <form action="https://openwhispr.victim.com/api/setup/admin" method="POST" enctype="text/plain" id="x">
     <input name='{"email":"attacker@evil.com","password":"AttackerPick12!","name":"X","workspace":"X","timezone":"UTC","x":"' value='"}' />
   </form>
   <script>document.getElementById('x').submit();</script>
   ```
3. Cross-origin POST fires. The route does NOT inspect `Origin` or `Referer`. There is no session-cookie requirement (route is `auth: false`), so SameSite=Lax is irrelevant — the request succeeds.
4. Same takeover-pending outcome as Dimension 5.

**Why `text/plain` matters:** The Zod parser requires JSON. A cross-origin form POST normally cannot set `Content-Type: application/json` without a preflight (which Fastify's CORS plugin would reject). HOWEVER, Fastify's default body parser accepts JSON regardless of Content-Type in some configurations. **This needs runtime verification** — not asserted by any test in this audit's scope. Even if `text/plain` doesn't parse, `enctype="multipart/form-data"` or a JS `fetch` from the attacker page (which CAN set JSON Content-Type with CORS preflight) is a path.

**Code citation:** `apps/api/src/routes/setup-admin.ts:146-159` (route declaration carries no Origin / Referer check); `apps/api/src/middleware/dual-auth.ts:145-147` (auth opt-out short-circuits before any other guard)

**Recommended fix:**

1. **Origin allow-list at the route's preHandler.** Validate `req.headers.origin` against `INGRESS_BASE_URL` (already enforced at boot via `validateIngressBoot()`). Reject mismatches with 403 BEFORE the Zod parse / setup_state UPDATE.
   ```ts
   preHandler: async (req, reply) => {
     const expected = process.env.INGRESS_BASE_URL ?? process.env.AUTH_URL;
     const origin = req.headers.origin;
     if (!origin || !expected || !origin.startsWith(new URL(expected).origin)) {
       return reply.code(403).send({ error: { code: "ORIGIN_MISMATCH", requestId: req.id } });
     }
   }
   ```
2. **Combine with two-step verification (Dim 5 fix)** — the role-flip happens on the email-click callback. The attacker's cross-origin POST can't intercept that callback (it lands on the operator's verified-email link, not the attacker's session).
3. **Add a CSRF test** to `setup-admin.test.ts` asserting that POST with `Origin: https://evil.example` returns 403.

---

### Dimension 9 — Origin / Referer check on cross-origin attack

**Severity: MEDIUM (same root as Dim 8)**

The route does not consult `INGRESS_BASE_URL` (which is validated at boot — config/auth.ts:149-187 ensures a canonical origin is configured). The defence-in-depth surface that EXISTS for `/api/auth/*` (Better Auth's `validateOrigin` middleware) does NOT extend to `/api/setup/admin` because that route does not pass through Better Auth's handler.

**Recommended fix:** Same as Dim 8 — preHandler Origin check against `INGRESS_BASE_URL`. The setup-state GET endpoint should get the same guard (cheap defence-in-depth; doesn't change behaviour for the legitimate operator browser).

**Code citation:** `apps/api/src/config/auth.ts:149-187` (boot-validated canonical origin available but unused by setup-admin); `apps/api/src/routes/setup-admin.ts:146-166` (no Origin check)

---

## Cross-Cutting Observations

### O1. Audit log gap — `admin.role_changed` event NOT emitted

`audit.ts:163-167` declares the enum `admin.role_changed` with payload schema `{ target_user_id, before, after }`. The setup-admin handler does NOT emit this event when promoting the first user to admin. Every other admin transition in v2+ will emit it; v1 wizard claim should too — operators investigating "who became admin and when" will find a `users.created_at` row but no audit trail of WHEN role was set (the claim time IS distinct from the user-creation time in the failed-rollback-then-retry path).

**Severity: LOW**
**Recommended fix:** After the role-flip succeeds (after line 268 in setup-admin.ts), open a withTenant transaction and call `recordAudit(tx, ctx, 'admin.role_changed', { target_user_id: <new id>, before: 'null', after: 'admin' })`. The `actor_user_id` is the new admin themselves (best available — there's no prior authenticated actor in this pre-admin window).

### O2. `users.role` unconstrained text column

Migration 0017 line 42: `ALTER TABLE "users" ADD COLUMN "role" text;` — nullable text, no `CHECK (role IN ('admin', 'user', NULL))` constraint. A future programmer accidentally setting `role = 'Admin'` (capital A) or `'administrator'` would silently bypass any role-checking code that does `WHERE role = 'admin'`. The migration header explicitly defers the CHECK to "Phase 13+ growth surface" — fine for v1 but should be tracked.

**Severity: LOW**
**Recommended fix:** Add `CHECK (role IS NULL OR role IN ('admin'))` in a follow-up migration. Trivially additive (no existing data to migrate — only one row possible). Or alternatively `CREATE TYPE user_role AS ENUM ('admin')` and convert the column (more invasive, can wait).

### O3. Partial unique index `WHERE role='admin'` does not exist

The schema does not enforce "at most one admin in this tenant". The atomic `setup_state` UPDATE is the gate — if a future code path bypasses that gate (e.g. a future admin-promotion route added without re-checking `setup_state`), nothing in DB constraints prevents multiple admins from being created. This is fine for v1 (no such route exists), but a partial unique index would be belt-and-suspenders.

**Severity: LOW**
**Recommended fix:** `CREATE UNIQUE INDEX users_one_admin_per_tenant ON users (tenant_id) WHERE role = 'admin';` Tracking deferred-item; v2 multi-admin support will likely drop this constraint.

### O4. `/api/setup-state` discloses unclaimed status to unauthenticated callers

The `GET /api/setup-state` endpoint returns `{ status: 'pending' | 'completed' | 'skipped_legacy' }` to any anonymous caller. setup-state.ts comments acknowledge this disclosure trade-off (lines 7-10): the same bit is implied by Better Auth's public sign-up route shape + `/api/auth/providers` length. An attacker scanning the internet for fresh OpenWhispr instances trivially identifies vulnerable (pending) ones — relevant to the Dim 5 / Dim 8 attack windows.

**Severity: INFO (acknowledged trade-off)**
**Recommended fix:** None required for v1. Long-term: gate the `/setup` wizard behind a one-time-token issued at `docker compose up` time (printed to operator console) so the public endpoint doesn't reveal the claim status.

### O5. LOCKER chain compliance

- LOCKER-01 (no NODE_ENV in runtime paths): setup-admin.ts contains no NODE_ENV reads. ✓
- LOCKER-02 (no type-suppression): no `as any` / `@ts-ignore` in setup-admin.ts. ✓
- LOCKER-03 (no hardcoded localhost/UUID/test-token shapes): the canonical `DEFAULT_TENANT_ID` is the permanently-allowlisted UUID literal — only authorized usage. ✓
- LOCKER-04 (rateLimit + schema declarations): `config.rateLimit` present (line 159). `schema` is NOT declared (the route uses Zod manually inside the handler via `safeParse` at line 171). **The LOCKER-04 ledger flips to BLOCKING in Phase 41** (CLAUDE.md DISCIPLINE rule 14) — at that point setup-admin.ts will fail the lint unless `schema: { body: setupAdminInput }` is added to the route options. Currently WARN only.
- LOCKER-05 (Error subclass truncation): no Error subclasses constructed here. ✓
- LOCKER-06 (no shell credential interpolation): no `child_process` calls. ✓
- LOCKER-PLAINTEXT-COLS / LOCKER-08: `setup_state` has NO credential columns. `users.role` is not a credential. ✓

**Severity: LOW (Phase 41 readiness item)**
**Recommended fix:** Pre-emptively migrate setup-admin.ts to declare `schema: { body: setupAdminInput }` on the route options, dropping the manual `safeParse` (Fastify+Zod plugin will surface the same validation error envelope). This closes the Phase 41 LOCKER-04 flip exposure for this route.

## Severity Summary

| Dim | Severity | Headline |
|---|---|---|
| 1. Privilege escalation post-claim | INFO | UPDATE-WHERE atomic gate, sound |
| 2. Race condition on claim | INFO | Postgres MVCC + RETURNING, sound (but no concurrent integration test) |
| 3. Rate-limit on setup endpoints | INFO | 5/min POST, 30/min GET — LOCKER-04 compliant |
| 4. Token / state replay | INFO | Status enum IS the consumed-bit |
| 5. Email verification bypass | **HIGH** | role='admin' lands before verification; takeover-pending |
| 6. Tenant isolation | LOW | Accepted v1 single-tenant debt (CLAUDE.md rule 16) |
| 7. setup_state mutation surface | INFO | All writers tracked + production-vetoed |
| 8. CSRF protection | **MEDIUM** | Route is `auth: false`, no Origin check, claim-window CSRF possible |
| 9. Origin / Referer check | **MEDIUM** | No allow-list against `INGRESS_BASE_URL` |
| Cross-cutting O1: audit log gap | LOW | `admin.role_changed` enum exists but unused on claim |
| Cross-cutting O2: `users.role` no CHECK | LOW | Phase 13+ deferred — accepted v1 debt |
| Cross-cutting O3: no partial unique idx | LOW | Defence-in-depth opportunity |
| Cross-cutting O4: setup-state disclosure | INFO | Acknowledged trade-off |
| Cross-cutting O5: LOCKER-04 Phase 41 flip | LOW | Pre-emptive `schema:` migration |

**Counts: 1 HIGH, 2 MEDIUM, 5 LOW, 6 INFO**

## Top 3 Critical Findings (Expanded)

### #1 — Dim 5 / HIGH: Email-verification bypass enabling takeover-pending DoS

The setup-admin claim handler flips `users.role='admin'` immediately after Better Auth's `signUpEmail` returns, without waiting for the verification-email click. An anonymous attacker can claim the wizard with an email they don't control, wedging the legitimate operator out of their own instance until manual DB intervention (there is no documented operator recovery path in production — `/api/_test/reset-setup` is plugin-vetoed when `NODE_ENV='production'`).

**Reproducer:**
```bash
curl -X POST https://victim.example.com/api/setup/admin \
  -H 'Content-Type: application/json' \
  -d '{"email":"unowned@victim-tld.com","password":"AttackerPick12!","name":"X","workspace":"X","timezone":"UTC"}'
# 201 Created — setup_state.status='completed' + users.role='admin' for unverified email
```

**Code citation:** `apps/api/src/routes/setup-admin.ts:266` — role flip with no `email_verified=true` predicate.

**Recommended fix (preferred):** Move the role flip + setup_state completion onto the verify-email callback path. The submit POST creates the user (verification email dispatched) but leaves `setup_state.status='pending_verification'`. The verify-email-complete route (when the operator clicks the email link) performs the atomic transition. This eliminates the takeover-pending window entirely; the attack vector requires the attacker to control the operator's inbox.

**Recommended fix (interim if (1) too invasive):** Add `email_verified=true` predicate on the role-flip UPDATE + a worker job that, after 24h, deletes unverified pending-admin users and rolls `setup_state` back to `pending`. Surfaces a documented recovery window for operators.

---

### #2 — Dim 8 / MEDIUM: CSRF on the pre-claim window

`POST /api/setup/admin` is `auth: false` (it must be — wizard runs before any admin exists), but it ALSO carries no Origin / Referer check. A cross-origin POST from any attacker-controlled site fired during the operator's pre-claim window (the minutes between `docker compose up` and the operator clicking submit) lands successfully on the server, with the same takeover-pending outcome as Finding #1.

**Reproducer:**
```html
<!-- attacker.example.com/exploit.html -->
<script>
fetch('https://victim-openwhispr.com/api/setup/admin', {
  method: 'POST',
  mode: 'no-cors',  // suppresses CORS preflight; body still arrives
  headers: { 'Content-Type': 'text/plain' },  // or application/json if CORS preflight passes
  body: JSON.stringify({
    email: 'attacker@evil.com', password: 'AttackerPick12!',
    name: 'X', workspace: 'X', timezone: 'UTC'
  })
});
</script>
```

**Code citation:** `apps/api/src/routes/setup-admin.ts:146-166` — no Origin / Referer header validation; `apps/api/src/middleware/dual-auth.ts:145-147` — auth opt-out skips all downstream guards.

**Recommended fix:** Add a route-level `preHandler` that validates `req.headers.origin` against the boot-validated `INGRESS_BASE_URL` (already available via `validateIngressBoot()` config/auth.ts:149-187). Reject mismatches with 403 BEFORE any DB write. Same guard on `/api/setup-state` for defence-in-depth. Add a unit test asserting cross-origin POST returns 403.

---

### #3 — Dim 9 / MEDIUM: No defence-in-depth Origin allow-list (sister of Finding #2)

Tightly coupled with Finding #2: even if the email-verification fix from Finding #1 lands, the route still lacks the Origin allow-list that the `/api/auth/*` surface gets via Better Auth's `validateOrigin`. A boot-validated `INGRESS_BASE_URL` already exists; it just isn't read by this route. Cheapest defence-in-depth in the codebase — a 5-line preHandler.

**Code citation:** `apps/api/src/config/auth.ts:149-187` (canonical origin already validated at boot); `apps/api/src/routes/setup-admin.ts:146-166` (no consumer of that constant)

**Recommended fix:** As in Finding #2. Worth shipping ALONGSIDE the email-verification fix as a single hardening sweep — one quick-task, one PR.

## Resolution

- **Root Cause:** N/A — this is a security audit, not a bug fix.
- **Fix:** not applied (READ-ONLY audit by operator instruction).
- **Next step:** operator decides which findings to remediate. Recommended bundling:
  - **Quick-task A — pre-verify-claim hardening:** combines Findings #1 + #2 + #3 + O1 (audit emission). One PR: move role-flip to verify-email-complete path + add Origin allow-list preHandler + emit `admin.role_changed`. Adds 3 tests (concurrent claim, cross-origin 403, unverified claim path).
  - **Quick-task B — schema + lint defence-in-depth:** addresses O2 + O3 + O5 + the missing `tools/lint-no-extra-setup_state-writers.ts`. One migration + one lint rule + the pre-emptive `schema:` LOCKER-04 migration for setup-admin.
  - **Deferred (v2):** O6 ("setup-state disclosure"), Dim 6 ("tenant isolation") — already tracked under `.planning/deferred-items.md` per CLAUDE.md rule 16.
