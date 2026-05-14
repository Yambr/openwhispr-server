# Phase 12: Admin Onboarding Wizard + UI-SPEC Conformance Audit (v2) — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 25 new + 5 modified
**Analogs found:** 25 / 25 (one no-analog: `stepper.tsx` — see "No Analog Found")

---

## File Classification

### Wave 1 — Foundation

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/data/src/schema/setup_state.ts` | schema (Drizzle table) | DDL | `packages/data/src/schema/tenants.ts` | exact (root singleton, no RLS) |
| `packages/data/src/schema/__tests__/setup_state.test.ts` | test (schema shape) | DDL introspection | `packages/data/migrations/__tests__/0016-users-locale.test.ts` | role-match |
| `packages/data/migrations/0017_setup_state.sql` | migration | DDL | `packages/data/migrations/0016_users_locale.sql` | exact (additive ALTER + new table) |
| `packages/data/migrations/__tests__/0017-setup-state.test.ts` | migration test | testcontainers / SQL | `packages/data/migrations/__tests__/0016-users-locale.test.ts` | exact |
| `apps/api/src/auth.ts` (MODIFY: extend `additionalFields`) | auth wiring | config | `apps/api/src/auth.ts:270-279` (locale precedent) | exact (in-file extension) |

### Wave 1 — Capability Endpoints

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/api/src/lib/oidc-providers.ts` | utility (env reader) | pure function | `apps/api/src/auth.ts:115-128` (`readOidcProviders`) | exact (extract+share) |
| `apps/api/src/lib/__tests__/oidc-providers.test.ts` | unit test | pure | env-permutation table tests under `apps/api/src/lib/__tests__/` | role-match |
| `apps/api/src/routes/auth-providers.ts` | route (public GET) | request-response | `apps/api/src/routes/stt-config.ts` (auth-gated GET) — **adapted: no dualAuth** | role-match |
| `apps/api/src/routes/__tests__/auth-providers.test.ts` | route test | request-response | `apps/api/src/routes/__tests__/stt-config.test.ts` | role-match |
| `apps/api/src/routes/capabilities.ts` | route (authed GET) | request-response | `apps/api/src/routes/usage.ts` | exact (dualAuth + tenant scope) |
| `apps/api/src/routes/__tests__/capabilities.test.ts` | route test | request-response | `apps/api/src/routes/__tests__/usage.integration.test.ts` | role-match |
| `apps/api/src/routes/index.ts` (MODIFY: register 2 routes) | route plug | wiring | `apps/api/src/routes/index.ts:178-202, 343-403` (conditional registration) | exact |

### Wave 2 — Wizard

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/api/src/routes/setup-admin.ts` | route (POST, idempotent) | CRUD + auth side-effect | `apps/api/src/routes/desktop-signin.ts` + `usage.ts` | role-match (no exact precedent for atomic UPDATE-claim) |
| `apps/api/src/routes/__tests__/setup-admin.test.ts` | route test | CRUD | `apps/api/src/routes/__tests__/registration.test.ts` + `desktop-signin.test.ts` | role-match |
| `apps/web/src/components/ui/stepper.tsx` | UI primitive (vendored) | rendering | **NO ANALOG** — see "No Analog Found" + SPDX header pattern from `apps/web/src/components/ui/button.tsx` | role-match (header) only |
| `apps/web/src/app/(public)/setup/page.tsx` | Next.js route page (RSC entry) | server render → client form | `apps/web/src/app/(public)/sign-in/page.tsx` | exact |
| `apps/web/src/components/screens/auth/SetupForm.tsx` (or co-located) | Client Component form | RHF + Zod + fetch | `apps/web/src/components/screens/auth/SignUpForm.tsx` | exact |
| `apps/web/src/lib/schemas/setup.ts` | Zod schema | validation | `apps/web/src/lib/schemas/auth.ts` (signUpSchema) | exact |
| `apps/web/src/lib/zod-i18n.ts` | utility (errorMap) | i18n config | `apps/web/src/lib/i18n-client.ts` | role-match |

### Wave 2 — Auth screens refactor + `/admin` index

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/web/src/components/screens/auth/useAuthProviders.ts` | hook | fetch + state | inline fetch in existing client components | role-match |
| `apps/web/src/components/screens/auth/OidcButtons.tsx` (REWRITE) | client component | fetch-driven render | self (current implementation lines 19-26 — to be REPLACED) | exact |
| `apps/web/src/components/screens/auth/SignUpForm.tsx` (MODIFY: banner-fix) | client component | render | `apps/web/src/components/screens/auth/SignInForm.tsx:83-84` (correct `.title.text` + `.body.text` pattern) | exact |
| `apps/web/src/components/screens/auth/SignInForm.tsx` (MODIFY: UICONF-07 CTA) | client component | render | self (existing Alert block) | exact |
| `apps/web/src/app/(admin)/admin/page.tsx` | Next.js page | static render | `apps/web/src/app/(admin)/admin/config/page.tsx` *(exists per `ls` output)* + `screens-admin.jsx:445-628` JSX oracle | role-match |

### Wave 3 — Conformance tests + axe

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/web/src/components/__tests__/conformance/SignInForm.test.tsx` | conformance test | RTL render-and-assert | `apps/web/src/components/screens/auth/__tests__/SignInForm.test.tsx` + JSX oracle `screens-user.jsx:7-94` | exact (template) + JSX oracle |
| `apps/web/src/components/__tests__/conformance/SignUpForm.test.tsx` | conformance test | RTL | `apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx` + `screens-user.jsx:97-183` | exact |
| `apps/web/src/components/__tests__/conformance/OidcButtons.test.tsx` | conformance test | RTL with fetch mock | sibling test files + `screens-user.jsx:15-25` | role-match |
| `apps/web/src/components/__tests__/conformance/VerifyEmailClient.test.tsx` | conformance test | RTL | `apps/web/src/components/screens/auth/__tests__/VerifyEmailClient.test.tsx` + `screens-user.jsx:186-260` | exact |
| `apps/web/src/components/__tests__/conformance/setup.test.tsx` | conformance test | RTL | SignUpForm test + `ui.jsx:229-316` (AuthShell primitive, no `/setup` JSX oracle) | role-match |
| `apps/web/src/components/__tests__/conformance/admin-index.test.tsx` | conformance test | RTL | sibling test files + `screens-admin.jsx:445-628` ScreenConfig | role-match |
| `tests/conformance/ui-spec/axe.spec.ts` | Playwright e2e | browser navigation | `tests/e2e-cjm/support/compose-harness.ts` consumers (reuse `bootStack`/`tearStack`) | role-match |
| `tests/e2e-cjm/features/{admin-onboarding,signup-verify,oidc-providers}.feature` (MODIFY: remove tags) | gherkin tags | tag edit | self | exact |

---

## Pattern Assignments

### `packages/data/src/schema/setup_state.ts` (schema, DDL)

**Analog:** `packages/data/src/schema/tenants.ts` (entire file, 12 LOC)

**SPDX + header comment pattern** (lines 1-4):
```ts
// SPDX-License-Identifier: Apache-2.0
// Root tenant table — NOT tenant-scoped. NO RLS attaches here.
// See RESEARCH-DB §"First migration" and CONTEXT D-17 for the seeded
// `default` tenant row with stable UUID 00000000-0000-0000-0000-000000000000.
```
→ Phase 12 header: cite `CONTEXT D-02` (operator-global, no RLS) and `CONTEXT D-01` (singleton + pgEnum).

**Drizzle table declaration** (lines 5-12):
```ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```
→ Phase 12 adapts: `smallint("id").primaryKey()` + `pgEnum("setup_state_status", [...])` + `setupStateStatus("status").notNull().default("pending")` (RESEARCH §1 has full code).

---

### `packages/data/migrations/0017_setup_state.sql` (migration, DDL)

**Analog:** `packages/data/migrations/0016_users_locale.sql` (entire file, 17 LOC)

**Comment-block + additive ALTER pattern** (lines 1-17):
```sql
-- Phase 10 / Plan 10-01c — users.locale column.
--
-- Adds the per-user preferred locale used by the API i18next negotiation
-- chain ...
-- NOT NULL DEFAULT 'en' backfills every existing row at column add time so
-- no follow-up UPDATE statement is required. ...

ALTER TABLE "users"
  ADD COLUMN "locale" text NOT NULL DEFAULT 'en'
  CHECK (locale IN ('en', 'ru'));
```
→ Phase 12 migration body comes verbatim from RESEARCH §1 (lines 165-191). Same header style: phase/plan tag + rationale + squawk-posture note.

---

### `packages/data/migrations/__tests__/0017-setup-state.test.ts` (migration test)

**Analog:** `packages/data/migrations/__tests__/0016-users-locale.test.ts` (lines 1-60+)

**Testcontainer boot pattern** (lines 7-19):
```ts
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BootResult, bootMigratedPostgres } from "../../src/__tests__/helpers.js";

let booted: BootResult | undefined;

beforeAll(async () => {
  booted = await bootMigratedPostgres({ withPgPartman: true });
}, 180_000);

afterAll(async () => {
  if (booted) await booted.stop();
}, 60_000);
```

**Information-schema introspection assertions** (lines 22-42):
```ts
const { rows } = await pool.query<{...}>(
  `SELECT data_type, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'locale'`,
);
expect(rows[0]!.data_type).toBe("text");
```
→ Phase 12 adapts: query `setup_state` columns + `pg_constraint` for `CHECK (id=1)` + insert-twice test for singleton + CHECK rejection test.

---

### `apps/api/src/auth.ts` (MODIFY — extend `additionalFields`)

**Analog:** `apps/api/src/auth.ts:270-279` (locale precedent)

**Existing pattern** (lines 270-279):
```ts
user: {
  additionalFields: {
    locale: {
      type: "string",
      required: false,
      defaultValue: "en",
      input: true,
    },
  },
},
```
→ Phase 12 EXTENDS the same block (RESEARCH §2):
```ts
user: {
  additionalFields: {
    locale: { type: "string", required: false, defaultValue: "en", input: true },
    role:   { type: "string", required: false, defaultValue: null,  input: false },
  },
},
```
**Critical:** `input: false` — RESEARCH §15(e) threat-model item; tests must assert that a public sign-up body with `{ role: "admin" }` does NOT escalate.

---

### `apps/api/src/lib/oidc-providers.ts` (utility, extracted)

**Analog:** `apps/api/src/auth.ts:115-128` (current private `readOidcProviders`)

**Existing logic** (lines 115-128):
```ts
function readOidcProviders(): OidcProviderConfig[] {
  const issuer = process.env.OIDC_ISSUER_URL;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  if (!issuer || !clientId || !clientSecret) return [];
  return [{ providerId: "oidc", discoveryUrl: `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`, clientId, clientSecret }];
}
```
→ Phase 12 extracts to new file, exports two-call API:
- `listConfiguredOidcProviders(env)` returns public `{ id, name, enabled }[]` (NO secrets) — consumed by `/api/auth/providers`
- The original full-config version stays in `auth.ts` calling the same helper for env→Better-Auth registration (zero-drift, D-08).

---

### `apps/api/src/routes/auth-providers.ts` (route, public GET)

**Analog:** `apps/api/src/routes/usage.ts` (lines 1-73) — closest tiny GET route.

**Header + plugin shape** (usage.ts lines 1-37):
```ts
// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 02 / Task 2 — GET /api/usage (WIRE-10).
//
// Wire shape: BACKEND_SPEC.md:416-435.
// ...

export interface UsageDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildUsageRoutes = (deps: UsageDeps) =>
  async function usageRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/usage",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => { ... },
    });
  };
```
→ Phase 12 `/api/auth/providers` differs in:
- **NO** `req.user`/`req.tenant` guard (public endpoint).
- ADD `Cache-Control: public, max-age=60` + weak ETag from env-hash (RESEARCH §4).
- Rate-limit budget `{ max: 60, timeWindow: "1 minute" }` (matches Better Auth default per §4).

**Response shape** (RESEARCH §4):
```ts
reply.header("Cache-Control", "public, max-age=60");
reply.header("ETag", weakEtag(payload));
return { providers, emailVerification };
```

---

### `apps/api/src/routes/capabilities.ts` (route, authed GET)

**Analog:** `apps/api/src/routes/usage.ts` (entire file) — exact template for authed + tenant-scoped GET.

**Auth + tenant pattern** (usage.ts lines 40-61):
```ts
handler: async (req, reply) => {
  if (!req.user || !req.tenant) {
    throw new AuthError("UNAUTHORIZED", "unauthorized");
  }
  const tenantId = req.tenant;
  const userId = req.user.id;
  // ... withTenant(deps.db, tenantId, async (tx) => { ... });
  return reply.code(200).send({ ... });
},
```
→ Phase 12 capabilities handler returns the §5 payload `{ auth: { providers, emailVerification, setup: { status } }, features: { transcribe, agent, realtime } }`. ETag keyed on `(tenantId, env-hash, setup_status)`.

---

### `apps/api/src/routes/setup-admin.ts` (route, POST idempotent)

**Analog:** No exact precedent for the atomic-UPDATE-claim pattern. Closest is `apps/api/src/routes/desktop-signin.ts` (auth-side-effect POST). Use the SHAPE of `usage.ts` for plugin/header/error handling.

**Idempotent contract** (from RESEARCH §3 — verbatim handler body to implement):
```ts
const claim = await db.execute(sql`
  UPDATE setup_state
     SET status = 'completed', completed_at = now()
   WHERE id = 1 AND status = 'pending'
   RETURNING status, completed_at
`);
if (claim.rowCount === 0) {
  const existing = await db.query.users.findFirst({ where: eq(users.role, "admin") });
  return reply.code(200).send({ admin: { email: existing?.email }, alreadyCompleted: true });
}
// Winner branch — Better Auth signUpEmail + rollback-on-error
const result = await auth.api.signUpEmail({ body: { email, password, name, locale } });
if (result.error) {
  await db.execute(sql`UPDATE setup_state SET status='pending', completed_at=NULL WHERE id=1`);
  return reply.code(400).send({ error: { code: "ADMIN_CREATE_FAILED", ... } });
}
await db.update(users).set({ role: "admin" }).where(eq(users.id, result.data.user.id));
return reply.code(201).send({ admin: { email }, alreadyCompleted: false });
```
**Test analog:** `apps/api/src/routes/__tests__/registration.test.ts` (route-build harness) + `desktop-signin.test.ts` for the success+error split.

---

### `apps/api/src/routes/index.ts` (MODIFY — register 3 routes)

**Analog:** Same file, lines 178-202 (unconditional registration) + lines 343-403 (conditional-on-deps).

**Unconditional pattern** (lines 178-185):
```ts
const verificationDeps: VerificationStatusDeps = { db: deps.db, auth: deps.auth };
const deleteAccountDeps: DeleteAccountDeps = { db: deps.db, auth: deps.auth };
const desktopSigninDeps: DesktopSigninDeps = { db: deps.db };
```
→ Phase 12 adds `authProvidersDeps`, `capabilitiesDeps`, `setupAdminDeps` in the same block; routes register unconditionally (no LiteLLM gate — these are DB+auth-only).

**Plugin push pattern** (lines 340-341):
```ts
plugins.push(buildUsageRoutes(usageDeps));
plugins.push(buildKeysRevokeRoutes({ db: deps.db } satisfies KeysRevokeDeps));
```

---

### `apps/web/src/app/(public)/setup/page.tsx` (Next.js RSC page)

**Analog:** `apps/web/src/app/(public)/sign-in/page.tsx` (entire file, 11 LOC):

```tsx
// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 07 — U1 Sign-in route.
//
// Pure RSC entry that hands off to the Client SignInForm. The form
// hardcodes its post-signin destination to "/app" — we do NOT honor a
// `?next=` query parameter (open-redirect mitigation per
// 07.1-RESEARCH.md § Security Domain).
import { SignInForm } from "@/components/screens/auth/SignInForm";

export default function SignInPage(): React.JSX.Element {
  return <SignInForm />;
}
```
→ Phase 12 `setup/page.tsx`: same shape PLUS RSC-side guard (RESEARCH §15(a)) — fetch `/api/capabilities` (or mini `/api/setup-state`); if `setup.status !== 'pending'`, `redirect("/sign-in")`. NO open-redirect (no `?next=` param read; D-15 hardcodes `/admin` post-success).

---

### `apps/web/src/components/screens/auth/SetupForm.tsx` (Client Component wizard)

**Analog:** `apps/web/src/components/screens/auth/SignUpForm.tsx` (entire file, 181 LOC) — exact template.

**Client-component header + imports** (lines 1-35):
```tsx
// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 07 — U2 Sign-up form.
"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { useZodForm } from "@/lib/form-utils";
import { signUpSchema } from "@/lib/schemas/auth";
```
→ Phase 12: same imports + add `Stepper` from `@/components/ui/stepper` + `setupSchema` from `@/lib/schemas/setup`.

**RHF + Zod form pattern** (lines 39-77):
```tsx
const form = useZodForm({
  schema: signUpSchema,
  defaultValues: { name: "", email: "", password: "" },
  mode: "onSubmit",
});
async function onSubmit(values) {
  setSubmitting(true);
  try {
    const result = await authClient.signUp.email({ ... });
    if (result.error) { ... }
    setSuccess(true);
  } catch { ... } finally { setSubmitting(false); }
}
```
→ Phase 12 swaps `authClient.signUp.email` for `fetch("/api/setup/admin", { method: "POST", body: JSON.stringify(values) })`; success → `router.push("/admin")` (D-15 hardcoded redirect).

**FormField pattern** (lines 122-134) — repeat per Identity/Workspace/Review section, wrapped in 3 `<section id="identity|workspace|review">` anchors that drive the Stepper.

**Header comment must include** (per RESEARCH §16 / D-20):
```tsx
// Conformance inventory: composes ui.jsx:AuthShell (L229-316) + ui.jsx:Field (L338-352)
// + ui.jsx:Btn (L326-336). No /setup JSX oracle exists; documented design deviation
// per RESEARCH §16.
```

---

### `apps/web/src/lib/schemas/setup.ts` (Zod schema)

**Analog:** `apps/web/src/lib/schemas/auth.ts` (signUpSchema). Phase 12 schema verbatim from RESEARCH §7 lines 487-495.

---

### `apps/web/src/components/screens/auth/useAuthProviders.ts` (hook)

**Analog:** No identical hook exists in tree; pattern from RESEARCH §9 lines 558-567:
```ts
export function useAuthProviders() {
  const [data, setData] = useState<{ providers: ConfiguredProvider[] } | null>(null);
  useEffect(() => {
    fetch("/api/auth/providers", { credentials: "omit" })
      .then(r => r.json()).then(setData).catch(() => setData({ providers: [] }));
  }, []);
  return { providers: data?.providers ?? [], loading: data === null };
}
```

---

### `apps/web/src/components/screens/auth/OidcButtons.tsx` (REWRITE)

**Analog:** Self (lines 1-77). Replace lines 19-26 (the `process.env.NEXT_PUBLIC_OIDC_PROVIDERS` read) with a `useAuthProviders()` call.

**Keep verbatim** (lines 28-33):
```ts
function labelKey(ns: "signin" | "signup", provider: KnownProvider): string {
  const slot = provider === "oidc" ? "sso" : provider;
  return `end-user.${ns}.oidc.${slot}.label`;
}
```

**Replace** (lines 40-44):
```ts
export function OidcButtons({ namespace }: OidcButtonsProps): React.JSX.Element | null {
  const { t } = useTranslation(["end-user"]);
  const [pending, setPending] = useState<KnownProvider | null>(null);
  const { providers, loading } = useAuthProviders();
  if (loading) return null;
  if (providers.length === 0) return null;
  // ... rest unchanged
}
```

---

### `apps/web/src/components/screens/auth/SignUpForm.tsx` (MODIFY — banner fix)

**Analog:** `apps/web/src/components/screens/auth/SignInForm.tsx:83-84` (CORRECT pattern):
```tsx
<AlertTitle>{t("end-user.signin.error.title.text")}</AlertTitle>
<AlertDescription>{t("end-user.signin.error.body.text")}</AlertDescription>
```

**Bug locus** (SignUpForm.tsx lines 102-115 — duplicated key):
```tsx
<Alert variant="destructive" role="alert">
  <AlertTitle>
    {errorKind === "duplicate"
      ? t("end-user.signup.error.duplicate.text")  // ← same key
      : t("end-user.signup.error.generic.text")}
  </AlertTitle>
  <AlertDescription>
    {errorKind === "duplicate"
      ? t("end-user.signup.error.duplicate.text")  // ← IDENTICAL
      : t("end-user.signup.error.generic.text")}
  </AlertDescription>
</Alert>
```
→ Fix per RESEARCH §11: introduce `.title.text` + `.body.text` sub-keys per `errorKind`. Mirror SignInForm shape exactly.

---

### `apps/web/src/components/screens/auth/SignInForm.tsx` (MODIFY — UICONF-07 CTA)

**Analog:** Self (existing Alert block in same file). Add `verificationRequired` state branch per RESEARCH §13 (verbatim block).

---

### `apps/web/src/app/(admin)/admin/page.tsx` (Next.js page)

**Analog:** `apps/web/src/app/(admin)/layout.tsx` (entire file):
```tsx
// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 06 — Admin route group layout (D-ADMIN-1).
// NO session check here. Admin gating is performed at the Traefik edge ...
import { AdminShell } from "@/components/screens/AdminShell";

export default function AdminLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return <AdminShell>{children}</AdminShell>;
}
```
**JSX oracle:** `screens-admin.jsx:445-628` (`ScreenConfig`) — read-only alert at L462-476 + 2-col card grid at L478.

→ Phase 12 page structure: `<Shell><Sidebar kind="admin" /><PageHead title="Configuration" /><Alert role="status">[read-only]</Alert><CardGrid>...</CardGrid></Shell>`. RESEARCH §15(h): **MUST NOT** mirror A1 (audit) or A2 (observability) — those surface PII.

---

### `apps/web/src/components/__tests__/conformance/SignInForm.test.tsx` (conformance test)

**Analogs (BOTH required):**
1. **Test template** — `apps/web/src/components/screens/auth/__tests__/SignInForm.test.tsx` (lines 1-100)
2. **JSX oracle** — `.planning/phases/07-frontend-ui-spec/design/screens-user.jsx:7-94` (`ScreenSignIn`) + `ui.jsx:229-316` (`AuthShell`)

**Mocks + I18nProvider pattern** (analog lines 12-37):
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/sign-in",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }) => <a href={href}>{children}</a>,
}));
const signInEmail = vi.fn();
const signInSocial = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { email: signInEmail, social: signInSocial } },
}));
```

**i18n resources stub pattern** (analog lines 39-73):
```tsx
const resources = {
  "end-user": {
    "end-user": {
      signin: { title: { heading: { text: "Sign in to OpenWhispr" } }, ... },
    },
  },
} as Record<string, Record<string, unknown>>;
function Wrap({ children }) {
  return <I18nProvider lng="en" resources={resources}>{children}</I18nProvider>;
}
```

**Required header comment** (per RESEARCH §12 + D-20):
```tsx
// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-05a — UICONF-04 conformance inventory derived from
//   .planning/phases/07-frontend-ui-spec/design/screens-user.jsx:7-94 (ScreenSignIn)
//   + ui.jsx:229-316 (AuthShell primitive)
// Inventory items: see 12-RESEARCH.md §16 table (heading L13, lede L13,
// 3 OIDC buttons L15-25, or-sep L26, Email field L28-34, Password L35-45,
// Remember checkbox L54-75, Forgot link L76-78, Submit L81-83, footer L85-90).
```

**Mock `fetch('/api/auth/providers')`** to drive deterministic 0/N OIDC button assertion (RESEARCH §9 lines 574-580).

---

### `apps/web/src/components/__tests__/conformance/SignUpForm.test.tsx`

**Analogs:** sibling `SignUpForm.test.tsx` (existing 183 LOC) + `screens-user.jsx:97-183`.

**UICONF-06 single-banner gate** (verbatim from RESEARCH §11 lines 657-665):
```tsx
it("UICONF-06: renders exactly one banner element (no duplicate)", async () => {
  // trigger duplicate-email error path …
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  const alert = screen.getByRole('alert');
  const title = alert.querySelector('[data-slot="alert-title"]')?.textContent;
  const body  = alert.querySelector('[data-slot="alert-description"]')?.textContent;
  expect(title).not.toBe(body);
});
```

---

### `apps/web/src/components/__tests__/conformance/OidcButtons.test.tsx`

**Analogs:** sibling auth test files + `screens-user.jsx:15-25`.

**Inventory (from RESEARCH §16):** 3 providers configured → 3 buttons (Google + GitHub + SSO/OIDC); 0 providers → 0 buttons; `kind="ghost"` only on generic OIDC.

**Fetch-mock pattern** — `global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ providers: [...] }) })` then `await waitFor(...)`.

---

### `apps/web/src/components/__tests__/conformance/VerifyEmailClient.test.tsx`

**Analogs:** sibling `VerifyEmailClient.test.tsx` (existing) + `screens-user.jsx:186-260` (4 variants: `pending`/`verifying`/`success`/`error`).

---

### `apps/web/src/components/__tests__/conformance/setup.test.tsx`

**Analog:** SignUpForm conformance test template.
**JSX oracle:** **NONE for `/setup`** — compose `ui.jsx:229-316` (AuthShell) + `ui.jsx:338-352` (Field) + `ui.jsx:326-336` (Btn). Header MUST document this design deviation.

---

### `apps/web/src/components/__tests__/conformance/admin-index.test.tsx`

**Analog:** sibling conformance tests.
**JSX oracle:** `screens-admin.jsx:445-628` (ScreenConfig). Assert structural mirror: Shell + Sidebar `kind="admin"` + page-head "Configuration" lede + read-only alert (L462-476).
**Security gate (RESEARCH §15(h)):** assert ZERO user-PII surfaces — no email strings, no IP addresses, no audit-log rows.

---

### `tests/conformance/ui-spec/axe.spec.ts` (Playwright + axe-core)

**Analog:** Phase 13 compose-harness consumers; verbatim spec body from RESEARCH §12 lines 705-725:
```ts
// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-05b / UICONF-05 — axe baseline on real Chromium.
// Reuses Phase 13 compose-harness (tests/e2e-cjm/support/compose-harness.ts).
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { bootStack, tearStack } from "../../e2e-cjm/support/compose-harness";

test.beforeAll(async () => { await bootStack(); });
test.afterAll(async () => { await tearStack(); });

for (const route of ["/sign-in", "/sign-up", "/verify-email", "/setup", "/admin"]) {
  test(`axe baseline: ${route}`, async ({ page }) => {
    await page.goto(`http://localhost/${route}`);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
```
**Dep bump:** `@axe-core/playwright@4.10.2 → 4.11.2` (CONTEXT D-19 lock).

---

## Shared Patterns

### SPDX + phase-tagged header
**Source:** `apps/web/src/components/ui/button.tsx:1` + `packages/data/src/schema/tenants.ts:1-4`
**Apply to:** Every new file
```ts
// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-XX — <one-line purpose>.
//
// <rationale, citing CONTEXT D-NN and/or RESEARCH §N>.
```

### Defensive 401 guard in authed handlers
**Source:** `apps/api/src/routes/usage.ts:40-44`
**Apply to:** `/api/capabilities` handler (NOT `/api/auth/providers` — public)
```ts
if (!req.user || !req.tenant) {
  throw new AuthError("UNAUTHORIZED", "unauthorized");
}
```

### Error envelope
**Source:** `apps/api/src/errors.ts` (AuthError) + RESEARCH §1 D-09
**Apply to:** All new API handlers
```ts
{ error: { code: "ERR_CODE", message: "...", requestId: req.id } }
```

### Drizzle migration header
**Source:** `packages/data/migrations/0016_users_locale.sql:1-13`
**Apply to:** `0017_setup_state.sql`
- Phase/plan tag in line 1
- Multi-line rationale
- Explicit squawk-posture note (which rules apply, why we pass)
- Backfill semantics documented inline

### Testcontainer boot for migration tests
**Source:** `packages/data/migrations/__tests__/0016-users-locale.test.ts:7-19`
**Apply to:** `0017-setup-state.test.ts`
```ts
import { bootMigratedPostgres } from "../../src/__tests__/helpers.js";
beforeAll(async () => { booted = await bootMigratedPostgres({ withPgPartman: true }); }, 180_000);
afterAll(async () => { if (booted) await booted.stop(); }, 60_000);
```

### Vitest+RTL conformance test scaffold
**Source:** `apps/web/src/components/screens/auth/__tests__/SignInForm.test.tsx:12-81`
**Apply to:** All 6 files under `apps/web/src/components/__tests__/conformance/`
- `vi.mock("next/navigation"|"next/link"|"@/lib/auth-client")`
- `resources` literal with namespaced i18n keys
- `Wrap` component using `<I18nProvider lng="en" resources={resources}>`
- Conformance tests ADD `// SPDX` header + JSX-oracle citation (file:line) — see RESEARCH §12

### Better Auth `additionalFields` extension
**Source:** `apps/api/src/auth.ts:270-279`
**Apply to:** Only `auth.ts` modification (add `role` next to `locale`)
- `input: false` whenever the field must NOT be settable from public sign-up bodies (RESEARCH §2 + §15(e))

### Route registration in `routes/index.ts`
**Source:** `apps/api/src/routes/index.ts:178-202, 340-341`
**Apply to:** Three new routes (auth-providers, capabilities, setup-admin)
```ts
const authProvidersDeps: AuthProvidersDeps = { /* env reader */ };
plugins.push(buildAuthProvidersRoutes(authProvidersDeps));
```
All three register UNCONDITIONALLY (no LiteLLM gate — DB+auth-only).

### Hardcoded post-success redirect (open-redirect mitigation)
**Source:** `apps/web/src/components/screens/auth/SignInForm.tsx:60-66` (citation in RESEARCH §15(g))
**Apply to:** Wizard success branch — `router.push("/admin")`, no `?next=` param read.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/web/src/components/ui/stepper.tsx` | UI primitive | rendering | NEW vendored shadcn community port (D-12). No existing Stepper primitive in `apps/web/src/components/ui/`. Apply only the SPDX-header convention from `button.tsx:1` and the `data-slot`/`data-variant` attribute style from `button.tsx:53-56`. Vendor source: `damianricobelli/shadcn-stepper` per RESEARCH §6 (planner to re-verify MIT/Apache compatibility at install). Header MUST cite source + commit per RESEARCH §6 lines 462-469. |

---

## Metadata

**Analog search scope:**
- `packages/data/src/schema/` (1 file matched — tenants.ts; root singleton)
- `packages/data/migrations/` (16 migrations + 2 test files)
- `apps/api/src/routes/` (40+ route files; usage.ts + stt-config.ts + desktop-signin.ts surfaced as best matches)
- `apps/api/src/auth.ts` (additionalFields precedent for locale at lines 270-279; readOidcProviders at 115-128)
- `apps/web/src/app/(public)/` (sign-in/sign-up/verify-email pages)
- `apps/web/src/app/(admin)/` (admin layout + admin/config + admin/observability subpages)
- `apps/web/src/components/screens/auth/` (4 components + 3 tests)
- `apps/web/src/components/ui/` (17 shadcn primitives; no Stepper)
- `.planning/phases/07-frontend-ui-spec/design/` (6 JSX oracle files — `screens-user.jsx`, `screens-admin.jsx`, `ui.jsx` are the canonical UICONF-04 oracles per D-20)
- `tests/e2e-cjm/support/compose-harness.ts` (Playwright + axe entry point)

**Files scanned:** ~80 (focused on role-matched directories per RESEARCH §16 canonical-refs)

**Pattern extraction date:** 2026-05-14
