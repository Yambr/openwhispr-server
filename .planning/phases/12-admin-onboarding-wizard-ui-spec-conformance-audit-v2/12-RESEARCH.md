## RESEARCH COMPLETE


## Correction Log (2026-05-14)

**Trigger:** User flagged that Phase 07 design ships **6 JSX files (4987 LOC)**, not just `design-canvas.jsx`, and the prior research (commit `a5bcf84`) treated `design-canvas.jsx` as the only oracle. The user's words: *"учти там были оjsx файлы с дизайном"* + *"а в прошлый раз клод хуй забил на них"*. Phase 07 implementation already partially ignored these JSX files; Phase 12 UICONF-04 audit MUST close that gap.

**What changed in this revision:**

| § | Change | Why |
|---|--------|-----|
| §11 | Cross-checked SignUpForm.tsx:102-115 fix against `screens-user.jsx` `ScreenSignUp` (lines 97-183) — design renders **ONE** `<Alert>`-equivalent element (one `lede` block), corroborating the root cause that bug = re-using one i18n key in both AlertTitle and AlertDescription. | Adds JSX corroboration for D-21 / UICONF-06 fix. |
| §12 | Conformance test inventory chain now flows **JSX → markdown → test**: each assertion file MUST cite `screens-user.jsx:LINE` (or `screens-admin.jsx:LINE`) the inventory was derived from. UI-SPEC-\*.md is human-derived from JSX; JSX is source-of-truth. | Closes the "Claude забил на jsx" risk. |
| §14 | **Plan 12-05 split → 12-05a (Vitest+RTL structural, JSX-derived inventories) + 12-05b (Playwright axe).** Each of {SignInForm, SignUpForm, OidcButtons, VerifyEmailClient, setup wizard, /admin index} gets its own conformance test file derived from its JSX source. | Prior 12-05 was over-sized; per-screen JSX-derived inventories raise task count. |
| §15 | Added threat-row (h): admin screens (A1-A3 from `screens-admin.jsx`) may surface user PII (actor email at lines 192, 215, 230). Phase 12's `/admin` index (ADMIN-04) MUST NOT expose unscoped user counts pre-RLS-gate. | Info-disclosure surface present in design must not leak into Phase 12 impl. |
| §16 NEW | **Phase 07 Design JSX Inventory** — table of all 6 files, their artboard exports, which Phase 12 deliverable references each one, and which screens Phase 07.1 implemented vs skipped. | Single source-of-truth so Phase 12 doesn't repeat Phase 07's mistake. |
| D-20 (in user_constraints) | Re-scoped: D-20 says `design-canvas.jsx` itself is a STATIC wrapper. That's correct **for design-canvas.jsx only** (1437 LOC Figma host). The OTHER 5 files — `screens-user.jsx`, `screens-admin.jsx`, `ui.jsx`, `browser-window.jsx`, `tweaks-panel.jsx` — ARE runnable JSX with concrete component definitions and ARE the canonical oracle. | Critical scope correction. |
| §7 / Wizard composition | Confirmed: **NO `/setup` or onboarding artboard exists in any of the 6 JSX files** (verified by `grep -in 'onboarding\|setup\|wizard\|stepper\|identity\|workspace'`; only hit is a JSDoc example comment at `design-canvas.jsx:10`). The Phase 12 `/setup` wizard is therefore a **Phase 12 deviation from design with rationale** — it composes `ui.jsx` primitives (`AuthShell`, `Btn`, `Field`) but its overall structure has no JSX oracle. | Eliminates risk of inventing a phantom "design" the planner thinks exists. |
| §12 / §15 | `/admin` index page (ADMIN-04, closes TD-12.a) MUST mirror **`screens-admin.jsx` ScreenConfig** (A3, lines 445-628) structure — read-only card grid with STT/note-recording sections + effective-env table. | Concrete oracle for ADMIN-04. |
| §6 (P6) | Pitfall P6 rephrased: parsing `design-canvas.jsx` is wrong; but the 5 runnable JSX files ARE referenceable — hand-curate role/label inventory from them (cite by file:line), then mirror in markdown UI-SPEC. | Closes the "ignore all JSX" overcorrection risk from the prior research. |

**Baseline commit:** `a5bcf84 docs(12): research phase admin wizard + ui-spec conformance domain`. Diff scope = sections marked above; no decisions D-01..D-27 contradicted; planner-discretion items unchanged.

---

# Phase 12: Admin Onboarding Wizard + UI-SPEC Conformance Audit (v2) — Research

**Researched:** 2026-05-14
**Domain:** Next.js 15 admin wizard + Better Auth role extension + Drizzle singleton schema + Playwright/axe conformance
**Confidence:** HIGH (CONTEXT.md locked 23 decisions; remaining work is verification + plan-split)

## Summary

CONTEXT.md (D-01..D-27) has already locked every architecturally-load-bearing choice
in advisor-mode: singleton `setup_state` table, atomic `UPDATE ... WHERE status='pending' RETURNING`
under PgBouncer txn-mode, public `/api/auth/providers` + authed `/api/capabilities` split,
single-page wizard with shadcn-stepper visual progress, Hybrid Vitest+RTL structural conformance
plus `@axe-core/playwright` axe baseline reusing Phase 13 compose-harness, and the five
`@expected-red @after-phase-12` Gherkin scenarios as flip-GREEN gate.

This research therefore (a) verifies each locked decision is grounded in the live codebase
with file:line citations, (b) drills into the four discretion items the planner must still
choose (step-anchor implementation, capability-endpoint shape, duplicate-banner fix locus,
axe rule subset), and (c) proposes a 5-plan / 3-wave split sized for ≤8 tasks each with
strict TDD ordering.

**Primary recommendation:** **Split into 5 plans across 3 waves — Wave 1 schema+endpoints (Plans 12-01, 12-02), Wave 2 wizard+admin UI (Plans 12-03, 12-04), Wave 3 conformance suite + cjm flip-green (Plan 12-05).** Wave 1 is the foundation Wave 2 builds on; Wave 3 is verification-only and runs after Wave 2 has GREEN unit tests.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01** Singleton `setup_state` table in `packages/data/src/schema/`; Drizzle `pgEnum('setup_state_status', ['pending','completed','skipped_legacy'])`.
- **D-02** Operator-global, NOT tenant-scoped, NO RLS attaches (mirrors `tenants` root pattern).
- **D-03** Idempotency = single-statement `UPDATE setup_state SET status='completed', completed_at=now() WHERE id=1 AND status='pending' RETURNING *`. Losers see status='completed' → return 200 with the already-created admin (NOT 409).
- **D-04** v1 backfill seeds `skipped_legacy` IF prior `users` rows exist at migration time, else `pending`. Single additive migration, passes squawk.
- **D-05** Reject column-on-tenants (Option B) and Redis NX (Option C).
- **D-06** Public `GET /api/auth/providers` under Better Auth's `/api/auth/*` namespace; `Cache-Control: public, max-age=60` + weak ETag.
- **D-07** Authed `GET /api/capabilities` requires session; `Cache-Control: private, max-age=30` + ETag keyed on `(tenantId, env-hash)`; Phase 12 ships minimal payload `{ auth, features }`.
- **D-08** Provider-derivation source-of-truth = `apps/api/src/auth.ts:109-122` (env-driven `readOidcProviders()`).
- **D-09** Error envelope `{ error: { code, message, requestId } }`.
- **D-10** Reject minimal-only (A) and broad-union-public (B).
- **D-11** Single-page form with shadcn-stepper visual progress (Identity / Workspace / Review).
- **D-12** Vendor `shadcn-stepper` community port into `apps/web/src/components/ui/stepper.tsx` with SPDX header.
- **D-13** Timezone picker = native `Intl.supportedValuesOf('timeZone')` + shadcn Select; default from `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- **D-14** NO password strength meter; Zod policy (min 12 chars + mixed classes) carries it.
- **D-15** Idempotent submit — 200 with existing admin, NOT 409.
- **D-16** Mirror `SignUpForm.tsx` RHF7+Zod3+Form+Card template.
- **D-17** Reject multi-step (A) and no-Stepper (C).
- **D-18** Vitest+RTL structural conformance at `apps/web/src/components/__tests__/conformance/{SignInForm,SignUpForm,OidcButtons,VerifyEmailClient,setup}.test.tsx`.
- **D-19** Playwright `@axe-core/playwright@4.11.2` axe baseline at `tests/conformance/ui-spec/axe.spec.ts`; reuses Phase 13 `tests/e2e-cjm/support/compose-harness.ts`.
- **D-20** `design-canvas.jsx` (1437 LOC, ONE of 6 JSX files in design/) is a Figma-canvas WRAPPER and NOT directly mountable. **CORRECTION (2026-05-14):** the OTHER 5 files — `screens-user.jsx` (1616 LOC), `screens-admin.jsx` (630 LOC), `ui.jsx` (440 LOC), `browser-window.jsx` (200 LOC), `tweaks-panel.jsx` (664 LOC) — ARE runnable JSX component sources and ARE the canonical oracle for UICONF-04. Conformance assertions MUST trace back to a `screens-{user,admin}.jsx:LINE` citation. See §16 inventory.
- **D-21** UICONF-06 gate = `expect(screen.getAllByRole('alert')).toHaveLength(1)` in SignUpForm conformance test.
- **D-22** No retry-on-flake (Phase 13 D-12 carries over).
- **D-23** Reject standalone-Playwright (A) and Vitest-only (B).
- **D-24** Strict TDD constitutional; ≥90/90/90/90 on diff; same atomic commit.
- **D-25** English-only sources; runtime UI en+ru.
- **D-26** No mocks of internal logic — real Postgres via testcontainers.
- **D-27** Flip `@cjm-5.1`, `@cjm-5.3`, `@cjm-1.5`, `@cjm-7.1`, `@cjm-7.2` from `@expected-red @after-phase-12` to GREEN by **removing tags**, NOT editing harness.

### Claude's Discretion
- Step-anchor implementation (IntersectionObserver vs scroll-listener) — planner chooses.
- `/api/capabilities` single-endpoint vs one-shot batched discovery — planner chooses.
- Duplicate-banner fix locus (`SignUpForm.tsx` template OR upstream Form) — researcher inspects → **answered below in §11**.
- Exact axe rule subset (full axe-core vs WCAG-2.1-AA only) — planner chooses; ZERO violations required.
- shadcn-stepper exact community port (damianricobelli vs reui.io) — planner picks per license check.

### Deferred Ideas (OUT OF SCOPE)
- Phase 14 SLIM/BYOK semantics (endpoint shape ships here; semantics later).
- Phase 13 harness changes.
- Phase 15 host split / FSL relicense.
- Pixel-diff visual snapshots (semantic DOM only).
- Password strength meter (zxcvbn).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADMIN-01 | `/setup` gated by `setup_state` enum (NOT users-count) | §1 schema design + migration |
| ADMIN-02 | Single-page wizard fields (email/password/name/workspace/timezone); RHF7+Zod3+shadcn Stepper; idempotent `POST /api/setup/admin` | §3 endpoint + §7 form |
| ADMIN-03 | `users.role` migration + Better Auth `additionalFields.role` + skipped_legacy backfill | §2 additionalFields extension |
| ADMIN-04 | `/admin` Next.js index page (closes TD-12.a) | §5 + plan 12-04 |
| ADMIN-05 | basicauth-htpasswd break-glass documented; bcrypt-`$` trap removed by wizard | Plan 12-04 docs task |
| ADMIN-06 | Wizard onboarding e2e GREEN in Phase 13 harness | §14 flip-green; D-27 |
| UICONF-01 | `GET /api/auth/providers` + `GET /api/capabilities` returns providers + verification status | §4 + §5 |
| UICONF-02 | Auth screens conditionally render against capability endpoint — zero buttons for zero providers | §9 conditional rendering |
| UICONF-03 | Per-field Zod errors localized en+ru, no bare "Invalid input" | §10 zod errorMap |
| UICONF-04 | Semantic DOM conformance vs `design-canvas.jsx` + UI-SPEC.md — NOT pixel-diff | §12 hybrid suite |
| UICONF-05 | Axe a11y baseline + per-screen delta gate; zero violations | §12 + axe spec |
| UICONF-06 | SignUpForm duplicate-banner regression fixed; exactly one banner | §11 root cause |
| UICONF-07 | Resend-verification CTA on sign-in 403 screen | §13 |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `setup_state` storage + state transitions | Database (Postgres) | API (Fastify) | Postgres-as-source-of-truth (D-02, D-05); atomic UPDATE under PgBouncer txn-mode is the idempotency mechanism |
| `users.role` column + role-narrowed session payload | Database | API | RLS-subject Better Auth user table; `additionalFields.role` is the only sanctioned extension surface |
| `/api/setup/admin`, `/api/auth/providers`, `/api/capabilities` | API (Fastify + Better Auth plugin) | — | Route registration follows existing `apps/api/src/routes/index.ts` conditional-on-deps pattern |
| `/setup` route + wizard UI | Frontend Server (Next.js App Router) | Browser | Server Component shell + Client Component form (matches existing `SignUpForm` pattern in `(public)` route group) |
| `/admin` index page | Frontend Server | — | Static-rendered page at `apps/web/src/app/(admin)/admin/page.tsx` |
| Conditional OIDC button rendering | Browser (Client Component) | API | `OidcButtons` is `"use client"` and must call `/api/auth/providers` at mount — env reads in `process.env.NEXT_PUBLIC_*` are operator-side bake-in only, not capability-truth |
| Zod per-field error i18n | Browser | — | `useTranslation` is client-only; zod `errorMap` lives in `apps/web/src/lib/` |
| Structural conformance assertions | Vitest+RTL (happy-dom) | — | Counts toward `apps/web/src/**` coverage gate; runs in `pnpm test:unit` lane |
| Axe contrast/focus-visible/landmark assertions | Playwright (real Chromium) | Compose harness | happy-dom cannot evaluate layout/contrast honestly (D-19) |

---

## §1. `setup_state` Migration Shape

**Schema file** — new `packages/data/src/schema/setup_state.ts`, mirroring the
operator-global pattern at `packages/data/src/schema/tenants.ts:1-12` (NO RLS, root
singleton, SPDX header):

```ts
// SPDX-License-Identifier: Apache-2.0
// Operator-global setup state — NOT tenant-scoped. NO RLS attaches.
// Mirrors the tenants root-singleton pattern (CONTEXT D-02).
import { pgEnum, pgTable, smallint, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const setupStateStatus = pgEnum("setup_state_status", [
  "pending",
  "completed",
  "skipped_legacy",
]);

export const setupState = pgTable("setup_state", {
  id: smallint("id").primaryKey(),                    // CHECK (id = 1) — singleton
  status: setupStateStatus("status").notNull().default("pending"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Note: Drizzle's `.primaryKey()` does not emit `CHECK (id = 1)` — the `CHECK` is added
in the raw SQL migration body (Drizzle introspection accepts arbitrary `CHECK` written
in the migration file; the schema TS file is descriptive of column types only). [VERIFIED: `packages/data/src/schema/tenants.ts:7-12`]

**Migration SQL** — next number is **`0017_setup_state.sql`** (last existing is `0016_users_locale.sql` per `ls packages/data/migrations/`). Exact body:

```sql
-- Phase 12 / Plan 12-01 — operator-global setup_state singleton + users.role.
-- D-01..D-04: pgEnum + singleton row + v1 backfill to skipped_legacy.
-- D-26 squawk gate: additive only, no NOT NULL on populated table, no concurrent index churn.

CREATE TYPE setup_state_status AS ENUM ('pending', 'completed', 'skipped_legacy');

CREATE TABLE "setup_state" (
  "id"           smallint                 PRIMARY KEY  CHECK (id = 1),
  "status"       setup_state_status        NOT NULL    DEFAULT 'pending',
  "completed_at" timestamptz,
  "created_at"   timestamptz               NOT NULL    DEFAULT now()
);

-- D-04 v1 backfill: presence of any prior user → skipped_legacy; else pending.
INSERT INTO "setup_state" (id, status, completed_at)
SELECT 1,
       CASE WHEN EXISTS (SELECT 1 FROM "users") THEN 'skipped_legacy'::setup_state_status
            ELSE 'pending'::setup_state_status
       END,
       CASE WHEN EXISTS (SELECT 1 FROM "users") THEN now() ELSE NULL END;

-- ADMIN-03: additive role column. Nullable text (no CHECK constraint v1 — role
-- enumeration is a Phase 13+ growth surface; Better Auth additionalFields handles
-- type narrowing at the application layer).
ALTER TABLE "users" ADD COLUMN "role" text;
```

**v1-install detection — why `EXISTS (SELECT 1 FROM "users")`, not `accounts`:**
- A v1 install may have only basicauth/htpasswd admins with zero `users` rows.
  However: if zero `users` rows exist, no Better Auth admin has been created and
  the operator is genuinely "fresh" — `pending` is correct.
- An install with prior Better Auth users (signed up via Phase 7.1 flow without a
  wizard) has `users` rows → `skipped_legacy` is the safe default; operator can
  manually run a CLI to flip to `completed` if needed (future TD).
- [CITED: `apps/api/src/auth.ts:243` — `user: users` is the Better Auth-canonical alias to the pluralized table]

**Squawk lint posture** [VERIFIED: `tools/lint-migrations.ts:31-48`]:
| Rule | Triggers? | Why not |
|------|-----------|---------|
| `adding-required-field` | NO | `role` is nullable; `setup_state.id` is in a brand-new empty table |
| `ban-drop-*`, `renaming-*`, `changing-column-type` | NO | Pure additive |
| `constraint-missing-not-valid` | NO | `CHECK (id=1)` is on a new empty table |
| `prefer-text-field` | NO | We use `text`, not `varchar(N)` |
| `disallowed-unique-constraint` | NO | No unique constraints |
| `require-concurrent-index-creation` | NO | No indexes added |

Migration passes the 16-rule squawk gate cleanly.

**Confidence:** HIGH [VERIFIED: schema file + migration directory listing + squawk rules]

---

## §2. Better Auth `additionalFields.role` Extension

[VERIFIED: `apps/api/src/auth.ts:270-279`] — existing precedent for the exact same pattern is the `locale` additionalField (Plan 10-01c):

```ts
user: {
  additionalFields: {
    locale: { type: "string", required: false, defaultValue: "en", input: true },
  },
},
```

**Phase 12 extension** — extend the same `additionalFields` block (NOT a parallel block):

```ts
user: {
  additionalFields: {
    locale: { type: "string", required: false, defaultValue: "en", input: true },
    role:   { type: "string", required: false, defaultValue: null,  input: false },
    //                                                              ^^^^^^^^^^^^
    // input:false — role MUST NOT be settable via /api/auth/sign-up/email body.
    // Wizard's POST /api/setup/admin server route writes role='admin' directly after
    // Better Auth creates the user. This prevents role escalation via signUpEmail.
  },
},
```

**Why `input:false`** — the Better Auth `signUpEmail` endpoint's `additionalFields` map is
public surface. Allowing `input:true` on `role` would let any anonymous
`POST /api/auth/sign-up/email` body include `{ role: "admin" }`. This is the §15 threat
model item (e) — role escalation via API instead of wizard. [VERIFIED: how locale is
declared with `input:true` because operator-side risk is nil; role is the opposite case]

**ALTER TABLE path:** the column is hand-rolled in migration `0017_setup_state.sql`
(§1 above), NOT generated by Better Auth's CLI. Better Auth's adapter reads from
columns it finds; declaring `additionalFields.role` only tells the adapter to
read/write it. The migration column must precede the `additionalFields` deploy. [VERIFIED:
`packages/data/migrations/0016_users_locale.sql` is the precedent — hand-rolled ALTER preceded the additionalFields declaration]

**TS type narrowing:** Better Auth's `User['role']` will be `string | null | undefined`
because `required:false` + `defaultValue:null`. Consumers should narrow with
`if (user.role === "admin")`. A reusable `RequireRole` Fastify preHandler shape:

```ts
export function requireRole(role: "admin"): preHandlerHookHandler {
  return async (req, reply) => {
    const session = (req as { session?: { user?: { role?: string | null } } }).session;
    if (session?.user?.role !== role) {
      reply.code(403).send({ error: { code: "FORBIDDEN", message: "admin required", requestId: req.id } });
    }
  };
}
```

**Session-payload propagation** — `additionalFields` round-trip through `getSession`
automatically [CITED: `apps/api/src/auth.ts:322` shows `user: { email: string; locale?: string; tenantId?: string }` is the declared session shape — extend with `role?: string | null`].

**Confidence:** HIGH [VERIFIED: live precedent at auth.ts:270-279 and migration 0016]

---

## §3. `POST /api/setup/admin` Idempotency Contract

**Handler shape** (TDD-first — write the contract test before the handler):

```ts
// apps/api/src/routes/setup-admin.ts (NEW)
// Zod input matching the Phase 12 wizard form schema.
const setupAdminInput = z.object({
  email: z.string().email(),
  password: z.string().min(12),     // D-14 — min 12, no zxcvbn meter
  displayName: z.string().min(1).max(100),
  workspaceName: z.string().min(1).max(100),
  timezone: z.string().regex(/^[A-Za-z_]+\/[A-Za-z_/+\-0-9]+$/),  // IANA shape
});

export async function setupAdminHandler(req, reply): Promise<void> {
  const body = setupAdminInput.parse(req.body);

  // Step 1 — atomic claim of pending state. D-03 single-statement.
  const claim = await db.execute(sql`
    UPDATE setup_state
       SET status = 'completed', completed_at = now()
     WHERE id = 1 AND status = 'pending'
     RETURNING status, completed_at
  `);

  if (claim.rowCount === 0) {
    // Already completed (or skipped_legacy). D-15: return 200 with existing admin shape,
    // NOT 409. Race losers MUST be indistinguishable from a successful winner from the
    // client's POV (form disables on submit; this matches the wizard UX contract).
    const existing = await db.query.users.findFirst({ where: eq(users.role, "admin") });
    return reply.code(200).send({ admin: { email: existing?.email }, alreadyCompleted: true });
  }

  // Step 2 — winner branch. Create user via Better Auth signUpEmail (NOT direct
  // INSERT — Better Auth owns password hashing, verification flow, locale defaults).
  const result = await auth.api.signUpEmail({
    body: { email: body.email, password: body.password, name: body.displayName, locale: req.locale },
  });
  if (result.error) {
    // Roll back the claim — UPDATE setup_state SET status='pending', completed_at=NULL WHERE id=1.
    await db.execute(sql`UPDATE setup_state SET status='pending', completed_at=NULL WHERE id=1`);
    return reply.code(400).send({ error: { code: "ADMIN_CREATE_FAILED", message: result.error.message, requestId: req.id } });
  }

  // Step 3 — flip the new user to role='admin' (input:false prevents this via signUpEmail body).
  await db.update(users).set({ role: "admin" }).where(eq(users.id, result.data.user.id));

  // Step 4 — also write the workspace name into tenants table (single root tenant — Phase 1's
  // seeded 'default' UUID 00000000-0000-0000-0000-000000000000; UPDATE the name).
  await db.update(tenants).set({ name: body.workspaceName }).where(eq(tenants.id, DEFAULT_TENANT_ID));

  return reply.code(201).send({ admin: { email: body.email }, alreadyCompleted: false });
}
```

**Why this exact ordering** — the atomic claim runs FIRST so two simultaneous tabs
both attempting `/api/setup/admin` collapse to one winner. The loser branch returns
200 because the wizard's UX is "submit → success" — surfacing 409 would force the
client to handle a race condition that, by D-15, is not a user-visible error.

**Race rollback caveat:** if `signUpEmail` fails AFTER we've already flipped
`setup_state.status='completed'`, the rollback `UPDATE setup_state SET status='pending'`
re-opens the gate. This is correct: if admin creation failed, `/setup` should still be
reachable for retry. The window is small (single function call) but real.

**Open question for planner:** wrap steps 1–4 in a single Postgres transaction OR keep
them as separate statements with explicit rollback? Recommendation: **single transaction**
(BEGIN; UPDATE setup_state; signUpEmail; flip role; UPDATE tenants; COMMIT) — but Better
Auth's `signUpEmail` opens its own DB connection through the Drizzle adapter, so a wrapping
transaction would not contain it. **Decision: keep the explicit rollback path** — Better
Auth + transaction-wrap is documented-incompatible. [CITED: Better Auth issue #1841 — drizzleAdapter doesn't accept a transaction context]

**Confidence:** HIGH for contract; MEDIUM for transaction strategy (Better Auth boundary)

---

## §4. `/api/auth/providers` Derivation

[VERIFIED: `apps/api/src/auth.ts:108-128`] — current `readOidcProviders()` is private to
`auth.ts`. Phase 12 must extract it to a reusable helper.

**Refactor** — new `apps/api/src/lib/oidc-providers.ts`:

```ts
export interface ConfiguredProvider {
  id: "google" | "github" | "oidc";
  name: string;
  enabled: true;
}

export function listConfiguredOidcProviders(env = process.env): ConfiguredProvider[] {
  const result: ConfiguredProvider[] = [];
  // Generic OIDC — three envs all required (D-08).
  if (env.OIDC_ISSUER_URL && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET) {
    result.push({ id: "oidc", name: "SSO", enabled: true });
  }
  // Future Phase 14: Google / GitHub via Better Auth socialProviders block.
  // For Phase 12, only generic OIDC is wired (auth.ts:222 registers only genericOAuth).
  return result;
}
```

Then `auth.ts:108-128` calls this same helper for its own registration (zero drift, D-08).

**Endpoint shape** (registered as Fastify route, not Better Auth plugin — Better Auth's
namespace is `/api/auth/*` but plugin routes are scaffolded server-side. We register
under that prefix manually to honour the namespace-shape D-06 expects):

```ts
app.get("/api/auth/providers", async (req, reply) => {
  const providers = listConfiguredOidcProviders();
  const emailVerification = {
    required: process.env.BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION !== "false",
    configured: !!process.env.SMTP_HOST || process.env.NODE_ENV !== "production",
  };
  // ETag = sha256(JSON.stringify({providers, emailVerification})).slice(0,16)
  reply.header("Cache-Control", "public, max-age=60");
  reply.header("ETag", weakEtag(payload));
  return { providers, emailVerification };
});
```

**Better Auth ratelimit posture** — Better Auth's built-in rate limiter applies to
`/api/auth/*` paths matched against its plugin route table. Custom Fastify routes under
the same prefix are NOT auto-ratelimited; we must add a manual `@fastify/rate-limit`
preHandler. Recommend: 60 req/min/IP (matches Better Auth's default).

**Unit test** — `apps/api/src/lib/__tests__/oidc-providers.test.ts` asserts env→providers
mapping for 0/1/N providers (table-driven). This is the canonical TDD-RED entry point
for Plan 12-02.

**Confidence:** HIGH

---

## §5. `/api/capabilities` Phase 12 Payload Shape

**Phase 12 minimal payload** (additive-extension-safe for Phase 14):

```ts
{
  auth: {
    providers: [{ id, name, enabled }],   // same shape as /api/auth/providers
    emailVerification: { required, configured },
    setup: { status: "pending" | "completed" | "skipped_legacy" },
  },
  features: {
    transcribe: boolean,    // LITELLM_MASTER_KEY && groq/openai key
    agent:      boolean,    // Phase 5 web-search providers wired
    realtime:   boolean,    // speaches or compatible realtime
  },
  // Phase 14 will additively grow: { byok: {...}, slim: {...}, quotas: {...} }
}
```

**preHandler chain** — `[requireSession, requireTenantContext]`. There's a precedent at
`apps/api/src/routes/index.ts` where `/api/usage` and `/api/stt-config` already share
both preHandlers; `/api/capabilities` co-resides.

**ETag** — `(tenantId, env-hash, setup_status)` — env-hash already used by §4; adding
tenantId narrows cache per-tenant.

**Why separate from `/api/auth/providers`** — the public providers endpoint is
**pre-session** (sign-in page calls it BEFORE the user has a session). `/api/capabilities`
is **post-session** (in-app screens consume it). Mixing them would leak post-session caps
to anon callers. [VERIFIED: D-10 rejects broad-union-public for this exact reason]

**Confidence:** HIGH

---

## §6. shadcn-stepper Community Port

**Options researched** [ASSUMED — based on training data; planner should re-verify license at npm time]:
| Port | License | File footprint | a11y |
|------|---------|----------------|------|
| `damianricobelli/shadcn-stepper` | MIT | ~3 files; single `stepper.tsx` extractable | role="navigation" + step state attrs |
| `reui.io/r/stepper` | MIT | single CLI install file | similar a11y patterns |
| `stepperize` (npm package) | MIT | requires package install — violates D-12 "vendor a port" | — |

**Recommendation:** **damianricobelli/shadcn-stepper** — single-file extractable, MIT,
public Apache/MIT-compatible. Vendor as `apps/web/src/components/ui/stepper.tsx` with:

```ts
// SPDX-License-Identifier: MIT
// Vendored from damianricobelli/shadcn-stepper (commit XXX) per Phase 12 D-12.
// shadcn/ui has no official Stepper primitive — confirmed via shadcn-ui/ui#1422.
// Minimal modifications: import paths rewritten to "@/components/ui/*"; theme tokens
// aligned with apps/web/src/components/ui/* convention.
```

**a11y compliance check** — must pass axe (D-19 zero violations). Manual checklist:
- `role="navigation"` on outer wrapper or `<ol>`/`<ul>` of steps
- Each step has `aria-current="step"` when active
- Step labels are real text, not just icons (icon + sr-only text OK)
- Color contrast ≥ 4.5:1 for step labels (Tailwind 4 default tokens pass)

**Confidence:** MEDIUM (port choice [ASSUMED]; planner re-verifies license at install)

---

## §7. Wizard Form Architecture

**RHF7 + Zod3 schema** (matches existing `apps/web/src/lib/schemas/auth.ts:1-21` pattern):

```ts
// apps/web/src/lib/schemas/setup.ts
export const setupSchema = z.object({
  email:         z.string().email(),
  password:      z.string().min(12).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/),  // D-14 policy
  displayName:   z.string().min(1).max(100),
  workspaceName: z.string().min(1).max(100),
  timezone:      z.string().min(1),    // populated from Intl.supportedValuesOf
});
export type SetupInput = z.infer<typeof setupSchema>;
```

**Step-anchor implementation** — planner discretion (CONTEXT). **Recommend IntersectionObserver:**
- `useEffect` registers an IntersectionObserver on three `<section>` anchors (`#identity`, `#workspace`, `#review`)
- `threshold: 0.5` ensures the step indicator updates when half the section is visible
- Setting `setActiveStep(idx)` drives the shadcn-stepper's `activeStep` prop
- Single-page semantics preserved — no `<Tabs>`, no `<Form>` remount on step change

**Idempotent submit handling**:
- `form.handleSubmit` calls `fetch("/api/setup/admin", { method: "POST", body })`
- On `{ alreadyCompleted: true }` (race-loser 200) → identical success state as the winner
- On `{ alreadyCompleted: false }` (201) → identical success state
- On 4xx with `error.code === "ADMIN_CREATE_FAILED"` → field-level Zod error mapping via `form.setError("email", { message: t(`end-user.setup.error.${code}`) })`

**i18n keys to add** — under `apps/web/src/locales/{en,ru}/end-user.json`:
- `end-user.setup.title.*`, `end-user.setup.step.{identity,workspace,review}.title.*`
- `end-user.setup.form.{email,password,displayName,workspaceName,timezone}.label`
- `end-user.setup.form.submit.label`
- `end-user.setup.error.*` (per error code)
- `end-user.setup.success.title.*` / `.body.*`

en+ru parity must pass `apps/web/src/lib/__tests__/i18n-russian-coverage.test.ts` [VERIFIED file exists] — Phase 10 i18n gate auto-runs.

**Confidence:** HIGH for form structure; planner discretion on observer details

---

## §8. Timezone Picker

**Native `Intl.supportedValuesOf('timeZone')`:**
- Node.js 24 (LTS — project pin): ✓
- Chromium 1.60+ (Phase 13 Playwright lockfile): ✓
- All evergreen browsers since 2022: ✓ [CITED: caniuse.com/intl-supportedvaluesof]

**Default detection:** `Intl.DateTimeFormat().resolvedOptions().timeZone` — universal browser support; returns the IANA name (`"Europe/Moscow"`, `"America/New_York"`).

**Combobox vs Select tradeoff:**
- `Intl.supportedValuesOf('timeZone')` returns **~430 zones** (Node 24 ICU data, May 2026 [ASSUMED — verify with `node -e "console.log(Intl.supportedValuesOf('timeZone').length)"`])
- Plain shadcn `<Select>` is unusable at 430 options — must scroll/key-search
- shadcn `<Combobox>` (built on `cmdk`) provides type-ahead filtering — already vendored at `apps/web/src/components/ui/` (cmdk is a shadcn dep)

**Recommendation:** **cmdk-based Combobox**, default pre-selected from `resolvedOptions().timeZone`. Falls back to `"UTC"` if detection returns an unrecognized zone (defensive).

**Confidence:** HIGH (browser support); LOW for exact zone count (verify before plan)

---

## §9. Auth Screens Conditional Rendering

**Current state** [VERIFIED: `apps/web/src/components/screens/auth/OidcButtons.tsx:19-26`] — `OidcButtons` reads `process.env.NEXT_PUBLIC_OIDC_PROVIDERS` (a build-time bake-in defaulting to `"google,github,oidc"`). This is the source of TD-12.c — operator env on the API side (`OIDC_ISSUER_URL` etc.) doesn't propagate to the web's NEXT_PUBLIC build vars.

**Phase 12 refactor — fetch `/api/auth/providers` at mount:**

```ts
// apps/web/src/components/screens/auth/OidcButtons.tsx (REWRITE)
"use client";
export function OidcButtons({ namespace }: OidcButtonsProps): React.JSX.Element | null {
  const { providers, loading } = useAuthProviders();   // NEW hook — fetch /api/auth/providers
  if (loading) return null;                             // No spinner — D-23 zero-buttons-render assertion stays deterministic
  if (providers.length === 0) return null;
  // ... render buttons
}

// apps/web/src/components/screens/auth/useAuthProviders.ts (NEW)
export function useAuthProviders() {
  const [data, setData] = useState<{ providers: ConfiguredProvider[] } | null>(null);
  useEffect(() => {
    fetch("/api/auth/providers", { credentials: "omit" })
      .then(r => r.json()).then(setData).catch(() => setData({ providers: [] }));
  }, []);
  return { providers: data?.providers ?? [], loading: data === null };
}
```

**Why client useEffect, not RSC server-component fetch:**
- Sign-in / sign-up are Client Components (`"use client"`) — they need RHF + browser APIs
- Putting the fetch in the parent RSC layout would couple route layout to provider env, complicating the loading state
- Client-side fetch keeps the conditional render local to `OidcButtons`

**Deterministic "zero buttons rendered" assertion in Vitest+RTL:**
```ts
// Mock fetch to resolve with empty providers before mount, then:
const { container } = render(<OidcButtons namespace="signin" />);
await waitFor(() => expect(container.querySelectorAll('button')).toHaveLength(0));
```
The `loading → null` window means the test must `waitFor`, NOT synchronously assert. This is the only viable shape for D-19 "zero buttons" being deterministic.

**Confidence:** HIGH

---

## §10. UICONF-03 Per-Field Zod Error i18n

**zod `errorMap` pattern** — global setErrorMap via i18next translation:

```ts
// apps/web/src/lib/zod-i18n.ts (NEW)
import { z } from "zod";
import { i18n } from "./i18n-client";

z.setErrorMap((issue, ctx) => {
  // issue.path[0] = field name; issue.code = "too_small" / "invalid_type" / "invalid_string"
  const key = `validation.${issue.code}.${issue.path[0] ?? "_root"}`;
  const fallback = `validation.${issue.code}._default`;
  return { message: i18n.t(key, { defaultValue: i18n.t(fallback, { defaultValue: ctx.defaultError }) }) };
});
```

**i18n key layout** — under `apps/web/src/locales/{en,ru}/common.json`:
```json
"validation": {
  "too_small": {
    "_default": "Value is too short",
    "password": "Password must be at least 12 characters",
    "displayName": "Name is required"
  },
  "invalid_string": { "_default": "Invalid value", "email": "Email is not valid" },
  "invalid_type": { "_default": "Invalid input" }
}
```

**en+ru parity** — Phase 10 i18n test `apps/web/src/lib/__tests__/i18n-russian-coverage.test.ts` walks both locale trees and asserts identical keys. Adding `validation.*` keys to en/common.json MUST be mirrored in ru/common.json or this test fails. [VERIFIED file exists]

**Confidence:** HIGH

---

## §11. UICONF-06 Duplicate-Banner Root Cause

**ROOT CAUSE — FOUND** [VERIFIED: `apps/web/src/components/screens/auth/SignUpForm.tsx:102-115`]:

```tsx
<Alert variant="destructive" role="alert">
  <AlertTitle>
    {errorKind === "duplicate"
      ? t("end-user.signup.error.duplicate.text")     // ← key "duplicate.text"
      : t("end-user.signup.error.generic.text")}     // ← same key
  </AlertTitle>
  <AlertDescription>
    {errorKind === "duplicate"
      ? t("end-user.signup.error.duplicate.text")     // ← IDENTICAL key
      : t("end-user.signup.error.generic.text")}     // ← IDENTICAL key
  </AlertDescription>
</Alert>
```

`AlertTitle` and `AlertDescription` render the **same translation key**, producing
visually duplicated text inside ONE `role="alert"` element. The original D-21 framing
("exactly one banner") is met by `getAllByRole('alert').toHaveLength(1)` — BUT the
underlying UX bug is that the user sees the same sentence twice stacked.

**Fix locus — `SignUpForm.tsx` template, NOT the upstream Form component**:
- The `<Alert>`/`<AlertTitle>`/`<AlertDescription>` shadcn primitive is correct — title+desc by-design
- The bug is that the AUTHOR used the same i18n key for both slots
- Fix: introduce `.title.text` and `.body.text` sub-keys per error kind (mirrors the pattern at SignInForm.tsx:83-84 which correctly uses `.title.text` + `.body.text`)

**New i18n keys** (en + ru parity):
- `end-user.signup.error.duplicate.title.text` / `.body.text`
- `end-user.signup.error.generic.title.text` / `.body.text`

**Conformance test addition** — `apps/web/src/components/__tests__/conformance/SignUpForm.test.tsx`:
```ts
it("UICONF-06: renders exactly one banner element (no duplicate)", async () => {
  // trigger duplicate-email error path …
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  // structural assertion stronger than D-21: title and body must be DIFFERENT strings
  const alert = screen.getByRole('alert');
  const title = alert.querySelector('[data-slot="alert-title"]')?.textContent;
  const body  = alert.querySelector('[data-slot="alert-description"]')?.textContent;
  expect(title).not.toBe(body);
});
```

**JSX corroboration (added 2026-05-14):** `screens-user.jsx:97-183` (`ScreenSignUp`) renders **exactly one error surface** — it uses the `Field` component's `error` prop (mirroring U1 sign-in's `Field label="Email" error={...}` at L28), NOT a stacked AlertTitle+AlertDescription with duplicated text. Design intent confirms D-21's "exactly one banner" gate AND the §11 fix locus (per-error `.title.text` + `.body.text` keys in SignUpForm.tsx template).

**Confidence:** HIGH [VERIFIED source-line + JSX oracle cross-check]

---

## §12. Conformance Test Suite Layout

**Vitest+RTL structural conformance** (D-18):
```
apps/web/src/components/__tests__/conformance/
├── SignInForm.test.tsx
├── SignUpForm.test.tsx
├── OidcButtons.test.tsx
├── VerifyEmailClient.test.tsx
└── setup.test.tsx              # /setup wizard page
```

**Inventory chain (CORRECTED 2026-05-14):** **JSX source → markdown spec → conformance test.** The 5 runnable JSX files in `.planning/phases/07-frontend-ui-spec/design/` (`screens-user.jsx`, `screens-admin.jsx`, `ui.jsx`, `browser-window.jsx`, `tweaks-panel.jsx`) are the **source-of-truth**; `UI-SPEC-end-user.md` / `UI-SPEC-admin.md` are **human-derived from JSX**; conformance tests assert against role/label inventories **derived from JSX (cite by file:line)**.

- **Do NOT parse `design-canvas.jsx`** (1437 LOC Figma wrapper, host-only). D-20 stands for that file specifically.
- **DO hand-derive inventory from `screens-user.jsx` / `screens-admin.jsx` / `ui.jsx`.** Each conformance test file MUST include a header comment citing the JSX source line range, e.g.:
  ```tsx
  // SignInForm.test.tsx — conformance inventory derived from
  //   .planning/phases/07-frontend-ui-spec/design/screens-user.jsx:7-94 (ScreenSignIn)
  //   + ui.jsx:229-316 (AuthShell primitive)
  // Inventory items: see §16 "screens-user.jsx canonical oracle" table.
  ```
- Markdown UI-SPEC-*.md may be a useful secondary reference but ties to it WITHOUT the JSX citation will be rejected at review (UI-SPEC inherits from JSX, not vice versa)
- See §16 for the full per-screen inventory table

**Per-spec contributions to ≥90/90/90/90 coverage gate**:
- Each conformance test calls `render(<Component />)` and exercises mount-time code paths (i18n hooks, fetch effects, default form state) — counts toward `apps/web/src/**` coverage
- Existing `__tests__/SignUpForm.test.tsx` (170 LOC, 8 cases) stays — D-23-noted "extend, don't replace"
- NEW conformance specs add ~30-50 LOC each, asserting role/label inventory + UICONF-06 gate

**axe Playwright spec single-file** — `tests/conformance/ui-spec/axe.spec.ts`:
```ts
// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-05 / UICONF-05 — axe baseline on real Chromium.
// Reuses Phase 13 compose-harness (tests/e2e-cjm/support/compose-harness.ts).
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { bootStack, tearStack } from "../../e2e-cjm/support/compose-harness";

test.beforeAll(async () => { await bootStack(); });
test.afterAll(async () => { await tearStack(); });

for (const route of ["/sign-in", "/sign-up", "/verify-email", "/setup"]) {
  test(`axe baseline: ${route}`, async ({ page }) => {
    await page.goto(`http://localhost/${route}`);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])     // planner-discretion subset
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
```

**Axe rule subset recommendation** — `wcag2a + wcag2aa + wcag21a + wcag21aa` is the standard "WCAG 2.1 AA" gate. Excludes `best-practice` rules (which often surface false positives on heading hierarchy in single-page wizards). The wizard's stepper landmarks should still pass this subset cleanly.

**Confidence:** HIGH

---

## §13. UICONF-07 Resend-Verification CTA

**Surface decision** — render the CTA in **`SignInForm.tsx`** when Better Auth returns a verification-required error, NOT a separate route.

**Better Auth's existing endpoint** [CITED: better-auth.com/docs — `signIn.email` returns `{ error: { code: "EMAIL_NOT_VERIFIED" } }` when verification is enabled and the user hasn't verified; the corresponding resend is `authClient.sendVerificationEmail({ email })`].

**Implementation in `SignInForm.tsx`**:
```tsx
if (result.error?.code === "EMAIL_NOT_VERIFIED") {
  setVerificationRequired(true);   // NEW state
  return;
}
// …
{verificationRequired ? (
  <Alert role="alert">
    <AlertTitle>{t("end-user.signin.error.unverified.title.text")}</AlertTitle>
    <AlertDescription>{t("end-user.signin.error.unverified.body.text")}</AlertDescription>
    <Button type="button" onClick={() => authClient.sendVerificationEmail({ email: form.getValues("email") })}>
      {t("end-user.signin.action.resendVerification.label")}
    </Button>
  </Alert>
) : null}
```

**Copy keys (en + ru)** — `end-user.signin.error.unverified.title.text` / `.body.text` / `action.resendVerification.label`.

**Confidence:** HIGH

---

## §14. Plan-Split Strategy

**5 plans × 3 waves; ≤8 tasks per plan:**

### Wave 1 — Foundation (parallel-safe)

**Plan 12-01 — `setup_state` schema + migration + role column** (foundation; blocks 12-03)
1. RED: vitest schema test `packages/data/src/schema/__tests__/setup_state.test.ts`
2. GREEN: schema file `packages/data/src/schema/setup_state.ts` (D-01)
3. RED: migration test using testcontainers + squawk lint
4. GREEN: migration `0017_setup_state.sql` (singleton + v1 backfill + users.role ALTER)
5. Wire `additionalFields.role` in `apps/api/src/auth.ts` (input:false)
6. Atomic commit: schema + migration + auth.ts + tests
*Targets: ADMIN-01 (gating mechanism), ADMIN-03 (role + backfill)*

**Plan 12-02 — capability endpoints** (parallel with 12-01; blocks 12-03 + 12-04)
1. RED: unit test `apps/api/src/lib/__tests__/oidc-providers.test.ts` (0/1/N env permutations)
2. GREEN: extract `listConfiguredOidcProviders` from auth.ts:108-128
3. RED: route test `apps/api/src/routes/__tests__/auth-providers.test.ts` (200 + ETag + Cache-Control)
4. GREEN: `GET /api/auth/providers` handler + register in routes/index.ts
5. RED: route test for `/api/capabilities` (401 anon, 200 authed, ETag keyed on tenantId)
6. GREEN: `GET /api/capabilities` handler with minimal Phase 12 payload
7. RED: contract test asserting auth.ts:108-128 and oidc-providers.ts return identical lists
8. Atomic commit
*Targets: UICONF-01*

### Wave 2 — UI surfaces (depends on Wave 1)

**Plan 12-03 — wizard page + `POST /api/setup/admin`** (depends on 12-01, 12-02)
1. RED: handler contract test `apps/api/src/routes/__tests__/setup-admin.test.ts` (winner 201, loser 200, race-rollback)
2. GREEN: `POST /api/setup/admin` handler implementing §3 contract
3. Vendor `shadcn-stepper` → `apps/web/src/components/ui/stepper.tsx` with SPDX header (D-12)
4. RED: setup wizard component test `apps/web/src/components/__tests__/conformance/setup.test.tsx`
5. GREEN: `apps/web/src/app/(public)/setup/page.tsx` + Client Component wizard form (composes `ui.jsx:AuthShell` primitive per §16; document no-JSX-oracle deviation in component header comment)
6. Add zod `errorMap` global (apps/web/src/lib/zod-i18n.ts) + en+ru `validation.*` keys
7. Add `end-user.setup.*` i18n keys (en+ru parity)
8. Atomic commit
*Targets: ADMIN-01 (route), ADMIN-02, UICONF-03*

**Plan 12-04 — auth screens conditional render + `/admin` index + UICONF-06 fix + UICONF-07** (depends on 12-02)
1. RED: `useAuthProviders` hook test (mock fetch, asserts loading→data transitions)
2. GREEN: `apps/web/src/components/screens/auth/useAuthProviders.ts`
3. RED: OidcButtons conformance test asserting zero buttons when providers=[] (D-23 gate)
4. GREEN: rewrite OidcButtons to read hook (DELETE `NEXT_PUBLIC_OIDC_PROVIDERS` env read)
5. RED: SignUpForm conformance test (UICONF-06 — title ≠ body, single banner)
6. GREEN: fix SignUpForm.tsx:102-115 banner keys + add new i18n keys
7. RED: SignInForm test for unverified-email resend CTA (UICONF-07)
8. GREEN: SignInForm CTA + `apps/web/src/app/(admin)/admin/page.tsx` index page (mirrors `screens-admin.jsx:445-628` ScreenConfig structure — Shell + Sidebar kind="admin" + read-only alert + 2-col card grid; §15(h) prohibits surfacing user PII) + docs/operations.md bcrypt break-glass note (ADMIN-05)
*Targets: UICONF-02, UICONF-06, UICONF-07, ADMIN-04, ADMIN-05*

### Wave 3 — Conformance + e2e flip-green (depends on Waves 1+2 GREEN)

> **CORRECTION 2026-05-14:** Plan 12-05 split into **12-05a (Vitest+RTL structural)** + **12-05b (Playwright axe + cjm flip-green)** — each of {SignInForm, SignUpForm, OidcButtons, VerifyEmailClient, setup wizard, /admin index} now gets its own JSX-derived conformance test (6 files, ~50 LOC each), which is too much for one plan alongside axe + tag-flips.

**Plan 12-05a — UICONF-04 Vitest+RTL conformance suite (JSX-derived inventories)** (depends on 12-04 GREEN)
1. Hand-derive role/label inventory for `SignInForm` from `screens-user.jsx:7-94` + `ui.jsx:229-316` (AuthShell); inline as test constants
2. RED+GREEN: `apps/web/src/components/__tests__/conformance/SignInForm.test.tsx` — assert inventory + header comment citing JSX source
3. RED+GREEN: `conformance/SignUpForm.test.tsx` from `screens-user.jsx:97-183` (includes UICONF-06 single-banner + title≠body asserts; collaborates with Plan 12-04's fix landing first)
4. RED+GREEN: `conformance/OidcButtons.test.tsx` from `screens-user.jsx:15-25` (3 providers configured → 3 buttons; 0 providers → 0 buttons; ghost variant on generic OIDC)
5. RED+GREEN: `conformance/VerifyEmailClient.test.tsx` from `screens-user.jsx:186-260` (4 variants: pending/verifying/success/error)
6. RED+GREEN: `conformance/setup.test.tsx` for `/setup` wizard — JSX-derived inventory pulls from `ui.jsx:229-316` (AuthShell) + `ui.jsx:338-352` (Field) + `ui.jsx:326-336` (Btn); documents the no-JSX-oracle deviation in a header comment per §16
7. RED+GREEN: `conformance/admin-index.test.tsx` for `/admin` page — mirrors `screens-admin.jsx:445-628` (ScreenConfig) structure: Shell + Sidebar kind="admin" + page-head "Configuration" lede + read-only alert
8. Atomic commit (all 6 conformance test files + any drift fixes that surface)
*Targets: UICONF-04*

**Plan 12-05b — UICONF-05 axe baseline + CJM flip-green** (depends on 12-05a GREEN)
1. Bump `@axe-core/playwright` 4.10.2 → 4.11.2 (CONTEXT D-19 lock)
2. RED+GREEN: `tests/conformance/ui-spec/axe.spec.ts` reusing Phase 13 compose-harness; iterate routes `/sign-in`, `/sign-up`, `/verify-email`, `/setup`, `/admin`
3. Verify zero axe violations (rule set: `wcag2a + wcag2aa + wcag21a + wcag21aa`)
4. REMOVE `@expected-red @after-phase-12` tags from features/{admin-onboarding,signup-verify,oidc-providers}.feature lines 6, 17, 32, 6, 12 respectively (D-27)
5. Run `make e2e-cjm` end-to-end; verify all 5 scenarios (cjm-5.1, 5.3, 1.5, 7.1, 7.2) flip GREEN
6. Atomic commit
*Targets: UICONF-05, ADMIN-06*

**Wave ordering rationale**:
- Wave 1 plans (12-01, 12-02) are independent — can run in parallel; both are needed before Wave 2
- Plan 12-03 needs 12-01 (schema) + 12-02 (endpoint contracts); Plan 12-04 needs 12-02 (capability endpoint to consume)
- Plan 12-05 verifies — must run last, after all UI surfaces shipped

**Confidence:** HIGH

---

## §15. Threat Model

| # | Attack | Surface | Mitigation |
|---|--------|---------|------------|
| (a) | `/setup` GET hit after setup_state='completed' | Next.js page | Server-side guard in `apps/web/src/app/(public)/setup/page.tsx` — fetch `/api/capabilities` (or a public `/api/setup-state` mini-endpoint) at the RSC layer; if `setup.status !== 'pending'`, `redirect("/sign-in")`. NEVER render the form on completed installs. |
| (b) | Brute-force `POST /api/setup/admin` | Race attempt / spam | Route is naturally idempotent (D-03 atomic UPDATE), but add `@fastify/rate-limit` 5 req/min/IP. Once status='completed', every subsequent POST returns 200-already-completed — no admin override path. |
| (c) | `/api/auth/providers` info leak | Public endpoint | Return ONLY `{ id, name, enabled }` per provider. NEVER include `client_secret`, `discoveryUrl`, `issuer_url`, or full env. Contract test asserts response keys are exactly `{ providers, emailVerification }` with no extra fields. |
| (d) | `/setup` visible before migrations run | Stack boot race | `/api/health` exposes `migrations_completed` (Phase 13). Web app's `/setup` page reads `/api/capabilities` which 503s if migrations_completed=false. Render a "Server initializing" copy in that branch. |
| (e) | Role escalation via `POST /api/auth/sign-up/email` body | Better Auth public endpoint | `additionalFields.role` MUST be `input: false` (§2 above). Only `/api/setup/admin` server-side handler writes role='admin' after atomic claim. Contract test asserts a sign-up body with `{role:"admin"}` does NOT result in users.role='admin'. |
| (f) | Tab-clobbering during wizard submit | Two concurrent submits from same user | D-15 idempotency: both return 200 with the admin shape. Form's `submitting` state disables the button; UX is single-success. |
| (g) | Open redirect via wizard | Post-submit redirect | Mirror SignInForm's hardcoded `/app` redirect (apps/web/src/components/screens/auth/SignInForm.tsx:66 — `router.push("/app")` is the precedent). Wizard redirects to `/admin` after success — no `?next=` URL param read. |
| (h) | Admin screens leak user PII | `/admin` index page (ADMIN-04) | `screens-admin.jsx` A1 (ScreenAudit) surfaces actor emails (`elena@acme.dev` at L192, L215, L230) and IP addresses (L222, L685-702). Phase 12's `/admin` index MUST mirror only A3 (`ScreenConfig`, L445-628) which surfaces NO user PII — only env-var names + redacted values. **Phase 12 MUST NOT** ship A1/A2 mirrors (out of scope) and MUST NOT widen the `/admin` index to surface user counts, session lists, or audit-log rows before RLS-gated admin queries land in Phase 13+. |

**Confidence:** HIGH

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stepper UI primitive | Custom `<div>` step indicator | Vendor `damianricobelli/shadcn-stepper` (D-12) | a11y states + step transitions are non-trivial; existing port is MIT |
| Timezone autocomplete list | Hand-curated zone list | `Intl.supportedValuesOf('timeZone')` (D-13) | Browser+Node native; tracks IANA tzdata automatically |
| Idempotency lock | Advisory lock / Redis NX / app-level mutex | Atomic `UPDATE … RETURNING` (D-03, D-05) | PgBouncer txn-mode-safe; survives backup/restore; one source of truth |
| Password strength UX | zxcvbn library + visual bar | Zod policy + localized error (D-14) | Bundle size budget; canvas doesn't show it; revisit only if UX research demands |
| Form/error i18n | `if (lang==='ru') 'Ошибка'...` | zod `setErrorMap` + i18next namespace (§10) | Already wired; parity test (Phase 10) auto-enforces |
| OIDC providers truth | NEXT_PUBLIC_OIDC_PROVIDERS bake-in | Fetch `/api/auth/providers` at mount (D-06, D-08) | Operator env on API side must be capability-truth; build-time bake-in is the existing bug |
| a11y assertions in happy-dom | `expect(getByRole(...)).toBeInTheDocument()` for contrast | axe-core via Playwright on real Chromium (D-19) | happy-dom doesn't implement layout/contrast rules — Vitest "passing" would be a lie |

---

## Common Pitfalls

### P1. The "race-loser returns 409" trap
**What goes wrong:** Implementer adds 409 Conflict to the race-loser branch because "that's the standard idempotency code." **Why it's wrong:** D-15 mandates 200-with-existing-admin. Two browser tabs that both submit the wizard MUST both see success. **Avoid:** Write the contract test (Plan 12-03 task 1) BEFORE the handler — RED test asserts 200, not 409.

### P2. Conditional render flicker
**What goes wrong:** `useAuthProviders` returns `{ providers: [] }` initially; OidcButtons renders zero buttons, then re-renders with N buttons when fetch resolves → visible "buttons pop in" flash. **Avoid:** Use `loading: true` initially and return `null` while loading (§9). Tradeoff: short blank gap, but no flicker.

### P3. `additionalFields.role` with `input:true`
**What goes wrong:** Following the `locale` precedent and copy-pasting `input:true` opens the §15(e) role-escalation hole. **Avoid:** §2 spells it out — `input:false`. Contract test in Plan 12-01 task 5.

### P4. Migration squawk failure on `users.role`
**What goes wrong:** Adding `users.role` as `NOT NULL DEFAULT 'user'` triggers `adding-required-field` (a Phase 09 blocking rule). **Avoid:** Nullable `text`, no default. Role narrowing happens at app layer.

### P5. Wizard transaction across Better Auth boundary
**What goes wrong:** Wrapping the entire `/api/setup/admin` handler in `db.transaction(async (tx) => {...})` and passing `tx` to `auth.api.signUpEmail()` fails — Better Auth opens its own connection. **Avoid:** Explicit rollback path (§3 step 4); document in handler comment.

### P6. Parsing `design-canvas.jsx` — but DO read the OTHER 5 JSX files
**What goes wrong (overcorrection 1):** Implementer writes a Babel AST walker to extract role/label inventory from the 1437-LOC Figma-canvas wrapper. Walker breaks on inline JSX, postit wrappers, or canvas-positioning props. **What goes wrong (overcorrection 2 — the prior Phase 07 mistake):** Implementer reads the prior research's "design-canvas.jsx is static" framing and **ignores ALL 6 design JSX files** including the runnable ones. **Avoid both:** Hand-curate inventory from `screens-user.jsx`, `screens-admin.jsx`, `ui.jsx` (cite by file:line per §16) — NOT by AST-walking `design-canvas.jsx`. The wrapper is for visual designers; the screens are for conformance.

### P7. i18n key parity drift
**What goes wrong:** Adding `validation.*` keys to en/common.json but forgetting ru/common.json → CI fails on Phase 10's `i18n-russian-coverage.test.ts`. **Avoid:** Same atomic commit for en+ru (D-25).

### P8. Forgetting to remove `@expected-red` tags
**What goes wrong:** Wave 3 lands the UI but doesn't edit the feature files; Phase 13 harness still expects RED → 5 scenarios STILL marked failing. **Avoid:** Plan 12-05 task 5 is explicit — remove tags by line number.

---

## Code Examples

### Singleton table CHECK constraint pattern
```sql
CREATE TABLE "setup_state" (
  "id" smallint PRIMARY KEY CHECK (id = 1),
  …
);
-- Drizzle TS file declares column as smallint().primaryKey(); the CHECK lives in raw SQL.
```
Source: existing pattern in `packages/data/src/schema/tenants.ts:7-12` + Postgres docs on CHECK.

### Atomic claim-or-loser
```sql
UPDATE setup_state
   SET status = 'completed', completed_at = now()
 WHERE id = 1 AND status = 'pending'
 RETURNING status, completed_at;
-- rowCount=1 → winner; rowCount=0 → loser sees status already completed.
```

### Better Auth `additionalFields` precedent
```ts
// apps/api/src/auth.ts:270-279
user: {
  additionalFields: {
    locale: { type: "string", required: false, defaultValue: "en", input: true },
    role:   { type: "string", required: false, defaultValue: null, input: false },
  },
},
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Detect first-run by `SELECT count(*) FROM users` | Singleton `setup_state` enum table (D-01, D-05) | Phase 12 | Removes the "is `users>0` a fresh op?" ambiguity; explicit state |
| `NEXT_PUBLIC_OIDC_PROVIDERS` bake-in | Fetch `/api/auth/providers` at mount (D-06) | Phase 12 | Closes TD-12.c capability drift |
| Bcrypt `$$`-escaped htpasswd in `.env` | Wizard creates admin via Better Auth signUpEmail | Phase 12 | Closes TD-12.b + TD-12.f; basicauth remains break-glass only (ADMIN-05) |
| Pixel-diff snapshots for UI regression | Semantic DOM conformance + axe baseline (D-18, D-19) | Phase 12 | No image-fixture churn; honest a11y gate |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `damianricobelli/shadcn-stepper` is MIT and single-file extractable | §6 | LOW — planner re-verifies at vendor time; reui.io is documented fallback |
| A2 | `Intl.supportedValuesOf('timeZone')` returns ~430 entries on Node 24 | §8 | LOW — exact count affects only Combobox-vs-Select decision; both work |
| A3 | Better Auth `signIn.email` returns `{ error: { code: "EMAIL_NOT_VERIFIED" } }` | §13 | MEDIUM — if code string is different, the resend-CTA trigger needs adjustment; check at handler-test time |
| A4 | Better Auth's drizzleAdapter cannot accept an outer transaction context | §3 | MEDIUM — affects whether handler wraps in `db.transaction` or uses explicit rollback. If wrong, simpler tx path works |
| A5 | Phase 07.1 ignored design JSX files when implementing auth screens → drift expected | §16 implementation-status table | LOW — Plan 12-05a conformance test IS the audit that surfaces drift; no risk to plan, but task count in 12-04 may grow if drift is broad |
| A6 | The 5 runnable JSX files in `design/` are Phase 07-final and not superseded by a later doc | §16 | LOW — verified by `ls -la design/` timestamps (May 12); no later JSX commits found |

**If user-confirmation needed:** A3 + A4 are the two MEDIUM-risk items. Discuss-phase can lock by checking the Better Auth changelog for `EMAIL_NOT_VERIFIED` constant and the drizzleAdapter README on transaction support.

---

## Open Questions

1. **Workspace name → tenants table or new column?**
   - What we know: Phase 1 seeded a single `default` tenant with UUID `00000000-…`. The wizard collects a `workspaceName`.
   - What's unclear: do we UPDATE `tenants.name` for the singleton row, OR add `tenants.display_name` and keep `name` as a slug?
   - Recommendation: UPDATE `tenants.name` for v1 (single-tenant). Add a `display_name` column only when Phase 14 introduces multi-workspace UX.

2. **`/api/setup-state` mini-endpoint for the RSC guard?**
   - What we know: §15(a) wants the `/setup` page to redirect if status≠pending.
   - What's unclear: do we reuse `/api/capabilities` (authed — but the wizard caller isn't authed yet) OR add a tiny public `/api/setup-state` returning just `{status}`?
   - Recommendation: tiny public endpoint `/api/setup-state` returning `{status}`. Cache 30s. No info leak (the existence of a setup state isn't sensitive).

3. **Wizard composition without JSX oracle — confirm Plan 12-03's AuthShell mirror is the right baseline?**
   - What we know: NO `/setup` or `onboarding` artboard exists in any of the 6 design JSX files (grep verified 2026-05-14). `ui.jsx:229-316` `AuthShell` is the only auth-flow shell.
   - What's unclear: should the wizard reuse `AuthShell` (matches U1/U2/U3 visual language) OR ship its own shell (signals "this is operator-onboarding, not user-signup")?
   - Recommendation: **reuse `AuthShell`** with `sideTitle="Set up your OpenWhispr Server."` + `sideQuote="One-time admin onboarding. Takes about 60 seconds."`. Documented as a deliberate deviation in §16. Future visual designer may add a `ScreenSetup` artboard to `screens-admin.jsx`; until then this is the canonical baseline.

4. **Should `setup_state` migration also seed a default `setup_state.id=1` if neither branch (users-exist / users-empty) matches?**
   - What we know: §1 INSERT covers both branches via CASE.
   - What's unclear: if the migration runs in a brand-new DB with no `users` TABLE yet (older Phase 0 install where users came in a later migration), the `EXISTS (SELECT 1 FROM "users")` errors.
   - Recommendation: migration 0017 runs AFTER 0001_better_auth.sql which creates users — verified by ordering. No defensive branch needed.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@axe-core/playwright` | UICONF-05 axe spec | ✓ (pinned at root package.json:42 `^4.10.2`; CONTEXT D-19 locks `4.11.2`) | 4.10.2 → bump to 4.11.2 | — |
| `@playwright/test` | conformance spec | ✓ (Phase 13 lockfile) | 1.60.0 | — |
| Phase 13 compose-harness | axe spec boot | ✓ | `tests/e2e-cjm/support/compose-harness.ts` | — |
| Postgres 17 (testcontainers) | migration test | ✓ (existing pattern) | 17.x | — |
| Node 24 LTS | `Intl.supportedValuesOf` | ✓ | 24 LTS | — |
| `cmdk` for Combobox | Timezone picker | ✓ (shadcn dep) | latest | shadcn `<Select>` (degraded UX at ~430 zones) |
| `damianricobelli/shadcn-stepper` source | wizard Stepper | NEEDS VENDOR (no install — D-12 says vendor) | — | reui.io stepper port |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none blocking.
**Action:** bump `@axe-core/playwright` from 4.10.2 to 4.11.2 in Plan 12-05 task 3 to match CONTEXT D-19 lock.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Unit/structural framework | Vitest + @testing-library/react (happy-dom) |
| API contract framework | Vitest + testcontainers (real Postgres + PgBouncer) |
| Conformance / e2e framework | Playwright 1.60.0 + `@axe-core/playwright` 4.11.2 |
| BDD harness | Cucumber + playwright-bdd 8.5.x (Phase 13 — REUSED, not modified) |
| Quick run command | `pnpm -w test:unit` (Vitest only — fast feedback) |
| Full suite command | `pnpm -w test && make conformance && make e2e-cjm` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADMIN-01 | `/setup` gated by setup_state enum | unit + e2e | `pnpm --filter @openwhispr/data test setup_state.test.ts` + cjm-5.3 | ❌ Plan 12-01 + tag-flip 12-05 |
| ADMIN-02 | Wizard single-page + idempotent POST | contract + RTL | `pnpm --filter @openwhispr/api test setup-admin.test.ts` | ❌ Plan 12-03 |
| ADMIN-03 | users.role + additionalFields + backfill | migration + contract | testcontainers migration test + `auth.test.ts` extension | ❌ Plan 12-01 |
| ADMIN-04 | `/admin` index page | RTL + cjm-5.1 | conformance/setup.test.tsx + Phase 13 BDD | ❌ Plan 12-04 |
| ADMIN-05 | bcrypt break-glass documented; trap removed | docs lint + manual review | `make docs-lint` (Phase 13 lint-cjm-doc) | ❌ Plan 12-04 |
| ADMIN-06 | Wizard cjm GREEN | BDD | `make e2e-cjm -- --tags @cjm-5.3` | ❌ Plan 12-05 (tag flip) |
| UICONF-01 | `/api/auth/providers` + `/api/capabilities` | contract | `apps/api/src/routes/__tests__/auth-providers.test.ts` | ❌ Plan 12-02 |
| UICONF-02 | Auth screens conditional render | RTL conformance | `apps/web/src/components/__tests__/conformance/OidcButtons.test.tsx` | ❌ Plan 12-04 + Plan 12-05 |
| UICONF-03 | Per-field zod errors en+ru | RTL + i18n parity | `apps/web/src/lib/__tests__/zod-i18n.test.ts` + existing i18n-russian-coverage | ❌ Plan 12-03 |
| UICONF-04 | Semantic DOM conformance (JSX-derived) | RTL conformance | conformance/{SignInForm,SignUpForm,OidcButtons,VerifyEmailClient,setup,admin-index}.test.tsx (6 files) | ❌ Plan 12-05a |
| UICONF-05 | axe baseline | Playwright | `tests/conformance/ui-spec/axe.spec.ts` | ❌ Plan 12-05b |
| UICONF-06 | Single banner; title≠body | RTL | conformance/SignUpForm.test.tsx | ❌ Plan 12-04 |
| UICONF-07 | Resend-verification CTA | RTL | conformance/SignInForm.test.tsx | ❌ Plan 12-04 |

### Sampling Rate
- **Per task commit:** `pnpm --filter <touched-package> test` (Vitest only)
- **Per wave merge:** `pnpm -w test && pnpm -w typecheck && pnpm -w lint`
- **Phase gate:** Full suite green + `make conformance` zero violations + `make e2e-cjm` 5 scenarios flipped to GREEN before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `apps/web/src/components/__tests__/conformance/` directory + **6 test files** (SignInForm, SignUpForm, OidcButtons, VerifyEmailClient, setup, admin-index) — created in Plan 12-05a, each citing its `screens-{user,admin}.jsx:LINE` source per §16
- [ ] `tests/conformance/ui-spec/axe.spec.ts` — created in Plan 12-05
- [ ] `apps/web/src/lib/zod-i18n.ts` + tests — created in Plan 12-03
- [ ] `apps/api/src/lib/oidc-providers.ts` + tests — created in Plan 12-02
- [ ] `apps/api/src/routes/setup-admin.ts` + tests — created in Plan 12-03
- [ ] `packages/data/src/schema/setup_state.ts` + tests — created in Plan 12-01
- [ ] Framework installs: bump `@axe-core/playwright` 4.10.2 → 4.11.2 (root package.json:42)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Better Auth 1.6.9 emailAndPassword + genericOAuth (NEVER hand-roll) |
| V3 Session Management | yes | Better Auth's session cookie + token rotation (Phase 8 contract tests) |
| V4 Access Control | yes | `requireRole('admin')` Fastify preHandler (§2) + RLS-subject DB queries via `appDb` |
| V5 Input Validation | yes | Zod schemas (`setupAdminInput`, `signUpSchema`) — every API body + form |
| V6 Cryptography | yes | Better Auth password hashing (scrypt via Better Auth defaults) — NEVER hand-roll |
| V7 Error Handling | yes | Centralized error envelope `{ error: { code, message, requestId } }` (D-09) |
| V11 Business Logic | yes | Idempotency via atomic SQL claim (§3) — prevents replay/race-doubled admin |
| V14 Configuration | yes | env-gated provider registration; `input:false` on role additionalField |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Role escalation via signUpEmail body | E (Elevation) | `additionalFields.role: { input: false }` (§2 + §15.e) |
| `setup_state` race double-admin | T (Tampering) | Atomic UPDATE … WHERE status='pending' RETURNING (§3 + §15.f) |
| Public provider info leak | I (Information disclosure) | Response shape contract test — only `{id,name,enabled}` per provider (§15.c) |
| Open redirect via wizard post-submit | T | Hardcoded `/admin` redirect, NEVER read `?next=` (§15.g, mirrors SignInForm.tsx:60 pattern) |
| Brute-force setup POST | D (DoS) | `@fastify/rate-limit` 5 req/min/IP (§15.b) — and route is naturally idempotent |
| bcrypt-`$$` `.env` trap (TD-12.f) | S (Spoofing via doc-misread) | Wizard creates admin via Better Auth; basicauth becomes break-glass-only with documented rotation (ADMIN-05) |

---

## Project Constraints (from CLAUDE.md)

- **Strict TDD** — RED→GREEN→REFACTOR; each fix + its tests in the SAME atomic commit. Every plan task pair (RED test then GREEN impl) above honors this.
- **≥ 90/90/90/90 coverage** on lines/branches/functions/statements for all new/modified code. Conformance + handler + schema tests are sized to clear this.
- **E2E mandatory** — Wave 3 axe spec on real Chromium + Phase 13 BDD scenarios both gate this.
- **No mocks of internal logic** — migration test uses real Postgres via testcontainers (Phase 09 precedent); handler tests use real DB; only network boundaries (LiteLLM HTTP, SMTP) get mocked.
- **English-only source** — code/comments/commits all English; runtime UI copy en+ru parity (D-25).
- **GitHub Actions only** — no separate CI; Phase 12 lands inside existing `.github/workflows/`.
- **No `--legacy` flags / workarounds** — `additionalFields.role` is the sanctioned Better Auth surface; no monkey-patching.
- **1000 concurrent users target** — `/api/auth/providers` ETag-cached at 60s shrinks per-request work; `/api/capabilities` cached at 30s per tenantId; setup POST is one atomic UPDATE.
- **Atomic commits** — every plan task above pairs RED test + GREEN impl in the same commit (D-24).

---

## §16. Phase 07 Design JSX Inventory

> **NEW SECTION (Correction 2026-05-14).** The canonical oracle for Phase 12 UICONF-04. Every conformance assertion in Plan 12-05a MUST cite a row from this table.

### All 6 JSX files in `.planning/phases/07-frontend-ui-spec/design/`

| File | LOC | Role | Mountable? | Phase 12 Deliverable Citing It |
|------|-----|------|------------|--------------------------------|
| `design-canvas.jsx` | 1437 | Figma-canvas WRAPPER (`<DCSection>`, `<DCArtboard>`, `<DCPostIt>`, pan/zoom viewport, state sidecar) | **NO** — host shell only | None (D-20 STATIC) |
| `screens-user.jsx` | 1616 | **13 runnable user-facing screens** (U1-U13): ScreenSignIn, ScreenSignUp, ScreenVerify, ScreenUsage, ScreenAccount, ScreenTrxList, ScreenTrxDetail, ScreenNotesList, ScreenNoteDetail, ScreenNotesSearch, ScreenConvList, ScreenConvDetail, ScreenConvSearch | **YES** | UICONF-04 conformance for SignInForm, SignUpForm, OidcButtons, VerifyEmailClient (Plan 12-05a) |
| `screens-admin.jsx` | 630 | **3 runnable admin screens** (A1-A3): ScreenAudit, ScreenObservability, ScreenConfig | **YES** | ADMIN-04 `/admin` index structure (Plan 12-04 mirrors `ScreenConfig` card-grid layout) |
| `ui.jsx` | 440 | **Shared primitives**: `Icon` (53 icon SVG paths), `BrowserFrame`, `Shell`, `Sidebar` (NAV_ADMIN + NAV_USER), `TopBar`, `AuthShell` (split-panel auth wrap), `Badge`, `Btn`, `Field`, `Sk` (skeleton), `SkeletonTable`, `EmptyState`, `ErrorState` | **YES** | Setup wizard composes `AuthShell` (`ui.jsx:229-316`) + `Btn`/`Field`; admin index uses `Shell` + `Sidebar` |
| `browser-window.jsx` | 200 | macOS Chrome window chrome (`ChromeWindow`, `ChromeTabBar`, `ChromeToolbar`) | **YES** but design-only | None — pure visual chrome for design canvas |
| `tweaks-panel.jsx` | 664 | Tweaks shell + form-control helpers + host edit-mode protocol | **YES** but design-only | None — visual-designer tooling |

### `screens-user.jsx` — Canonical oracle citations for Phase 12 conformance

> Cite these line ranges in `apps/web/src/components/__tests__/conformance/*.test.tsx`.

| Screen | Function | Line range | Phase 12 conformance file | Inventory items (excerpt) |
|--------|----------|------------|---------------------------|---------------------------|
| **U1 Sign-in** | `ScreenSignIn` | `screens-user.jsx:7-94` | `SignInForm.test.tsx` | heading "Sign in" (L13), lede "Welcome back to your OpenWhispr Server." (L13), 3 OIDC buttons in `oidc-row` (L15-25): Google + GitHub + SSO/OIDC, `or-sep` "Or with email" (L26), Email field with error slot (L28-34), Password field with eye-toggle (L35-45), "Remember this device" checkbox (L54-75), "Forgot password?" link (L76-78), accent submit "Sign in" full-width (L81-83), footer "No account? Sign up" link (L85-90) |
| **U2 Sign-up** | `ScreenSignUp` | `screens-user.jsx:97-183` | `SignUpForm.test.tsx` | heading "Create account" (L104), lede "The first registered user becomes the admin of this server." (L105), `AuthShell` `sideTitle="Create your OpenWhispr account."` + `sideQuote="One account per self-host operator. The first signup becomes the admin."` (L100-102), Name field (L107-109), Email field (L110-112), Password field with strength meter (L113-132 — 4px bar + "Strong" label; **NOTE** Phase 12 D-14 REMOVES this), Terms+Privacy checkbox (L134-168), accent submit "Create account" full-width (L170-172), **EXACTLY ONE error surface** (the `Field` `error` prop pattern, L28 in U1, or via `lede` in U2 — design renders no duplicated banner; **corroborates UICONF-06 fix**) |
| **U3 Verify email** | `ScreenVerify` | `screens-user.jsx:186-260` | `VerifyEmailClient.test.tsx` | 4 variants: `pending` / `verifying` / `success` / `error` (L186-219), icon-circle 56px (L194-213) — icon switches `mail`/`check`/`alert`, sideTitle "Verify your email." (L189), heading per variant (L214-219), CTA per variant (L235-252): "Open mail app" / skeleton / "Continue to dashboard" / "Send a new link", secondary "Use a different email" ghost CTA (L253-255) |
| **OIDC button row** | inside `ScreenSignIn` | `screens-user.jsx:15-25` | `OidcButtons.test.tsx` | exactly 3 buttons when ALL 3 providers configured: `<Btn lg icon="google">Continue with Google`, `<Btn lg icon="github">Continue with GitHub`, `<Btn lg icon="key" kind="ghost">Continue with SSO (OIDC)` — `kind="ghost"` only on the generic OIDC button (visual hierarchy) |

### `ui.jsx` — Auth-wrap primitive (canonical for `/setup` deviation rationale)

`AuthShell` at `ui.jsx:229-316` is the **only** auth-flow shell in the design. Phase 12's `/setup` wizard, per Open Question (§7), has **no design oracle**. Recommended composition (Plan 12-03 task 5):

```tsx
// apps/web/src/app/(public)/setup/page.tsx
// Composes ui.jsx:AuthShell (L229-316) with sideTitle/sideQuote per the wizard intent,
// then renders the Stepper + form in the `<div className="form">` slot.
// Design-deviation rationale: no `/setup` artboard exists in any of the 6 JSX files
// (verified by grep 2026-05-14). The wizard mirrors the auth-flow visual language
// (AuthShell split-panel + Field + Btn primitives) but its content/steps are new.
```

### `screens-admin.jsx` — Canonical oracle for `/admin` index (ADMIN-04, closes TD-12.a)

| Screen | Function | Line range | Phase 12 deliverable | Structural mirror |
|--------|----------|------------|----------------------|-------------------|
| **A1 Audit log** | `ScreenAudit` | `screens-admin.jsx:4-251` | NOT in Phase 12 scope (Phase 13+ admin work) | — |
| **A2 Observability** | `ScreenObservability` | `screens-admin.jsx:281-442` | NOT in Phase 12 scope | — |
| **A3 Config** | `ScreenConfig` | `screens-admin.jsx:445-628` | **`/admin` index page** (ADMIN-04) | Card-grid 2-col (L478) with STT-config + note-recording cards + Effective-env table (L584-624) — Phase 12 implementation MAY omit the actual tables but MUST preserve the `Shell` + `Sidebar kind="admin"` + page-head + read-only alert (L462-476) structure |

### Phase 07.1 implementation status — what was shipped vs skipped

> Inferred from existing `apps/web/src/components/screens/auth/` directory + git log (2026-05-14).

| Design artboard | Phase 07.1 implemented? | Drift from JSX | Phase 12 action |
|-----------------|------------------------|----------------|-----------------|
| U1 Sign-in (`ScreenSignIn`) | ✓ `SignInForm.tsx` | Unknown until Plan 12-05a conformance test runs; **prior Phase 07.1 ignored JSX** → assume drift, audit via JSX-derived inventory | Conformance test in 12-05a CITES `screens-user.jsx:7-94` |
| U2 Sign-up (`ScreenSignUp`) | ✓ `SignUpForm.tsx` | Known: duplicate-banner bug (UICONF-06) is a drift from JSX which has single-error-surface pattern | Conformance test + fix in 12-04 + 12-05a |
| U3 Verify (`ScreenVerify`) | ✓ `VerifyEmailClient.tsx` | Unknown; audit 4 variants | Conformance test in 12-05a CITES `screens-user.jsx:186-260` |
| OIDC row (in `ScreenSignIn`) | ✓ `OidcButtons.tsx` | Known: reads `NEXT_PUBLIC_OIDC_PROVIDERS` build-time bake-in instead of capability endpoint (TD-12.c) | Refactor in 12-04 + conformance test 12-05a CITES `screens-user.jsx:15-25` |
| U4-U13 (Usage, Account, Trx, Notes, Conv) | Likely ✗ for v1 (Phase 12 scope is auth + onboarding + admin only) | n/a for Phase 12 | Out of scope |
| A1-A2 (Audit, Observability) | ✗ | n/a for Phase 12 | Out of scope (Phase 13+) |
| A3 Config | ✗ | Not implemented yet | Phase 12 ADMIN-04 ships `/admin` index mirroring `ScreenConfig` structure |
| `/setup` wizard | ✗ (new in Phase 12) | **No JSX oracle exists** — documented deviation per §7 | Plan 12-03 composes `AuthShell` primitive |

**Rule for Phase 12 implementers:** UICONF-04 is the audit that catches divergence from JSX. **Phase 12 MUST NOT widen drift** beyond what's documented above. If Plan 12-05a conformance reveals additional drift in SignInForm / SignUpForm / VerifyEmailClient / OidcButtons that isn't in the table above, the fix lands in Plan 12-04 (or a follow-up) before the conformance gate is allowed to pass.

**Confidence:** HIGH [VERIFIED by reading all 6 JSX files end-to-end on 2026-05-14; LOC counts match `wc -l` output]

---

## Sources

### Primary (HIGH confidence)
- `apps/api/src/auth.ts:108-128` (readOidcProviders), `:243` (canonical schema map), `:270-279` (additionalFields locale precedent), `:322` (session payload shape)
- `apps/web/src/components/screens/auth/SignUpForm.tsx:102-115` (duplicate-banner root cause)
- `apps/web/src/components/screens/auth/SignInForm.tsx:60-66,83-84` (open-redirect mitigation + Alert title/body pattern)
- `apps/web/src/components/screens/auth/OidcButtons.tsx:19-26` (NEXT_PUBLIC env read — TD-12.c source)
- `packages/data/src/schema/tenants.ts:1-12` (root-singleton precedent for setup_state)
- `packages/data/migrations/0016_users_locale.sql:1-17` (additive-migration precedent)
- `tools/lint-migrations.ts:31-48` (squawk BLOCKING_RULES enumeration)
- `tests/e2e-cjm/support/compose-harness.ts:1-40` (bootStack/tearStack contract for axe spec)
- `tests/e2e-cjm/features/{admin-onboarding,signup-verify,oidc-providers}.feature` (tag locations to flip)
- `.planning/phases/12-…/12-CONTEXT.md` (23 locked decisions D-01..D-27)
- **`.planning/phases/07-frontend-ui-spec/design/screens-user.jsx:1-1616`** (U1-U13 — canonical oracle for UICONF-04 user-facing screens)
- **`.planning/phases/07-frontend-ui-spec/design/screens-admin.jsx:1-630`** (A1-A3 — canonical oracle for ADMIN-04 `/admin` index)
- **`.planning/phases/07-frontend-ui-spec/design/ui.jsx:1-440`** (shared primitives: AuthShell L229-316, Field L338-352, Btn L326-336, Shell L137-155, Sidebar L170-203)
- **`.planning/phases/07-frontend-ui-spec/design/browser-window.jsx:1-200`** + **`tweaks-panel.jsx:1-664`** (design-time chrome only; not Phase 12 oracle)

### Secondary (MEDIUM confidence)
- shadcn/ui#1422 — confirmed no official Stepper primitive (referenced in CONTEXT D-12)
- Better Auth 1.6.9 docs — `additionalFields` surface + signUpEmail response shape

### Tertiary (LOW confidence — see Assumptions Log)
- exact entry count of `Intl.supportedValuesOf('timeZone')` on Node 24
- exact `EMAIL_NOT_VERIFIED` error code string from Better Auth (verify at Plan 12-04 task 7)
- exact transaction-context support in better-auth/adapters/drizzle (verify at Plan 12-03 task 1)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep already in tree; only one bump (axe-core 4.10.2→4.11.2) + one vendor (shadcn-stepper)
- Architecture: HIGH — CONTEXT.md locked the load-bearing choices; research verified each against live code
- Pitfalls: HIGH — each pitfall maps to a specific source-line risk
- Plan split: HIGH — 5 plans × 3 waves × ≤8 tasks; dependency ordering verified

**Research date:** 2026-05-14
**Valid until:** 2026-06-13 (30 days — stable stack)
