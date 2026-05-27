---
quick_id: 260527-im6
slug: admin-claim-hybrid-hardening
title: "Hybrid admin claim hardening — env-token OR verified-email (v1.0.11)"
date: 2026-05-27
status: planned
revision: 2
mode: quick-full
calibration_tier: standard
source_audit: .planning/debug/admin-onboarding-security-audit-2026-05-27.md
findings_closed: [HIGH-Dim5, MEDIUM-Dim8, MEDIUM-Dim9, LOW-O1]
locked_decisions: [D1, D2, D3, D4]
research: .planning/quick/260527-im6-admin-claim-hybrid-hardening/RESEARCH.md
context: .planning/quick/260527-im6-admin-claim-hybrid-hardening/CONTEXT.md
release:
  api_image_tag: "1.0.11"
  chart_version: "1.0.14"
  app_version: "1.0.11"
better_auth_version: "1.6.11"
---

# Hybrid Admin Claim Hardening — PLAN

> **Single executor remit.** Implement Findings #5 (HIGH), #8 (MEDIUM), #9 (MEDIUM), O1 (LOW) from the 2026-05-27 admin-onboarding audit. CONTEXT.md decisions D1..D4 + cross-cutters C1/C2 are LOCKED. RESEARCH.md citations are AUTHORITATIVE — do not re-derive. Every claim in this PLAN traces back to RESEARCH §Rn / pitfall Pn / cross-cutter CCn.

> **Revision 2 (2026-05-27)** — plan-checker YELLOW adjustments applied: A1 (single-parse: `validateSetupClaimBoot` returns parsed `Buffer`, threaded through deps; no re-parse in route), A2 (`ADDITIONAL_ALLOWED_ORIGINS` env knob + Origin guard accepts an array of strict-equality allowed origins), A3 (drop dead `/i` flag from bad-pattern regexes; lowercase-only shape gate makes it unreachable). A4 is no-op (`completed_at` column confirmed in schema; planner had cited correctly).

---

## 1. Goal

After this lands, **an unauthenticated attacker MUST NOT be able to take over the admin role on a fresh OpenWhispr instance**, even given network access to `/api/setup/admin`, regardless of whether they pick an email they don't control or fire a cross-origin POST during the operator's pre-claim window. The wizard becomes claimable in EXACTLY one of two modes (and the boot guard refuses to run if neither is configured):

| Mode | How attacker is stopped |
|------|------------------------|
| **A — env-token (Bearer hex64)** | Attacker lacks the operator-set `OPENWHISPR_SETUP_CLAIM_TOKEN`; timing-safe compare blocks brute-force; Origin allowlist blocks cross-origin POST. |
| **B — verified-email** | `role='admin'` flip is gated behind the `afterEmailVerification` Better Auth hook; attacker cannot click a magic-link sent to an inbox they don't control. Origin allowlist blocks cross-origin POST. |

`admin.role_changed` is emitted to `audit_log` on EVERY transition (closes O1).

---

## 2. Scope

### 2.1 In scope (this PLAN owns)

1. **`apps/api/src/config/setup-claim.ts` (NEW).** Boot validator, token parser, timing-safe comparator, custom error type. (D1 + D2 + D4)
2. **`apps/api/src/index.ts` (EDIT).** Wire `validateSetupClaimBoot` AFTER `db` construction (line ~1073, after `probeOwnerPool`), BEFORE `buildApp(buildOpts)` (line 1152). Plus production `completeSetupAdmin` closure passed to `buildAuth`. (R4 + R8 + P11)
3. **`apps/api/src/auth.ts` (EDIT).** Extend `BuildAuthOptions` with optional `completeSetupAdmin`; add `emailVerification.afterEmailVerification` closure that delegates to it. (D3 + R1 + R8.1)
4. **`apps/api/src/routes/setup-admin.ts` (EDIT).** Add Origin preHandler + Bearer-vs-email branch logic. Drop `signUpEmail`-then-flip from the email branch; keep synchronous flip in Bearer branch. Add `schema: { body: setupAdminInput }` (pre-emptive LOCKER-04). Response body grows `pending_verification: true` on email branch. (D2 + C2 + R6 + R8.3 + P13)
5. **`apps/api/src/routes/setup-state.ts` (EDIT).** Same Origin preHandler attached as defence-in-depth. (C2)
6. **`apps/api/src/routes/index.ts` (EDIT).** Plumb `completeSetupAdmin` through to `buildAuth` call site if a wider change is needed (small adapter only; see Task 4).
7. **`docs/operations.md` (EDIT/NEW SECTION).** New "Admin Claim Modes" section per scope item 5 in the request.
8. **`charts/openwhispr-server/Chart.yaml` + `values.yaml` (EDIT).** Chart bump 1.0.13 → 1.0.14; appVersion / image tag 1.0.10 → 1.0.11; new `setupClaim.tokenSecretRef` knob; ConfigMap projection of `OPENWHISPR_SETUP_CLAIM_TOKEN`.
9. **Tests (NEW + EXTEND).** Unit + integration coverage as specified in §5. Coverage gate ≥ 90/90/90/90 on diff.

### 2.2 NOT in scope (explicitly deferred — do not silently expand)

- Task #52 follow-up: `users.role` CHECK constraint, partial unique index `WHERE role='admin'`, schema column for `claim_mode`, `tools/lint-no-extra-setup_state-writers.ts` lint. → Tracked separately.
- Tenant isolation in setup-admin (audit Dim 6 / CLAUDE.md DISCIPLINE rule 16). → v2 blocker.
- 24h cleanup worker for stale unverified-pending-admin rows. → Separate quick task; document as deferred in `docs/operations.md` cross-ref.
- One-time-link UX redesign for email branch (Better Auth's native send-verification flow is sufficient).
- `/api/_test/reset-setup` hardening — already production-vetoed at plugin-registration time (audit E6).
- Replacing the env-token with an `openwhispr setup-link` one-time CLI link.

---

## 3. Files modified (table)

| # | Path | Nature | LOC est. |
|---|------|--------|----------|
| 1 | `apps/api/src/config/setup-claim.ts` | NEW: parser (returns `Buffer \| undefined`; A3 — bad-pattern regexes lowercase-only, no `/i`) + timing-safe comparator + async boot validator returning `Promise<SetupClaimBootValidation>` with `envTokenBuffer?: Buffer` so the parsed token threads through to the route deps without a second parse (A1) + custom error class | ~190 |
| 2 | `apps/api/src/auth.ts` | EDIT: extend `BuildAuthOptions` with `completeSetupAdmin?`; add `emailVerification.afterEmailVerification` closure (~25 lines) | +30 |
| 3 | `apps/api/src/routes/setup-admin.ts` | EDIT: split handler by Bearer-vs-email; add Origin preHandler (consumes deps-injected allowed-origins array per A2); declare `schema: { body }`; drop `safeParse`; add `pending_verification:true` on email branch; drop `signUpEmail`-then-flip from email branch; consume `deps.envClaimTokenBuffer` (A1 — no re-call to `parseSetupClaimToken`) | +95 / -30 |
| 4 | `apps/api/src/routes/setup-state.ts` | EDIT: attach shared Origin preHandler (same deps-injected array per A2) | +8 |
| 5 | `apps/api/src/routes/index.ts` | EDIT: pass `completeSetupAdmin` through `buildAuth` and `setup-admin` deps if needed | +5 |
| 6 | `apps/api/src/index.ts` | EDIT: import + invoke `validateSetupClaimBoot` after db construction; capture returned `envTokenBuffer` and thread into `SetupAdminDeps.envClaimTokenBuffer` (A1); construct + pass `completeSetupAdmin` closure; build the shared `allowedOrigins: string[]` constant (canonical + `ADDITIONAL_ALLOWED_ORIGINS` per A2) for the route preHandler factory | +70 |
| 7 | `docs/operations.md` | EDIT: new section "Admin Claim Modes" + `ADDITIONAL_ALLOWED_ORIGINS` paragraph (A2) | +135 |
| 8 | `charts/openwhispr-server/Chart.yaml` | EDIT: version 1.0.13 → 1.0.14; appVersion 1.0.10 → 1.0.11 | 2 lines |
| 9 | `charts/openwhispr-server/values.yaml` | EDIT: image.tag 1.0.10 → 1.0.11; new `setupClaim.tokenSecretRef` knob + lineage comment | +15 |
| 10 | `charts/openwhispr-server/templates/api-deployment.yaml` (or values projection) | EDIT: project `OPENWHISPR_SETUP_CLAIM_TOKEN` from operator-managed Secret | +12 |
| 11 | `apps/api/tests/unit/config/__tests__/setup-claim.test.ts` | NEW: full positive + negative matrix for parser + comparator + boot validator (incl. A2 `ADDITIONAL_ALLOWED_ORIGINS` boot-validation cases, A1 `envTokenBuffer` return-shape assertion) | ~300 |
| 12 | `apps/api/tests/unit/routes/__tests__/setup-admin.test.ts` | EXTEND: 7-case + 4-extras suite gets ~8 new cases (Bearer match/mismatch, Origin allow/block via canonical + additional, email branch shape) | +200 |
| 13 | `apps/api/tests/unit/__tests__/auth-after-email-verification.test.ts` | NEW: closure-wiring unit test (hook calls `completeSetupAdmin` when present; no-ops when absent) | ~80 |
| 14 | `apps/api/tests/integration/__tests__/setup-admin-hybrid.test.ts` | NEW: T1..T6 (see §5) | ~420 |

Total: ~10 production-code edits + 4 test files. Targets ~50–55% context for the executor; if it overruns, the executor MUST stop and request a split — see §11.

---

## 4. Implementation order (TDD; one logical commit per step)

Atomic commits per CLAUDE.md DISCIPLINE rule (test + production code land together). RED → GREEN → REFACTOR per CLAUDE.md TDD posture. Step 0 sets up the harness; each subsequent step lands tests + production code in ONE commit.

### Step 0 — Branch + skeleton

- Create branch: `260527-im6-admin-claim-hybrid-hardening`
- No code yet. Pre-flight: `pnpm install` + `pnpm -r lint --since main` to confirm baseline clean.

### Step 1 — Wave 0 (a): token parser + timing-safe comparator + tests

Files touched: `apps/api/src/config/setup-claim.ts` (NEW, partial), `apps/api/tests/unit/config/__tests__/setup-claim.test.ts` (NEW, partial).

RED first: write the parser/comparator tests (positive + negative shape matrix from §5.U-A) and watch them fail.

GREEN: implement `OPENWHISPR_SETUP_CLAIM_TOKEN_FORMAT`, `parseSetupClaimToken`, `safeTokenCompare`, `SetupClaimConfigError`. NO boot validator yet — that's Step 2.

Exports for this step:

```
export const OPENWHISPR_SETUP_CLAIM_TOKEN_FORMAT = /^[0-9a-f]{64}$/;

export class SetupClaimConfigError extends Error {
  override name = "SetupClaimConfigError";
  constructor(message: string) { super(message); }
}

// Bad-pattern allowlist (D4).
//
// A3 — the upstream shape gate (OPENWHISPR_SETUP_CLAIM_TOKEN_FORMAT, lowercase hex64)
// guarantees `raw` is already lowercase ASCII by the time these run, so the `/i`
// flag is unreachable dead code. Drop it from every regex below — the lowercase
// shape gate is the single source of truth for case.
const BAD_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /^([0-9a-f])\1{63}$/,                 // single-char repeat (all zeros, all a's, etc.) — no /i flag
  /^(deadbeef){8}$/,                    // canonical test/marker hex — no /i flag
  /^(0123456789abcdef){4}$/,            // ascending-hex repeat — no /i flag
];
// Plus an exact-string allowlist seeded from docs/operations.md §Admin Claim Modes example.
// Wired in Step 6: docs author and code author keep the example in sync via a single export.
export const REJECTED_EXAMPLE_TOKENS: ReadonlySet<string> = new Set<string>([
  // Filled at Step 6 with whatever literal docs/operations.md prints as the
  // "EXAMPLE — DO NOT REUSE" value. Boot validator rejects this value verbatim.
]);

export function parseSetupClaimToken(env: NodeJS.ProcessEnv): Buffer | undefined {
  const raw = env.OPENWHISPR_SETUP_CLAIM_TOKEN?.trim();
  if (!raw) return undefined;
  if (!OPENWHISPR_SETUP_CLAIM_TOKEN_FORMAT.test(raw)) {
    throw new SetupClaimConfigError(
      `OPENWHISPR_SETUP_CLAIM_TOKEN does not match the canonical hex64 shape (/^[0-9a-f]{64}$/). Generate with: openssl rand -hex 32`,
    );
  }
  // From this point onward `raw` is guaranteed lowercase ASCII hex by the shape gate above.
  // The bad-pattern regexes therefore do NOT need the /i flag (A3).
  for (const re of BAD_TOKEN_PATTERNS) {
    if (re.test(raw)) {
      throw new SetupClaimConfigError(
        `OPENWHISPR_SETUP_CLAIM_TOKEN matches a low-entropy / well-known pattern (${re.source}). Generate a fresh token with: openssl rand -hex 32`,
      );
    }
  }
  if (REJECTED_EXAMPLE_TOKENS.has(raw)) {
    throw new SetupClaimConfigError(
      `OPENWHISPR_SETUP_CLAIM_TOKEN matches the docs example value verbatim. Do NOT use the docs example in production; generate a fresh token with: openssl rand -hex 32`,
    );
  }
  return Buffer.from(raw, "hex");
}

export function safeTokenCompare(presented: Buffer | undefined, expected: Buffer | undefined): boolean {
  if (!presented || !expected) return false;
  if (presented.length !== expected.length) return false;
  // crypto.timingSafeEqual contract empirically verified (RESEARCH R3.1) — throws on
  // unequal lengths; we pre-validate to avoid the throw.
  // biome-ignore lint/style/useNamingConvention: stdlib import
  const { timingSafeEqual } = require("node:crypto") as typeof import("node:crypto");
  return timingSafeEqual(presented, expected);
}
```

Commit message: `feat(api,setup-claim): token parser + timing-safe comparator (D2/D4)`

### Step 2 — Wave 0 (b): async boot validator + tests

Files: `apps/api/src/config/setup-claim.ts` (EDIT, finish), `apps/api/tests/unit/config/__tests__/setup-claim.test.ts` (EDIT, finish).

RED: write the boot-validator matrix tests (§5.U-B) and watch them fail.

GREEN: implement `validateSetupClaimBoot`. **ASYNC** (must `SELECT status FROM setup_state WHERE id = 1`). Mirror `validateAuthBoot`'s `(env, onFail)` signature + `defaultFail` shape (R4.1). Defensive-default a missing row to `'pending'` (R2 §defensive read default).

**A1 — the validator parses the env-token EXACTLY ONCE and returns the parsed `Buffer` (or `undefined`) on its result.** The route layer consumes that same Buffer through `SetupAdminDeps.envClaimTokenBuffer` — there is no second call to `parseSetupClaimToken` anywhere in the boot path. The dead-code temptation to re-parse in `setup-admin.ts` is closed by deletion.

```
export interface SetupClaimBootValidation {
  readonly hasEnvToken: boolean;
  /**
   * A1 — the parsed env-token Buffer (or `undefined` when the env var is unset).
   * Threaded into `SetupAdminDeps.envClaimTokenBuffer`. The route MUST NOT re-call
   * `parseSetupClaimToken`; that would double-parse and double-validate.
   */
  readonly envTokenBuffer?: Buffer;
  readonly hasSmtp: boolean;
  readonly setupStateStatus: "pending" | "completed" | "skipped_legacy";
}

export interface SetupClaimBootInput {
  readonly db: TransactionalDb<ExecutableTx>;
  readonly env?: NodeJS.ProcessEnv;
  readonly onFail?: (message: string) => never;
}

export async function validateSetupClaimBoot(
  input: SetupClaimBootInput,
): Promise<SetupClaimBootValidation> {
  const env = input.env ?? process.env;
  const onFail: (message: string) => never = input.onFail ?? defaultFail;

  // Test-env permissive default (R4.1 §6) — vitest sets NODE_ENV=test.
  // The dedicated setup-claim.test.ts suite passes onFail spies + an explicit
  // env snapshot to exercise the strict matrix without killing the runner.
  const isTest = env.NODE_ENV === "test";

  // Parse the env-token (may throw SetupClaimConfigError on shape/entropy fail).
  // A1 — this is the single canonical call site; the route does NOT re-parse.
  let envBuffer: Buffer | undefined;
  try {
    envBuffer = parseSetupClaimToken(env);
  } catch (err) {
    if (err instanceof SetupClaimConfigError) {
      onFail(`setup-claim-boot: ${err.message}`);
    }
    throw err;
  }
  const hasEnvToken = envBuffer !== undefined;
  const hasSmtp = Boolean(env.SMTP_HOST?.trim());

  // Read setup_state.status from the canonical singleton row. Defensive default
  // when the row is missing (e.g. brand-new install where migrations have not yet
  // applied — should not happen post-Phase-12, but defensive).
  let status: "pending" | "completed" | "skipped_legacy" = "pending";
  try {
    await input.db.transaction(async (tx: ExecutableTx) => {
      const result = (await tx.execute(sql`SELECT status FROM setup_state WHERE id = 1`)) as {
        rows?: Array<{ status?: "pending" | "completed" | "skipped_legacy" }>;
      };
      const row = result.rows?.[0];
      if (row?.status) status = row.status;
    });
  } catch (err) {
    // DB query failure at boot is NOT a no-op — propagate so the operator sees it
    // (matches validateBetterAuthSecretBoot's posture). Do NOT silently default.
    throw err;
  }

  // Gate: refuse boot iff status='pending' AND no claim path configured.
  if (status === "pending" && !hasEnvToken && !hasSmtp) {
    if (isTest) {
      // Tests injecting their own env+db can still hit the strict path by
      // passing onFail; permissive default applies only when the test harness
      // omits both. Tests that WANT the strict refuse-path inject onFail.
      return { hasEnvToken, hasSmtp, setupStateStatus: status };
    }
    onFail(
      "setup-claim-boot: setup_state.status='pending' but no admin claim path is configured. " +
      "Set OPENWHISPR_SETUP_CLAIM_TOKEN (env-token mode; generate with `openssl rand -hex 32`) " +
      "OR set SMTP_HOST + the SMTP_FROM/SMTP_AUTH transport vars (email-verified mode). " +
      "See docs/operations.md §Admin Claim Modes.",
    );
  }

  // A1 — return the parsed Buffer so the route can `safeTokenCompare(presented, validation.envTokenBuffer)`
  // without ever invoking parseSetupClaimToken again.
  return {
    hasEnvToken,
    ...(envBuffer ? { envTokenBuffer: envBuffer } : {}),
    hasSmtp,
    setupStateStatus: status,
  };
}

function defaultFail(message: string): never {
  // biome-ignore lint/suspicious/noConsole: pre-logger boot path — stderr is the only sink.
  console.error(`FATAL ${message}`);
  process.exit(78);
}
```

Test injection harness (mirror `auth.test.ts:19-34`):

```
function callValidate(opts: { env: NodeJS.ProcessEnv; db: TransactionalDb<ExecutableTx> }): {
  result?: SetupClaimBootValidation;
  failure?: string;
} {
  let failure: string | undefined;
  const onFail = vi.fn((message: string): never => {
    failure = message;
    throw new Error("__refuse__");
  }) as unknown as (message: string) => never;
  return validateSetupClaimBoot({ db: opts.db, env: opts.env, onFail })
    .then((result) => ({ result }), () => ({ failure }));
}
```

(Use the existing testcontainer `bootMigratedPostgres()` harness in `apps/api/src/routes/__tests__/setup.ts` for the DB-touching paths. Mocking DB is FORBIDDEN per CLAUDE.md.)

#### A2 — Additional allowed-origins env knob

ALSO in this step (same file), introduce the canonical-+-additional origins accessor. The Origin guard cannot rely on `INGRESS_BASE_URL` alone — in a dev `pnpm dev` run, `validateIngressBoot()` returns `http://localhost:4000` (the api port), but the Next/Vite wizard runs on `http://localhost:5173`; without a knob the wizard hits a 403 wall. The fix is a comma-separated `ADDITIONAL_ALLOWED_ORIGINS` env var whose entries are added to the strict-equality allowlist (NOT a relaxation — each entry is checked by `===` independently).

```
export interface AllowedOriginsAccessor {
  /** Canonical origin parsed from `INGRESS_BASE_URL` (always present). */
  readonly canonical: string;
  /** Additional strict-equality allowed origins from `ADDITIONAL_ALLOWED_ORIGINS` (zero or more). */
  readonly additional: ReadonlyArray<string>;
  /** Flat union for preHandler `.includes()` / `Set.has()` checks. */
  readonly all: ReadonlyArray<string>;
}

/**
 * Parse `ADDITIONAL_ALLOWED_ORIGINS` (comma-separated). Each entry must parse
 * to a non-empty URL.origin — trailing slashes are stripped by .origin semantics;
 * entries containing path/query/hash are REFUSED at boot with SetupClaimConfigError.
 *
 * A2 — each entry is added to the strict-equality allowlist, NOT relaxed to a
 * `startsWith` or wildcard. The Origin guard still compares request `Origin`
 * header against EACH entry with `===` and rejects on no match.
 */
export function getAllowedOrigins(input: {
  ingressBaseUrl: string;
  env?: NodeJS.ProcessEnv;
}): AllowedOriginsAccessor {
  const env = input.env ?? process.env;
  const canonical = new URL(input.ingressBaseUrl).origin;
  const rawAdditional = env.ADDITIONAL_ALLOWED_ORIGINS?.trim();
  const additional: string[] = [];
  if (rawAdditional) {
    for (const piece of rawAdditional.split(",")) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        throw new SetupClaimConfigError(
          `ADDITIONAL_ALLOWED_ORIGINS entry "${trimmed}" is not a valid URL. Each entry must be a full scheme://host[:port] origin (no path, no query, no hash).`,
        );
      }
      // Reject path/query/hash so the operator cannot smuggle a longer-than-origin string.
      if (parsed.pathname !== "/" && parsed.pathname !== "") {
        throw new SetupClaimConfigError(
          `ADDITIONAL_ALLOWED_ORIGINS entry "${trimmed}" contains a path; each entry must be origin-only (scheme://host[:port]).`,
        );
      }
      if (parsed.search || parsed.hash) {
        throw new SetupClaimConfigError(
          `ADDITIONAL_ALLOWED_ORIGINS entry "${trimmed}" contains query or hash; each entry must be origin-only (scheme://host[:port]).`,
        );
      }
      if (!parsed.origin || parsed.origin === "null") {
        throw new SetupClaimConfigError(
          `ADDITIONAL_ALLOWED_ORIGINS entry "${trimmed}" did not resolve to a non-null URL.origin.`,
        );
      }
      additional.push(parsed.origin);
    }
  }
  const all: ReadonlyArray<string> = [canonical, ...additional];
  return { canonical, additional, all };
}
```

`validateSetupClaimBoot` invokes `getAllowedOrigins({ ingressBaseUrl: validateIngressBoot().ingressBaseUrl, env })` so a malformed entry exits 78 at boot alongside the other gates. The returned accessor is also exported separately for the route module (Step 5) — the route receives the `all` array via `SetupAdminDeps.allowedOrigins: ReadonlyArray<string>`.

Commit message: `feat(api,config): validateSetupClaimBoot + allowed-origins accessor (D1/A2)`

### Step 3 — Wave 1 (a): Better Auth hook closure + tests

Files: `apps/api/src/auth.ts` (EDIT), `apps/api/tests/unit/__tests__/auth-after-email-verification.test.ts` (NEW).

RED: write the closure-wiring tests — assert that when `completeSetupAdmin` is supplied, BA's hook calls it with the user; when absent, the hook is a no-op (backward-compat preservation).

GREEN: extend `BuildAuthOptions` (auth.ts:203, BEFORE the closing `}` at :235) with:

```
  /**
   * 260527-im6 / D3 — atomic post-verify role-flip + audit emission.
   * Production wires a closure that opens an ownerPool UPDATE on
   * users.role (gated by setup_state.status='pending') and emits
   * `admin.role_changed` audit. Tests inject a spy; pre-im6 buildAuth
   * fakes that omit it are preserved (closure is optional, hook
   * defensively no-ops when absent — backward-compat for every existing
   * buildAuth() unit-test fixture).
   */
  completeSetupAdmin?: (user: { id: string; email: string; tenantId?: string }) => Promise<void>;
```

Add the hook inside the existing `emailVerification: { ... }` block at auth.ts:587-654, alongside `autoSignInAfterVerification` and `sendVerificationEmail`:

```
afterEmailVerification: async (
  user: { id: string; email: string; emailVerified?: boolean; tenantId?: string },
  _request?: Request,
) => {
  // Defensive: BA writes emailVerified=true at line 266 of email-verification.mjs
  // BEFORE this hook fires (R1.2). We re-check before delegating to keep the
  // closure body cheap-and-honest about its precondition.
  if (!user.emailVerified) return;
  if (!opts.completeSetupAdmin) return;
  await opts.completeSetupAdmin({
    id: user.id,
    email: user.email,
    ...(user.tenantId ? { tenantId: user.tenantId } : {}),
  });
},
```

Commit message: `feat(api,auth): emailVerification.afterEmailVerification hook (D3)`

### Step 4 — Wave 1 (b): production `completeSetupAdmin` closure + integration smoke

Files: `apps/api/src/index.ts` (EDIT), `apps/api/src/routes/index.ts` (EDIT only if a wiring adapter is required), `apps/api/tests/integration/__tests__/setup-admin-hybrid.test.ts` (NEW, partial — T3 + T6).

RED: write integration tests T3 (unverified email cannot reach role='admin') and T6 (audit log entry exists after successful claim) against the existing `bootMigratedPostgres()` harness, calling the new `completeSetupAdmin` closure DIRECTLY (not through BA — that's Step 5+).

GREEN: in `apps/api/src/index.ts`, inside the existing `if (probeOwnerPool && auth)` block (~line 1105) — but BEFORE `const authRaw = buildAuth(...)` at line 841 — define the closure. **Subtle ordering challenge:** `authRaw` is built at line 841, BEFORE `probeOwnerPool` exists (line 1073). We MUST move the `buildAuth` call AFTER `probeOwnerPool` is constructed, OR construct `completeSetupAdmin` later and re-assign. Pick the cleanest path:

> **Executor directive — recommended:** move the `buildAuth` call from line 841 to AFTER the `probeOwnerPool` and `setupAdminSignUpEmail` blocks (so it lives near line 1140). The `auth` variable is consumed by `buildOpts.auth` at line 998 and by the `setupAdmin` plumbing at line 1138, both of which are also after line 1073. The move is safe; no consumer between line 841 and line 1073 reads `auth`. Verify by grep: `grep -nE "\\bauth\\b" apps/api/src/index.ts` and confirm no read before line 998.

Closure body (mirrors R8.2 verbatim, with the audit emission inside `withTenant`):

```
const completeSetupAdmin = async (user: { id: string; email: string; tenantId?: string }) => {
  // Idempotency by WHERE-predicate. A second click on a stale verify-email link
  // sees status='completed' and the inner UPDATE rowCount=0 — no-op + safe.
  let claimed = false;
  await db.transaction(async (tx: ExecutableTx) => {
    const result = (await tx.execute(sql`
      UPDATE setup_state
         SET status = 'completed', completed_at = now()
       WHERE id = 1 AND status = 'pending'
       RETURNING status
    `)) as { rowCount?: number; rows?: unknown[] };
    if ((result.rowCount ?? result.rows?.length ?? 0) > 0) claimed = true;
  });
  if (!claimed) return;

  // Role flip via the same probeOwnerPool used by the existing route. BYPASSRLS
  // doctrine per CLAUDE.md DISCIPLINE rule 16 + audit E8.
  const flipResult = await probeOwnerPool.query<{ id: string }>(
    `UPDATE users SET role = 'admin' WHERE id = $1 AND email_verified = true RETURNING id`,
    [user.id],
  );
  if (flipResult.rowCount === 0) {
    // Defensive rollback (R8.2): claimed setup_state but role-flip target row
    // vanished (vanishingly rare — would mean BA wrote emailVerified=true then
    // the row was DELETEd between line 266 and our UPDATE).
    await probeOwnerPool.query(`UPDATE setup_state SET status='pending', completed_at=NULL WHERE id = 1`);
    return;
  }

  // Audit emission inside withTenant so audit_log.tenant_id is RLS-bound.
  const tenantId = user.tenantId ?? (await resolveDefaultTenantId());
  await withTenant(db, tenantId, async (tx) => {
    await recordAudit(tx, {
      tenant_id: tenantId,
      actor_user_id: user.id,
      request_id: crypto.randomUUID(),
      ip: null,
      user_agent: "afterEmailVerification-hook",
    }, "admin.role_changed", {
      target_user_id: user.id,
      before: "user",  // D4-locked choice (CC4)
      after: "admin",
    });
  });
};
```

Call `validateSetupClaimBoot` between db construction and `buildApp` AND capture its return value (A1 — `validation.envTokenBuffer` threads into the route deps, no re-parse downstream):

```
// After `const db = ...` (around line ~830) but BEFORE `const app = await buildApp(buildOpts);` at line 1152.
const { validateSetupClaimBoot, getAllowedOrigins } = await import("./config/setup-claim.js");
const setupClaimValidation = await validateSetupClaimBoot({ db });
// A2 — assemble the allowed-origins array once, alongside the validation result.
const { ingressBaseUrl } = validateIngressBoot();
const allowedOrigins = getAllowedOrigins({ ingressBaseUrl }).all;
```

Then construct `auth` AFTER `completeSetupAdmin` is defined:

```
const authRaw = buildAuth({
  db,
  ...(enqueueEmail ? { enqueueEmail } : {}),
  completeSetupAdmin,
});
const auth = authRaw as unknown as AuthLike;
```

And populate `buildOpts.setupAdmin` with the threaded Buffer + origins array (A1 + A2):

```
buildOpts.setupAdmin = {
  ownerPool: probeOwnerPool,
  signUpEmail: setupAdminSignUpEmail,
  // A1 — reuse the parsed Buffer from validateSetupClaimBoot; do NOT call parseSetupClaimToken again.
  ...(setupClaimValidation.envTokenBuffer
    ? { envClaimTokenBuffer: setupClaimValidation.envTokenBuffer }
    : {}),
  // A2 — strict-equality allowlist union of canonical + ADDITIONAL_ALLOWED_ORIGINS.
  allowedOrigins,
};
```

Commit message: `feat(api,index): wire completeSetupAdmin + validateSetupClaimBoot (A1/A2)`

### Step 5 — Wave 2 (a): route refactor — Origin preHandler + Bearer/email branches

Files: `apps/api/src/routes/setup-admin.ts` (EDIT), `apps/api/src/routes/setup-state.ts` (EDIT), `apps/api/tests/unit/routes/__tests__/setup-admin.test.ts` (EXTEND).

RED: extend the 7-case + 4-extras unit suite with §5.U-C cases — Origin allowlist matrix (now 5 cases — canonical match, additional match, missing, mismatched host, suffix-attack) + Bearer branch matrix (4 cases) + email branch shape assertion (`pending_verification: true`, `users.role IS NULL`, `setup_state.status='pending'`).

GREEN:

1. **Origin preHandler (A2 — allowlist-array form).** Extracted as a shared module-level factory in setup-admin.ts (re-exported and consumed by setup-state.ts). Accepts a `ReadonlyArray<string>` of pre-validated origins (canonical + `ADDITIONAL_ALLOWED_ORIGINS`) and compares `req.headers.origin` strict-equality (`===`) against EACH entry. ANY match passes; no match rejects with 403 `{ error: { code: 'ORIGIN_MISMATCH', requestId: req.id } }`. RESEARCH R6.3 — exact equality on each entry, NEVER `startsWith` and NEVER a wildcard.

```
export function makeOriginGuard(opts: { allowedOrigins: ReadonlyArray<string> }) {
  // Pre-build the Set so each request runs O(1) lookup. The Set is read-only;
  // the contents were already validated at boot by getAllowedOrigins() so we do
  // NOT re-validate here.
  const allowed: ReadonlySet<string> = new Set(opts.allowedOrigins);
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const presented = req.headers.origin;
    if (typeof presented !== "string" || !allowed.has(presented)) {
      reply.code(403).send({ error: { code: "ORIGIN_MISMATCH", requestId: req.id } });
      return reply;
    }
  };
}
```

Wire the factory once at deps construction (in `buildSetupAdminRoutes` body):

```
const originGuard = makeOriginGuard({ allowedOrigins: deps.allowedOrigins });
```

Attach it as `preHandler` on the `app.route({...})` block AND export `makeOriginGuard` from setup-admin.ts for setup-state.ts to import. (If wiring through `deps` is cleaner, the executor MAY add the factory to `SetupAdminDeps` directly — but the simpler approach is the factory-in-route-module shown above.)

2. **Bearer-vs-email branch logic** (per RESEARCH §CC5 decision matrix). A1 — `deps.envClaimTokenBuffer` is the SINGLE source of truth for the expected token Buffer; `parseSetupClaimToken` is NOT called from the route:

```
const presentedBearer = ((): string | undefined => {
  const auth = req.headers.authorization;
  if (typeof auth !== "string") return undefined;
  if (!auth.startsWith("Bearer ")) return undefined;  // Bearer prefix gate — startsWith is correct here (RFC 6750 §2.1)
  return auth.slice("Bearer ".length).trim();
})();

// A1 — the parsed env-token Buffer arrives via deps from validateSetupClaimBoot;
// we MUST NOT call parseSetupClaimToken again here.
const envBuffer = deps.envClaimTokenBuffer;  // undefined when env-token mode is disabled
const presentedBuffer = presentedBearer ? Buffer.from(presentedBearer, "hex") : undefined;
const isBearerPresent = presentedBearer !== undefined;
const isBearerValid =
  isBearerPresent &&
  envBuffer !== undefined &&
  /^[0-9a-f]{64}$/.test(presentedBearer) &&
  safeTokenCompare(presentedBuffer, envBuffer);

// Decision matrix (CC5):
//   bearer absent → email branch
//   bearer present + valid → bearer branch
//   bearer present + invalid (any reason) → 403 INVALID_SETUP_TOKEN (do NOT fall through)
//   bearer present + env unset → 403 SETUP_TOKEN_NOT_CONFIGURED (defensive; boot guard already prevents this state, but defence-in-depth)
if (isBearerPresent && envBuffer === undefined) {
  return reply.code(403).send({
    error: { code: "SETUP_TOKEN_NOT_CONFIGURED", requestId: req.id },
  });
}
if (isBearerPresent && !isBearerValid) {
  return reply.code(403).send({
    error: { code: "INVALID_SETUP_TOKEN", requestId: req.id },
  });
}
```

3. **Email branch** (when `!isBearerPresent`): claim `setup_state` is NOT touched here; only `signUpEmail` runs. Better Auth's existing `sendVerificationEmail` chain (auth.ts:587-654) dispatches the magic-link automatically because `requireEmailVerification: true` and `sendOnSignUp` is unset → BA defaults to "send on sign-up" (CC6). Response is 201 with `pending_verification: true` to keep wire-contract compatible with the wizard (R8.3, P10).

```
// Email branch — signUpEmail only, NO setup_state UPDATE, NO role flip.
const signUpResult = await signUpEmail({
  body: {
    email: body.email,
    password: body.password,
    name: body.name,
    ...(req.headers["accept-language"]
      ? { locale: pickLocale(req.headers["accept-language"]) }
      : {}),
  },
});
if (signUpResult.error || !signUpResult.data) {
  // NO setup_state rollback needed — we didn't claim it.
  return reply.code(400).send({
    error: {
      code: "ADMIN_CREATE_FAILED",
      message: signUpResult.error?.message ?? "admin sign-up failed",
      requestId: req.id,
    },
  });
}
const warnings: string[] = [];
try {
  await renameTenant(body.workspace);
} catch (err) {
  req.log.warn({ err, workspace: body.workspace }, "tenant_rename_failed_before_email_verify");
  warnings.push("tenant_rename_failed");
}
const responseBody: Record<string, unknown> = {
  admin: { email: body.email },
  alreadyCompleted: false,
  pending_verification: true,
};
if (warnings.length > 0) responseBody.warnings = warnings;
return reply.code(201).send(responseBody);
```

4. **Bearer branch** (`isBearerValid`): keep existing synchronous flow — atomic `UPDATE setup_state`, `signUpEmail`, `UPDATE users SET role='admin' WHERE id=$1` (DROP the `AND email_verified=true` predicate — Bearer branch is the operator-recovery path that BYPASSES email; R8.3 + P6), tenant rename, **NEW: emit `admin.role_changed` audit** before responding 201. The audit emission uses `auditCtxFromRequest(req, tenantId, signUpResult.data.user.id)` (R5.5) — this is a Fastify request so the helper applies directly.

5. **Declare `schema: { body: setupAdminInput }`** on the `app.route({...})` block (P13 / pre-emptive LOCKER-04 migration). Drop the manual `safeParse` at line 171; Fastify-Zod will emit a 400 envelope with the same `error.code: INVALID_BODY` shape (the executor may need to register a small error mapper if the default envelope drifts — verify against the existing INVALID_BODY assertion in `setup-admin.test.ts` and update the test expectation in the same commit).

6. **Plumb `envClaimTokenBuffer` + `allowedOrigins` through `SetupAdminDeps`.** A1 + A2:

```
export interface SetupAdminDeps {
  db: TransactionalDb<ExecutableTx>;
  ownerPool: Pool;
  signUpEmail: SetupAdminSignUpEmail;
  renameTenant?: SetupAdminRenameTenant;
  /**
   * A1 — parsed env-token Buffer, threaded in from `validateSetupClaimBoot`.
   * The route layer MUST consume this Buffer via `safeTokenCompare(presented, deps.envClaimTokenBuffer)`
   * and MUST NOT re-call `parseSetupClaimToken`. Undefined when env-token mode is disabled.
   */
  envClaimTokenBuffer?: Buffer;
  /**
   * A2 — strict-equality allowlist of origins (canonical + ADDITIONAL_ALLOWED_ORIGINS),
   * pre-validated at boot by `getAllowedOrigins`. The Origin preHandler runs `Set.has()`
   * against this array; no `startsWith`, no wildcards.
   */
  allowedOrigins: ReadonlyArray<string>;
}
```

In `apps/api/src/index.ts`, populate them at the `buildOpts.setupAdmin` construction site as shown in Step 4.

7. **Attach the Origin preHandler to setup-state.ts** — same factory, same `allowedOrigins` array, same 403 envelope. Defence-in-depth per C2. The setup-state route deps (or wiring closure) receive the same `allowedOrigins` array from `apps/api/src/index.ts`.

Commit message: `feat(api,setup-admin): Origin guard + Bearer/email branch split (D1/D2/D3/C2/A1/A2)`

### Step 6 — Wave 3: docs + chart bump

Files: `docs/operations.md` (EDIT), `charts/openwhispr-server/Chart.yaml` (EDIT), `charts/openwhispr-server/values.yaml` (EDIT), `charts/openwhispr-server/templates/api-deployment.yaml` (EDIT, project env var).

No test code in this step — chart + docs only.

`docs/operations.md` new section (~135 lines):

```
## Admin Claim Modes

OpenWhispr enforces ONE of two paths for the first-admin onboarding. The
server refuses to boot (exit 78 EX_CONFIG) when `setup_state.status='pending'`
and neither path is configured. See
`.planning/quick/260527-im6-admin-claim-hybrid-hardening/CONTEXT.md` for the
locked decision rationale.

### Mode A — Env token (`OPENWHISPR_SETUP_CLAIM_TOKEN`)

Use for: corporate / k8s deployments where SMTP is not yet wired; operator-recovery flows.

1. Generate the token. Single canonical recipe:
   ```bash
   openssl rand -hex 32
   ```
   Output is exactly 64 lowercase hex chars (256 bits). Do NOT reuse any value
   from this docs page — every example value below is on the boot validator's
   reject-allowlist and will refuse boot if pasted verbatim.

2. Set it in your deployment env.

   **docker-compose (.env):**
   ```
   OPENWHISPR_SETUP_CLAIM_TOKEN=<your-generated-hex64>
   ```

   **k8s (SealedSecret):**
   ```yaml
   kubectl create secret generic openwhispr-setup-claim \
     --from-literal=token=<your-generated-hex64> \
     --dry-run=client -o yaml \
     | kubeseal --controller-name=sealed-secrets-controller \
                --format yaml > setup-claim-sealed.yaml
   ```
   Then reference in your `values.yaml`:
   ```yaml
   setupClaim:
     tokenSecretRef:
       name: openwhispr-setup-claim
       key: token
   ```

3. Claim the wizard. The desktop / web client must send:
   ```
   POST /api/setup/admin
   Origin: https://your-instance.example.com   ← MUST match INGRESS_BASE_URL exactly
                                                  OR be a member of ADDITIONAL_ALLOWED_ORIGINS
   Authorization: Bearer <your-generated-hex64>
   Content-Type: application/json
   { "email":"admin@example.com", "password":"...", "name":"...", "workspace":"...", "timezone":"..." }
   ```
   Response: 201 with `{ admin: { email }, alreadyCompleted: false }`. The
   admin user is created and `role='admin'` is set synchronously. No email
   verification is required — this mode bypasses the email path.

### Mode B — Verified email (no env token)

Use for: self-host OSS / single-VM deployments where SMTP is configured.

1. Configure SMTP (existing knobs — see §SMTP). Verify with:
   ```bash
   docker compose exec api curl -X POST .../api/auth/send-test-email -d ...
   ```

2. Claim the wizard. POST `/api/setup/admin` WITHOUT a Bearer header. Response:
   ```json
   201 { "admin": { "email": "..." }, "alreadyCompleted": false, "pending_verification": true }
   ```
   The user is created with `role=NULL` and `setup_state.status='pending'`.
   A verification email is dispatched automatically.

3. Click the verification link in the inbox. The `afterEmailVerification` hook
   fires, atomically: sets `users.role='admin'`, sets `setup_state.status='completed'`,
   emits an `admin.role_changed` audit_log entry.

### Origin allowlist — `ADDITIONAL_ALLOWED_ORIGINS` (dev/multi-host)

`/api/setup/admin` and `/api/setup-state` reject any request whose `Origin`
header does NOT match `INGRESS_BASE_URL` exactly. For multi-host deployments
or local dev where the wizard is served from a different port (e.g. Next dev
on `:5173` while the api binds `:4000`), set:

```
ADDITIONAL_ALLOWED_ORIGINS=http://localhost:5173,https://app.example.com
```

Format rules (boot-validated, exit 78 on violation):

- Comma-separated; whitespace around each entry is trimmed.
- EACH entry must be a full `scheme://host[:port]` origin — no path, no
  query, no hash. Trailing slashes are stripped via `URL.origin` semantics.
- Each entry is added to the strict-equality allowlist. The Origin guard
  runs `Set.has(request.Origin)` — there is NO wildcard, NO suffix match,
  NO `startsWith`. Adding `https://example.com` does NOT allow
  `https://app.example.com`.
- Empty entries are skipped silently; a malformed entry refuses boot.

Dev `.env.local` recipe (typical):

```
INGRESS_BASE_URL=http://localhost:4000
ADDITIONAL_ALLOWED_ORIGINS=http://localhost:5173
```

### What `/api/capabilities` exposes

Operator-facing field `claim_mode: 'env_token' | 'email' | 'completed'`
reflects the active configuration at request time. Use this from operator
dashboards / smoke tests to confirm a fresh deploy is in the expected mode
before exposing the instance.

### Recovery

If you mis-paste the env token, the boot validator refuses to start with a
stderr line naming the failing predicate. Fix the env value and restart.

If a verification email bounces or the link expires, the operator can re-trigger
via `/api/auth/send-verification-email`. The wizard is `setup_state='pending'`
until a successful verify lands, so the operator can also clear the half-created
user via `DELETE FROM users WHERE email=$1 AND email_verified=false` (BYPASSRLS
psql shell) and re-submit the wizard.

24h cleanup of stale unverified-pending-admin rows is NOT bundled with this
quick task; tracked separately as a worker-job follow-up.
```

`Chart.yaml`:
```
version: 1.0.14            # was 1.0.13
appVersion: "1.0.11"       # was "1.0.10"
```

`values.yaml`:
```
image:
  tag: "1.0.11"            # was "1.0.10" — bumped for 260527-im6 admin-claim hardening
# ...
setupClaim:
  # 260527-im6 — env-token mode for admin claim (see docs/operations.md §Admin Claim Modes Mode A).
  # When unset, the chart projects no env var; the server boots in email-only mode (requires SMTP).
  tokenSecretRef: {}
  # Example (override at install):
  # tokenSecretRef:
  #   name: openwhispr-setup-claim
  #   key: token
```

`templates/api-deployment.yaml` env projection (executor adds to existing env block):
```
{{- if .Values.setupClaim.tokenSecretRef.name }}
- name: OPENWHISPR_SETUP_CLAIM_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ .Values.setupClaim.tokenSecretRef.name }}
      key: {{ .Values.setupClaim.tokenSecretRef.key | default "token" }}
{{- end }}
```

Commit message: `docs+chart(260527-im6): Admin Claim Modes runbook + chart 1.0.14 (image v1.0.11)`

### Step 7 — Wave 4: integration test fill-in + final coverage

File: `apps/api/tests/integration/__tests__/setup-admin-hybrid.test.ts` (EDIT — finish T1, T2, T4, T5).

Land the remaining integration tests against the testcontainer harness. All scenarios use real Postgres + real Better Auth via `bootMigratedPostgres()`. NO mocks of DB / SMTP / BA — mocks only at the global-Request boundary (CC2 / R1.4) and SMTP if the env doesn't supply a real transport (use the existing inline-email-service fake from `apps/api/tests/integration/__tests__/setup.ts`).

Commit message: `test(api,integration): setup-admin-hybrid T1..T6 (260527-im6)`

### Step 8 — Final verify

Run the full local verification suite (§7). If everything green, push the branch. **Do NOT push to remote** until the user explicitly says so (per CLAUDE.md §3 — verify with own eyes first).

---

## 5. Test matrix

### 5.1 Unit tests

#### U-A — Token parser (parseSetupClaimToken)

| Case | Input | Expected |
|------|-------|----------|
| U-A-1 | env empty/unset | returns `undefined` |
| U-A-2 | `"<random-hex64>".trim()` | returns `Buffer` of length 32 |
| U-A-3 | `"  <hex64>  "` (surrounding whitespace) | returns `Buffer` of length 32 (trimmed) |
| U-A-4 | 63 hex chars | throws `SetupClaimConfigError` |
| U-A-5 | 65 hex chars | throws `SetupClaimConfigError` |
| U-A-6 | uppercase hex64 `"ABCD..."` | throws `SetupClaimConfigError` (regex is lowercase-only) |
| U-A-7 | `"deadbeef".repeat(8)` (lowercase canonical — A3: regex is lowercase-only, no `/i`) | throws `SetupClaimConfigError` (BAD_TOKEN_PATTERNS) |
| U-A-8 | `"0".repeat(64)` | throws `SetupClaimConfigError` (single-char repeat) |
| U-A-9 | `"a".repeat(64)` | throws `SetupClaimConfigError` (single-char repeat) |
| U-A-10 | `"0123456789abcdef".repeat(4)` (lowercase — A3) | throws `SetupClaimConfigError` |
| U-A-11 | doc-example value (placeholder until Step 6 finalizes) | throws `SetupClaimConfigError` (REJECTED_EXAMPLE_TOKENS) |
| U-A-12 | string contains non-hex char (`"g"`) | throws `SetupClaimConfigError` |

#### U-B — Timing-safe comparator (safeTokenCompare)

| Case | Inputs | Expected |
|------|--------|----------|
| U-B-1 | two identical 32-byte Buffers | `true` |
| U-B-2 | two different 32-byte Buffers (last byte differs) | `false` |
| U-B-3 | two different-length Buffers (16 vs 32 bytes) | `false`, NO throw |
| U-B-4 | left undefined, right valid | `false` |
| U-B-5 | left valid, right undefined | `false` |
| U-B-6 | both undefined | `false` |

#### U-C — Boot validator (validateSetupClaimBoot)

| Case | setup_state.status | env.OPENWHISPR_SETUP_CLAIM_TOKEN | env.SMTP_HOST | Expected |
|------|--------------------|----------------------------------|---------------|----------|
| U-C-1 | `'completed'` | unset | unset | no-op, returns `{ setupStateStatus: 'completed', envTokenBuffer: undefined, ... }` |
| U-C-2 | `'pending'` | valid hex64 | unset | no-op, returns `{ hasEnvToken: true, hasSmtp: false, envTokenBuffer: <Buffer len=32> }` (A1) |
| U-C-3 | `'pending'` | unset | `'mail.example.com'` | no-op, returns `{ hasEnvToken: false, hasSmtp: true, envTokenBuffer: undefined }` |
| U-C-4 | `'pending'` | unset | unset | `onFail` called with stderr msg naming both paths, `process.exit(78)` (mocked via spy) |
| U-C-5 | `'pending'` | invalid (single-char repeat) | unset | `onFail` called naming the bad-pattern class |
| U-C-6 | DB query failure | (any) | (any) | propagates the DB error (do NOT swallow) |
| U-C-7 | `'skipped_legacy'` | unset | unset | no-op (legacy install path; gate does not apply) |
| U-C-8 | `'pending'` | valid hex64 | `'mail.example.com'` | no-op, both flags true, `envTokenBuffer` populated (A1) |
| U-C-9 | A1 — single-parse property | valid hex64 | unset | spy on `parseSetupClaimToken` records EXACTLY one call inside `validateSetupClaimBoot`; route-deps consumer reads `validation.envTokenBuffer` and does NOT re-invoke the parser |

#### U-D — setup-admin route (extend existing 7-case + 4-extras)

| Case | Setup | Expected |
|------|-------|----------|
| U-D-Origin-1 | Origin header matches `INGRESS_BASE_URL` origin exactly | preHandler passes; reaches handler |
| U-D-Origin-2 | Origin header missing | 403 `ORIGIN_MISMATCH` |
| U-D-Origin-3 | Origin header mismatched host | 403 `ORIGIN_MISMATCH` |
| U-D-Origin-4 | Origin header is `<expected>.evil.com` (suffix attack) | 403 `ORIGIN_MISMATCH` (because `===` not `startsWith`) |
| U-D-Origin-5 (A2) | `ADDITIONAL_ALLOWED_ORIGINS=http://localhost:5173,https://app.example.com`; request Origin is `http://localhost:5173` | preHandler passes (additional entry matched via `===`) |
| U-D-Origin-6 (A2) | Same env as Origin-5; request Origin is `https://app.example.com` | preHandler passes (second additional entry matched via `===`) |
| U-D-Origin-7 (A2 — boot) | `ADDITIONAL_ALLOWED_ORIGINS=http://localhost:5173/path` (contains path) | boot validator throws `SetupClaimConfigError`; api never serves any request |
| U-D-Bearer-1 | Bearer present + matches env token | Bearer branch: setup_state→completed, users.role='admin', audit emitted, 201 (no `pending_verification`) |
| U-D-Bearer-2 | Bearer present + mismatches env token | 403 `INVALID_SETUP_TOKEN` |
| U-D-Bearer-3 | Bearer present + env-token unset | 403 `SETUP_TOKEN_NOT_CONFIGURED` |
| U-D-Bearer-4 | Bearer wrong-shape (not hex64) | 403 `INVALID_SETUP_TOKEN` |
| U-D-Email-1 | No Bearer + env-token unset + SMTP set | 201 `pending_verification: true`, users.role IS NULL, setup_state.status='pending' |
| U-D-Email-2 | Existing test: invalid body | Update assertion — new shape from Fastify-Zod plugin envelope, but `error.code='INVALID_BODY'` preserved |
| U-D-Existing-7 | All 7 existing cases (winner, race-loser, BA-error rollback, rate-limit, body-role escalation, timezone deferred, tenant_rename failure) | Re-run; some shapes update (winner: under Bearer branch; race-loser: works in both branches) |

#### U-E — Better Auth hook closure

| Case | Setup | Expected |
|------|-------|----------|
| U-E-1 | `buildAuth({ db, completeSetupAdmin: spy })` + simulate verify-email | spy called once with `{ id, email, tenantId? }` |
| U-E-2 | `buildAuth({ db })` (no completeSetupAdmin) | hook does NOT throw, no spy to assert; just confirm BA's verify-email path returns normally |
| U-E-3 | `buildAuth({ db, completeSetupAdmin: spy })` + spy throws | error propagates (BA's surrounding catch turns it to 500; verify the throw is observed) |
| U-E-4 | Hook called with `user.emailVerified=false` (defensive) | spy NOT called (defensive predicate fires) |

### 5.2 Integration tests — `setup-admin-hybrid.test.ts`

All run against `bootMigratedPostgres()` testcontainer harness.

| Case | Description |
|------|-------------|
| **T1 — concurrent claim race** | Two parallel POSTs with valid Bearer token + identical email/password → `Promise.all` → exactly ONE 201 (winner), ONE 200 `alreadyCompleted: true`. Assert race-safety property. |
| **T2 — cross-origin POST** | POST with `Origin: https://evil.example.com` → 403 `ORIGIN_MISMATCH`. No DB write occurs (assert `setup_state.status` unchanged). |
| **T3 — unverified email cannot reach role='admin'** | (a) Env token NOT set; POST without Bearer → 201 `pending_verification: true`. Assert `users.role IS NULL` AND `setup_state.status='pending'`. (b) Drive BA's verify-email flow with the queued token (read from the test SMTP/email-service mock) → assert `users.role='admin'` AND `setup_state.status='completed'`. Two assertions in ONE test. |
| **T4 — wrong env-token (timing)** | Env token set; POST with `Bearer wrong-hex64` → 403 `INVALID_SETUP_TOKEN`. Measure timing delta vs T5 baseline 100 runs each, assert `abs(median(wrong) − median(right)) < 5 × max(stddev)` — defence-in-depth, not strict crypto guarantee. |
| **T5 — correct env-token** | Env token set; POST with `Bearer <correct>` → 201, `setup_state.status='completed'`, `users.role='admin'`, audit row exists. |
| **T6 — audit log entry** | After T5, query: `SELECT action, payload FROM audit_log ORDER BY id DESC LIMIT 1` → assert `action='admin.role_changed'`, `payload->>'before'='user'`, `payload->>'after'='admin'`, `payload->>'target_user_id'=<the new admin user id>`. Same assertion applies after T3(b) for the email-verify path. |

---

## 6. Coverage targets per file

| File | Lines | Branches | Functions | Statements |
|------|-------|----------|-----------|-----------|
| `apps/api/src/config/setup-claim.ts` | ≥ 95% | ≥ 95% | 100% | ≥ 95% |
| `apps/api/src/routes/setup-admin.ts` (diff) | ≥ 90% | ≥ 90% | 100% | ≥ 90% |
| `apps/api/src/routes/setup-state.ts` (diff — preHandler line) | ≥ 90% | ≥ 90% | 100% | ≥ 90% |
| `apps/api/src/auth.ts` (diff — afterEmailVerification block only) | ≥ 90% | ≥ 90% | 100% | ≥ 90% |
| `apps/api/src/index.ts` (diff — completeSetupAdmin closure + boot wire) | ≥ 90% | ≥ 90% | 100% | ≥ 90% |

Overall phase-coverage floor stays ≥ 90/90/90/90 per CLAUDE.md constitutional rule. The verifier reports `gaps_found` on any sub-90 axis. The chart + docs files have no coverage gate (non-executable).

---

## 7. Verification checklist (local, pre-push)

Execute these in order. Any failure halts and is investigated before proceeding.

1. **Lint:** `pnpm -r lint --since main` — zero warnings on the diff.
2. **Biome:** `pnpm biome check --diagnostic-level=error --changed apps/api packages/data charts docs` — clean.
3. **Typecheck:** `pnpm -r typecheck` — clean.
4. **Unit tests:** `pnpm --filter @openwhispr/api test:unit -- setup-claim setup-admin after-email-verification` — green.
5. **Integration tests:** `E2E=1 pnpm --filter @openwhispr/api test:integration -- setup-admin-hybrid` — green.
6. **Coverage:** `pnpm --filter @openwhispr/api test:coverage` — verify ≥ 90/90/90/90 on diff (per CLAUDE.md).
7. **Lockers:** `pnpm tsx tools/lint-no-env-branches.ts && pnpm tsx tools/lint-no-suppressions.ts && pnpm tsx tools/lint-no-hardcode.ts && pnpm tsx tools/lint-prod-readiness.ts && pnpm tsx tools/lint-no-plaintext-secret-columns.ts && pnpm tsx tools/lint-secret-shape-in-error.ts && pnpm tsx tools/lint-shell-credential-interpolation.ts` — all clean.
8. **Gitleaks:** `lefthook run pre-commit && lefthook run pre-push` — no findings. Per CLAUDE.md Hard Rule #4, NEVER `--no-verify`.
9. **Biome on diff:** `pnpm biome format --changed apps/api charts docs` — auto-format applied + committed.
10. **Helm lint:** `helm lint charts/openwhispr-server` — clean.
11. **docker-compose boot smoke** — the critical "boot validator does its job" check:
    - Start with `setup_state.status='pending'` AND no env token AND no SMTP → expect `docker compose up api` to **exit 78 with FATAL line on stderr** mentioning both claim paths.
    - Start with `setup_state.status='pending'` AND env token set → expect clean boot.
    - Start with `setup_state.status='completed'` AND nothing else → expect clean boot.
    - Start with malformed `ADDITIONAL_ALLOWED_ORIGINS=http://localhost:5173/with/path` → expect exit 78 with FATAL line naming the offending entry (A2).
12. **Live verification of own work** (CLAUDE.md Hard Rule #3):
    - `git log --oneline -8` — confirm each commit's SHA is on HEAD.
    - `git status --short` — working tree clean.
    - Re-read `apps/api/src/routes/setup-admin.ts` and grep for `email_verified` — confirm the Bearer branch's UPDATE no longer carries the `AND email_verified = true` predicate (per P6 / R8.3).
    - Re-read `apps/api/src/routes/setup-admin.ts` and grep for `parseSetupClaimToken` — confirm the route does NOT call the parser (A1; parser appears in imports/types but NOT as a call expression in the handler body).
    - Re-read `apps/api/src/auth.ts` and grep for `afterEmailVerification` — confirm closure is wired inside the `emailVerification: {...}` block.
    - Re-read `apps/api/src/config/setup-claim.ts` and grep for `/i\b` — confirm no `/i` flag remains on the bad-pattern regexes (A3).

---

## 8. Release artifacts

- Same commit SHA tagged with:
  - `v1.0.11` (api app)
  - `openwhispr-server-1.0.14` (helm chart)
- Image rebuild for `ghcr.io/<org>/openwhispr-api:1.0.11` (multi-arch amd64+arm64 per CLAUDE.md constraints).
- Chart publish (push to OCI helm registry).
- GitHub Releases page enrichment follows the established v1.0.10 workflow (`.github/workflows/release.yml` if present — executor confirms).
- No DB migrations land in this PLAN (`users.role` CHECK, partial unique index, `claim_mode` column are explicitly NOT in scope).

**User decision point:** the user's standing rule (memory: "11 cloud-plane blockers closed; all on server LOCAL main, nothing pushed to GitHub per owner decision") means the executor stops at "commit + tag locally" and waits for explicit user direction before any push / image build / chart publish.

---

## 9. Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|------------|--------|-----------|
| R1 | Concurrent-claim race semantics differ between Bearer and email branches | Medium | Medium | T1 covers Bearer concurrent race; email branch has no race (setup_state stays pending until hook fires — only ONE verify-email click can land the role flip due to the same UPDATE-WHERE atomic predicate in `completeSetupAdmin`). Document in §5. |
| R2 | Better Auth 1.6.x version drift breaks `afterEmailVerification` hook | Low | High | Pinned to 1.6.11 (RESEARCH §R1). Any future BA bump triggers re-verification of `node_modules/.pnpm/better-auth@*/dist/api/routes/email-verification.mjs` line 267 — add a regression assertion: `tools/lint-better-auth-hook.ts` (out of scope here; tracked as follow-up). |
| R3 | Origin header spoofing by reverse proxy (Traefik X-Forwarded-Origin) | Low | High | The `Origin` header is set by the BROWSER, not Traefik. Traefik does not synthesize or rewrite `Origin`. Verify in compose smoke with `curl -H 'Origin: https://evil.com' ... | jq` — expect 403. The boot guard validates `INGRESS_BASE_URL` is HTTPS in production (config/auth.ts:177), so the operator cannot accidentally trust a non-canonical origin. |
| R4 | Boot-fatal disrupts `pnpm dev` UX | Medium | Low | `validateSetupClaimBoot` falls back to the test-env permissive default when `NODE_ENV=test`. `pnpm dev` runs `NODE_ENV=development`; the boot guard fires there too (intentional — dev should fail fast if claim path isn't configured). A2 — set `ADDITIONAL_ALLOWED_ORIGINS=http://localhost:5173` in `.env.local` to allow the Next/Vite dev wizard to POST through the Origin guard. Documented in §11 + docs/operations.md. |
| R5 | Env-token rotation procedure undocumented | Medium | Medium | NOT in scope (deferred). Document the rotation as a TODO in `docs/operations.md §Admin Claim Modes Mode A` cross-ref. |
| R6 | Bearer branch role flip succeeds with NEVER-verified email — operator could lock themselves out if they typo their email + claim w/ env token | Medium | Low | Bearer branch is the operator-recovery path; if the operator typos their email, they have the env token to claim AGAIN after a manual `DELETE FROM users` + `UPDATE setup_state SET status='pending'` via the `psql` shell (documented in operations.md §Recovery). |
| R7 | `docs/operations.md` example value gets pasted by operators into production | Medium | High | D4 reject-allowlist: the example value in operations.md is on `REJECTED_EXAMPLE_TOKENS` Set; the boot validator REFUSES boot if pasted verbatim. Step 1's `REJECTED_EXAMPLE_TOKENS` Set is populated at Step 6 once the docs author finalizes the example string. The two files MUST stay in sync — track via a CI lint (out of scope here; add to deferred-items). |
| R8 | `pnpm test` flakes on the timing-delta assertion in T4 (CI variance) | Medium | Low | Use a generous 5x stddev multiplier (per scope); if T4 flakes, mark it `it.skip` with a `@flaky` tag and open a follow-up to refine timing methodology. Do NOT silently delete the test. |
| R9 | The `auth.ts` move (`buildAuth` call relocation in `index.ts`) breaks a downstream consumer that reads `auth` before line 1140 | Low | High | Pre-flight: `grep -nE "\\bauth\\b" apps/api/src/index.ts | head -40` — confirm zero reads between line 841 and line 998. Verify CI integration tests still pass after the move. |
| R10 | `pending_verification: true` response field breaks the wizard's wire-contract (existing CJM clients) | Low | Medium | The wizard's success page already shows a "check your email to verify" UX (R22 flow per memory `project_r19_r23_auth_journey.md`); the new field is purely additive. Verify by running the existing CJM step suite (`apps/api/tests/e2e-cjm/`) — should pass unchanged. |
| R11 | Email-branch `signUpEmail` failure leaves orphaned `users` row (no compensating rollback) | Low | Low | Acceptable: `setup_state.status='pending'` is the gate; the orphaned row blocks re-submission only via the email-unique index. The operator can recover via the `DELETE FROM users WHERE email=$1 AND email_verified=false` psql step (documented in operations.md §Recovery). |
| R12 (A2) | `ADDITIONAL_ALLOWED_ORIGINS` operator footgun — a typo broadens the allowlist | Low | Medium | Each entry is `===` matched; a typo only EXPANDS the allowlist to a single invalid origin, never relaxes the gate. Boot validator refuses entries with path/query/hash so the operator cannot accidentally smuggle `https://example.com/*` as a wildcard. The variable is documented as "additional strict allowlist", NOT "trusted origins" — naming signals the semantic. |

---

## 10. Out-of-scope deferrals (audit O-items NOT closed)

| Audit item | Severity | Status | Rationale |
|------------|----------|--------|-----------|
| Audit O2 — `users.role` CHECK constraint | LOW | DEFERRED | Schema migration — out of scope (Task #52). |
| Audit O3 — partial unique index `WHERE role='admin'` | LOW | DEFERRED | Same as O2. |
| Audit O4 — `/api/setup-state` public disclosure | INFO | ACCEPTED | Same trade-off as Better Auth's public sign-up route shape. |
| Audit Dim 6 — tenant isolation | LOW | DEFERRED (v2) | CLAUDE.md DISCIPLINE rule 16. |
| `tools/lint-no-extra-setup_state-writers.ts` | LOW | DEFERRED | Separate quick task. |
| 24h cleanup worker for stale unverified-pending-admin | LOW | DEFERRED | Separate quick task; cross-referenced in operations.md. |

All deferrals get an entry appended to `.planning/deferred-items.md` in Step 8 (verification step 12). Executor: open the file, find the existing section header, and append a 6-line entry per deferral with WHY and TRIGGER (when does the deferral need to land).

---

## 11. Operator runbook (post-merge)

For the operator who pulls this image:

1. **Pre-deploy decision:** which mode?
   - Have SMTP? → Mode B. No env var needed beyond existing SMTP_* knobs.
   - No SMTP yet (k8s corp env)? → Mode A. Generate token + apply secret.
2. **Generate token (Mode A only):**
   ```bash
   openssl rand -hex 32 > /tmp/setup-claim-token.txt
   # Inspect, then:
   kubectl -n openwhispr create secret generic openwhispr-setup-claim \
     --from-file=token=/tmp/setup-claim-token.txt
   rm /tmp/setup-claim-token.txt   # never commit, never leave on disk
   ```
3. **Update values.yaml** (Mode A only):
   ```yaml
   setupClaim:
     tokenSecretRef:
       name: openwhispr-setup-claim
       key: token
   ```
4. **Multi-host or dev (A2):** if the wizard runs on an Origin other than
   `INGRESS_BASE_URL`, set `ADDITIONAL_ALLOWED_ORIGINS` (comma-separated,
   origin-only — no path/query/hash). Example for dev:
   ```
   INGRESS_BASE_URL=http://localhost:4000
   ADDITIONAL_ALLOWED_ORIGINS=http://localhost:5173
   ```
   Boot refuses (exit 78) on malformed entries; see `docs/operations.md §Origin allowlist`.
5. **Helm upgrade:**
   ```bash
   helm upgrade openwhispr ./charts/openwhispr-server --version 1.0.14
   ```
6. **Roll out:**
   ```bash
   kubectl -n openwhispr rollout status deployment/api --timeout=2m
   ```
7. **Verify capabilities endpoint reports the expected mode:**
   ```bash
   curl -sf https://api.example.com/api/capabilities | jq '.claim_mode'
   # Expect "env_token" or "email" depending on mode
   ```
8. **Verify boot guard fired correctly:**
   ```bash
   kubectl -n openwhispr logs deployment/api | grep -E 'FATAL setup-claim-boot|setup-claim-boot' | head -5
   # If you see a FATAL line, the env is misconfigured — fix the values.yaml/secret and re-roll.
   ```
9. **Claim the wizard** per the mode you chose (see docs/operations.md §Admin Claim Modes). On success, verify:
   ```bash
   curl -sf https://api.example.com/api/setup-state -H "Origin: https://api.example.com" | jq '.status'
   # Expect "completed"
   ```
10. **Confirm audit log entry exists:**
    ```sql
    SELECT action, payload->>'target_user_id', payload->>'before', payload->>'after', created_at
    FROM audit_log
    WHERE action = 'admin.role_changed'
    ORDER BY id DESC LIMIT 1;
    -- Expect one row, after='admin', before='user'
    ```

---

## Appendix A — Source citation index

All claims in this PLAN trace back to:

- **CONTEXT.md** decisions D1, D2, D3, D4, C1, C2 (this directory)
- **RESEARCH.md** sections R1..R8, CC1..CC7, P1..P14, citation index (this directory)
- **Audit document** Dim 5 / Dim 8 / Dim 9 / O1 (`.planning/debug/admin-onboarding-security-audit-2026-05-27.md`)
- **PLAN-CHECK.md** YELLOW adjustments A1, A2, A3 (this directory)
- **Production files** read by the planner pre-write:
  - `apps/api/src/routes/setup-admin.ts` (lines 1-351, full read)
  - `apps/api/src/auth.ts` (lines 200-680, focused read)
  - `apps/api/src/config/auth.ts` (lines 1-220, full read)
  - `apps/api/src/index.ts` (lines 1-200 + 800-1160, focused read)
  - `apps/api/src/lib/audit.ts` (lines 150-348, focused read)
  - `packages/data/src/schema/setup_state.ts` (full)
  - `charts/openwhispr-server/Chart.yaml` + `values.yaml` (header read)

Executor MUST NOT re-read these files just to confirm the planner's citation; trust the PLAN. Re-read only sections the PLAN tells you to modify.

## Appendix B — STRIDE threat model (per CLAUDE.md security_enforcement)

| ID | Cat | Component | Disposition | Mitigation in this PLAN |
|----|-----|-----------|-------------|-------------------------|
| T-im6-01 | E (Elevation) | `POST /api/setup/admin` email branch | mitigate | Role flip moved to `afterEmailVerification` hook; attacker cannot complete email verification for an inbox they don't own (Dim 5 closure) |
| T-im6-02 | T (Tampering) — CSRF (cross-origin POST) | `POST /api/setup/admin` from cross-origin | mitigate | Origin allowlist preHandler strict-equality vs `INGRESS_BASE_URL` origin + `ADDITIONAL_ALLOWED_ORIGINS` entries (A2). Each entry is checked by `===` independently; the additional-origins knob is NOT a relaxation — it expands the strict-equality allowlist by explicit, boot-validated, origin-only entries (no path/query/hash, no wildcards, no `startsWith`). Closes Dim 8. |
| T-im6-03 | I (Information disclosure) | `GET /api/setup-state` cross-origin | mitigate | Same Origin allowlist preHandler (canonical + A2 additional entries) — defence-in-depth (Dim 9 closure) |
| T-im6-04 | E | Bearer-token brute force | mitigate | 256-bit hex64 entropy (D2) + timingSafeEqual (D2) + rate-limit `5/min/IP` (existing) + bad-pattern reject (D4) — brute force is infeasible |
| T-im6-05 | R (Repudiation) | First-admin promotion has no audit trail | mitigate | `recordAudit('admin.role_changed', { target, before:'user', after:'admin' })` on BOTH branches (O1 closure) |
| T-im6-06 | D (DoS) | Misconfigured instance boots in vulnerable state | mitigate | `validateSetupClaimBoot` refuses to start (exit 78 EX_CONFIG) when `status='pending'` AND no claim path (D1); A2 — same gate fires on malformed `ADDITIONAL_ALLOWED_ORIGINS` entries |
| T-im6-07 | S (Spoofing) | Operator pastes doc-example token into prod | mitigate | `REJECTED_EXAMPLE_TOKENS` Set + bad-pattern allowlist; boot validator refuses (D4); A3 — bad-pattern regexes are lowercase-only (no `/i`), guaranteed reachable by the upstream shape gate |
| T-im6-08 | T | `pending_verification` response field tampering by client | accept | Field is informational only; the server's authoritative state is `setup_state.status` + `users.role` — a malicious client cannot fabricate a successful claim by lying about this field |

---

## Appendix C — Multi-source coverage audit

This PLAN closes 4 source items. Coverage:

| Source ID | Type | Plan task(s) | Status |
|-----------|------|--------------|--------|
| Audit Dim 5 (HIGH) | GOAL | Step 3 (hook), Step 4 (closure), Step 5 (branch refactor) | COVERED |
| Audit Dim 8 (MEDIUM) | GOAL | Step 5 (Origin preHandler — canonical + A2 additional entries) | COVERED |
| Audit Dim 9 (MEDIUM) | GOAL | Step 5 (Origin preHandler on setup-state too) | COVERED |
| Audit O1 (LOW) | GOAL | Step 4 (closure emits audit), Step 5 (Bearer branch emits audit) | COVERED |
| CONTEXT D1 (boot-fatal) | CONTEXT | Step 2 (`validateSetupClaimBoot`) | COVERED |
| CONTEXT D2 (hex64 timing-safe) | CONTEXT | Step 1 (parser + comparator) | COVERED |
| CONTEXT D3 (afterEmailVerification) | CONTEXT | Step 3 (hook) | COVERED |
| CONTEXT D4 (entropy + bad-pattern) | CONTEXT | Step 1 (BAD_TOKEN_PATTERNS + REJECTED_EXAMPLE_TOKENS; A3 lowercase-only) | COVERED |
| CONTEXT C1 (audit emission) | CONTEXT | Step 4 (closure) + Step 5 (Bearer branch) | COVERED |
| CONTEXT C2 (Origin allowlist) | CONTEXT | Step 5 (preHandler on setup-admin AND setup-state) | COVERED |
| RESEARCH P11 (boot validator after db) | RESEARCH | Step 4 (`validateSetupClaimBoot` placement) | COVERED |
| RESEARCH P13 (LOCKER-04 schema declaration) | RESEARCH | Step 5 (declare `schema: { body }`) | COVERED |
| RESEARCH P6 (Bearer drops `email_verified` predicate) | RESEARCH | Step 5 (Bearer branch SQL) | COVERED |
| PLAN-CHECK A1 (single-parse) | CONTEXT | Step 2 (validator returns Buffer), Step 4 (thread into deps), Step 5 (route consumes via deps) | COVERED |
| PLAN-CHECK A2 (additional allowed origins) | CONTEXT | Step 2 (`getAllowedOrigins` boot-validates), Step 5 (Origin guard accepts array, Set.has() strict-eq) | COVERED |
| PLAN-CHECK A3 (drop `/i` flag) | CONTEXT | Step 1 (regex literals without `/i`) | COVERED |

All source items covered. No unplanned items, no scope reduction.
