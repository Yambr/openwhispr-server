---
quick_id: 260527-im6
slug: admin-claim-hybrid-hardening
title: "Hybrid admin claim hardening — decisions locked"
date: 2026-05-27
mode: discuss-output
calibration_tier: standard
source_audit: .planning/debug/admin-onboarding-security-audit-2026-05-27.md
scope:
  - HIGH Dim 5 — email-verification bypass on role flip
  - MEDIUM Dim 8 — CSRF on pre-claim window
  - MEDIUM Dim 9 — Origin/Referer allowlist absent on /api/setup/admin
  - LOW O1     — audit-log emission gap (`admin.role_changed`)
chosen_approach: |
  HYBRID — POST /api/setup/admin requires EITHER:
    (a) Bearer = OPENWHISPR_SETUP_CLAIM_TOKEN (env-driven, operator-set), OR
    (b) The acting user has email_verified=true (post-magic-link path).
---

# Locked Decisions

Four gray areas the planner must operationalize against. Each table lists viable
options, the recommendation, and the code-level implication.

---

## D1 — Default behavior when neither env-token nor verified-email path is configured

Hybrid design says "refuse 403". The question is **WHEN** the refusal lands —
boot or runtime.

| Option | UX | Security | Complexity | Recommendation |
|---|---|---|---|---|
| (a) Hard 403 at runtime — boot succeeds, every POST returns 403 `SETUP_CLAIM_DISABLED` until operator sets one path | Maximum flexibility: operator can `docker compose exec api env SMTP_HOST=... && /restart` later; instance "boots clean" for inspection of `/api/health`, logs, `/setup-state` | Worst — a misconfigured prod boots happily; the public `/api/setup-state` still leaks `status='pending'`, advertising "unclaimable but vulnerable to operator finger-trouble" | 1 file (setup-admin.ts preHandler), 0 new boot guards | Reject — defers a config error to the first user-visible request, which is exactly the failure mode CLAUDE.md DISCIPLINE rule "no NODE_ENV branches in runtime paths" exists to suppress |
| (b) **Boot-fatal** — extend `validateAuthBoot()` / new `validateSetupClaimBoot()` to refuse start when `setup_state.status='pending'` AND neither `OPENWHISPR_SETUP_CLAIM_TOKEN` set nor SMTP transport resolvable (matching `validateAuthBoot`'s exit-78 EX_CONFIG precedent) | Operator sees the failure at `docker compose up`, log line tells them what to set; no race window between "instance reachable" and "claim path configured" | **Best** — closes the entire pre-claim attack window: the route literally cannot serve until an auth path exists | 1 new boot validator (~50 lines), wire into `apps/api/src/index.ts` boot sequence next to `validateAuthBoot()`. Requires reading `setup_state` from DB before HTTP listener starts (precedent: migration check at boot) | ✓ **Locked** |
| (c) Hybrid soft-warn — log a loud WARN at boot ("no claim path configured; POST /api/setup/admin will 403 until you set one") + 403 at runtime | Operator sees a warning at boot but can still inspect the instance; clearer than (a) for OSS quickstart UX | Same hole as (a) — a warning is not a failure; an inattentive operator misses it and the instance is silently unclaimable | 1 file (boot WARN) + 1 file (route 403) | Reject — Phase 53 / Plan 53-22 precedent (`validateAuthBoot` refuses production boot with non-HTTPS) sets the standard: security-impacting misconfig is EX_CONFIG, not stderr WARN |

**Locked:** **Option (b) — Boot-fatal.**

**Rationale:** The `validateAuthBoot()` pattern at `apps/api/src/config/auth.ts:49-106`
already establishes the precedent for boot-time security gates (exit 78 EX_CONFIG
when AUTH_URL is non-HTTPS in production). Extending the same posture here keeps
the "fail-loud-fail-early" doctrine consistent and eliminates the dim-5 attack
window completely — the route never runs in a vulnerable configuration. The boot
guard reads `setup_state.status` from DB once at startup; cost is one query.

**Code-level implication for planner:**
- New file: `apps/api/src/config/setup-claim.ts`, export `validateSetupClaimBoot(env, db, onFail)` mirroring `validateAuthBoot`'s shape (env injection for tests, `defaultFail` → `process.exit(78)`).
- Boot sequence: invoke after `validateAuthBoot()` + AFTER drizzle adapter is up but BEFORE the HTTP listener binds. Place in `apps/api/src/index.ts` right next to the existing `validateIngressBoot()` call.
- Gate logic: refuse boot iff `setup_state.status === 'pending'` AND NOT (`env.OPENWHISPR_SETUP_CLAIM_TOKEN` set with valid shape OR `env.SMTP_HOST` set non-empty). Once `status='completed'`, the gate is a no-op (instance is past the wizard).
- Test fixtures: 4-cell matrix (status × env paths) under `apps/api/tests/unit/config/setup-claim.test.ts` using the spy-onFail pattern from `auth.test.ts`.

---

## D2 — `OPENWHISPR_SETUP_CLAIM_TOKEN` validation shape

Token format must be: (a) safe to type/paste, (b) constant-time comparable,
(c) k8s SealedSecret-friendly, (d) high-entropy.

| Option | Operator UX | Timing-attack | k8s friendly | Recommendation |
|---|---|---|---|---|
| (a) Free-form ≥32 chars | Easy paste; "any long string" UX | Vulnerable iff naïve `===` — fixable with `crypto.timingSafeEqual` (Node ≥18 native) | Yes — strings round-trip cleanly through SealedSecret bytes | Reject — operators paste short strings ("admin-token-1") thinking the floor catches it; entropy floor unenforced |
| (b) **hex64 (32 bytes, generated by `openssl rand -hex 32`)** — exactly 64 lowercase hex chars | Single canonical recipe: `openssl rand -hex 32` (in docs/security.md §setup); copy-paste UX matches what operators already use for `BETTER_AUTH_SECRET` | `crypto.timingSafeEqual(Buffer.from(env, 'hex'), Buffer.from(req, 'hex'))` — both buffers are guaranteed 32 bytes, safe | Yes — hex is ASCII-safe everywhere (Helm values, .env files, SealedSecret bytes, ConfigMap envFrom) | ✓ **Locked** — clean, enforceable, single shape lint can verify (`/^[0-9a-f]{64}$/`) |
| (c) Argon2 hash stored in env, plaintext from client | Operator runs `argon2 -e <secret>` once, stores hash | Constant-time by Argon2 design; but argon2-node is a heavy dep just for one env-comparison | Hash strings are long (~100+ chars) but ASCII-safe | Reject — adds a binary native dep + onboarding step ("how do I argon2 from a docker-less host?") for marginal benefit vs (b) + timingSafeEqual |
| (d) UUIDv4 | "UUID I know" UX | timingSafeEqual after parse | Yes, but 122 bits of entropy vs hex64's 256 bits | Reject — Better Auth ecosystem norm + project's own `BETTER_AUTH_SECRET ≥ 32` precedent point to "≥32 bytes random hex"; UUIDs are PK-shaped, not credential-shaped |

**Locked:** **Option (b) — hex64 (`openssl rand -hex 32`).**

**Rationale:** Mirrors the existing `BETTER_AUTH_SECRET` operator recipe at
`apps/api/src/config/auth.ts:94-99` (`openssl rand -base64 48`, ≥32-char floor)
and the Phase 53 docs/security.md §3 KEK-rotation operator UX. Single canonical
shape means: (1) operators see one recipe across the entire OpenWhispr stack,
(2) the LOCKER-03 hardcode-shape allowlist gets one new regex (`/^[0-9a-f]{64}$/`)
to tolerate, (3) timing-safe comparison is a 3-line `crypto.timingSafeEqual`
against parsed buffers — no native dep. Bearer header carries plaintext;
server `Buffer.from(env, 'hex')` once at boot, compares per-request against
`Buffer.from(presented, 'hex')`.

**Code-level implication for planner:**
- Boot validator (D1's `validateSetupClaimBoot`) enforces `/^[0-9a-f]{64}$/` shape if env is set; refuses boot with non-conforming value (typo-catch surface).
- Comparison helper: `apps/api/src/lib/setup-claim-token.ts` exports `compareSetupClaimToken(envBuffer, presented: string): boolean` — pre-parses env at boot into a `Buffer` constant (memoized), compares incoming string by re-parsing to `Buffer` and calling `crypto.timingSafeEqual`. Returns `false` on shape mismatch (length, non-hex) WITHOUT throwing — handler maps to 403.
- Route preHandler reads `Authorization: Bearer <hex64>`, strips `Bearer ` prefix, calls helper. On match → pass; on absent/mismatch → fall through to email-verified-path check (D3).

---

## D3 — Verify-email-complete hook point in Better Auth

Better Auth 1.6.11 — confirmed by reading vendored source at
`node_modules/.pnpm/better-auth@1.6.11_*/dist/api/routes/email-verification.mjs`.

**API confirmed via vendored source + official docs:** `emailVerification.afterEmailVerification(user, request)` fires at line 267 of the verify-email handler, AFTER `internalAdapter.updateUserByEmail({emailVerified:true})` lands AND BEFORE the auto-sign-in session cookie is set. The `user` parameter is the FULL updated row (id, email, emailVerified, role, locale, tenantId, createdAt, …).

| Option | Atomicity | Re-entrancy | Code surface | Recommendation |
|---|---|---|---|---|
| (a) **`emailVerification.afterEmailVerification(user, request)` hook in `auth.ts`** — emits the role flip + setup_state completion synchronously inside the hook | Atomic w.r.t. verification: BA awaits the hook before continuing the verify-email flow (vendored proof: `await ctx.context.options.emailVerification.afterEmailVerification(updatedUser, ctx.request)` — line 267). If hook throws, BA propagates the error and the verification request 500s — but `emailVerified=true` is ALREADY persisted (line 266 — adapter call precedes hook). Acceptable: a later retry against the same token short-circuits since `user.user.emailVerified` is true (line 258 of email-verification.mjs returns early). | The hook is per-request; idempotency check inside (only flip role IF `setup_state.status='pending'` AND `users.role IS NULL`) handles a retry safely | ~30 lines added to `buildAuth()` in `auth.ts`, takes `ownerPool` via new optional `BuildAuthOptions` field. Existing precedent: `enqueueEmail` is already DI'd into BuildAuthOptions for the email queue path. | ✓ **Locked** |
| (b) `databaseHooks.user.update.after` | Fires after ANY user update — far too broad. Would race with locale changes, password resets, OAuth account-link events, etc. Plus has no atomicity coupling to the verification semantics. | Hard — would need to read row before/after to detect the `emailVerified:false→true` transition | Larger blast radius, harder to test in isolation | Reject — wrong abstraction layer; verification-specific hook (a) exists for exactly this case |
| (c) Worker job polling `users WHERE email_verified=true AND email=<setup_state pending email>` | Eventually consistent, not atomic — race window between verify and role flip | Long-poll job adds infra (BullMQ entry) for a single instance-lifetime event | New BullMQ job spec + worker handler; ~2× the code of (a) | Reject — over-engineered for a one-shot transition that has a native synchronous hook |

**Locked:** **Option (a) — `emailVerification.afterEmailVerification` hook.**

**Rationale:** Direct vendored-source proof at `email-verification.mjs:267` confirms BA awaits the hook synchronously after `updateUserByEmail({emailVerified:true})`. The hook receives the full updated user row (id, email, tenantId — sufficient for the role flip + setup_state UPDATE). Official BA docs (https://better-auth.com/docs/concepts/email) document this as the supported public extension point. Identical wiring shape to the existing `sendVerificationEmail` / `sendResetPassword` closures in `auth.ts` lines 531-653 — zero new DI patterns.

**Code-level implication for planner:**
- New optional field in `BuildAuthOptions` (`auth.ts:203`): `completeSetupAdmin?: (user: {id, email, tenantId?}) => Promise<void>` — DI'd from `apps/api/src/index.ts`. Default: no-op (preserves backward-compat for every existing test fixture).
- Add `emailVerification.afterEmailVerification` closure in the `betterAuth({...})` block (around line 588) calling `opts.completeSetupAdmin?.(user)` when present.
- Production wiring in `index.ts`: pass a closure that (a) opens `db.transaction`, (b) attempts atomic UPDATE `setup_state SET status='completed' WHERE id=1 AND status='pending'`, (c) on rowCount=1, `UPDATE users SET role='admin' WHERE id=$user_id AND email_verified=true`, (d) emits `recordAudit('admin.role_changed', ...)` (closes O1).
- The setup-admin POST handler's role flip moves OUT of the route — POST creates the user but DOES NOT touch `users.role` or `setup_state.status`. The hook owns the atomic transition. The Bearer-token branch (D2) keeps the synchronous flip in the route as the operator-recovery / corporate-internal path that bypasses email.
- Idempotency inside hook: WHERE-predicates make the hook safe on retry (a second verify-email-click sees `status='completed'` already, UPDATE rowCount=0, hook is a no-op).

---

## D4 — Boot-time entropy validation strictness for `OPENWHISPR_SETUP_CLAIM_TOKEN`

Given D2 locks the shape to hex64, the question reduces to: does the boot
guard accept `0000…0000` (64 zeros) and `aaaa…aaaa` (64 a's)? Both pass
`/^[0-9a-f]{64}$/`.

| Option | False-positives | Operator footgun | Implementation cost | Recommendation |
|---|---|---|---|---|
| (a) Shape-only (regex + length) — `/^[0-9a-f]{64}$/` | None | Operator can paste `0` × 64 thinking it's strong; lint never warns | 1 regex | Reject — opens a "weak hex64" footgun that the entropy floor is supposed to prevent |
| (b) **Shape + low-entropy reject — refuse `^([0-9a-f])\1{63}$` (single-char repetition) AND known-test patterns (`deadbeef…`, `00000000…`, `12345678…` patterns)** | Negligible; legitimate `openssl rand -hex 32` outputs have ~256 bits of entropy and never collide with these patterns (probability ~2⁻²⁵⁰) | Catches the most common copy-paste-test-value-into-prod footgun without over-engineering | Small allowlist of bad-shape regexes (≤10 patterns), 1 unit test | ✓ **Locked** |
| (c) Shannon-entropy threshold (e.g. ≥3.5 bits/char) | Possible — legitimate random hex has expected entropy ~4.0 bits/char but variance allows 3.5 to be rejected ~1 in 10000 times | Low | ~20 lines + 1 test; mirrors zxcvbn-lite | Reject — overshoots for a token that's machine-generated; the recipe `openssl rand -hex 32` already enforces the entropy floor. Pattern-reject (b) is sufficient for the realistic footgun (operator pasting a test value) |
| (d) Character-class diversity (require ≥2 distinct chars) | None | Catches `0×64` but misses `0101…01` and `deadbeef`-repeats | Trivial | Subsumed by (b) — pattern-reject is strictly stronger |

**Locked:** **Option (b) — shape + low-entropy pattern reject.**

**Rationale:** Hex64 from `openssl rand -hex 32` has cryptographically sufficient entropy by construction; the operator footgun is "I pasted a test value" (the same risk profile that motivates the existing `BETTER_AUTH_SECRET ≥ 32` floor). A targeted small allowlist of bad patterns catches the realistic mistakes without false-positive risk on real random output. Better Auth itself only floors at length (≥32 for the secret) — we go slightly stronger here because this token is the operator-escape-valve and reuse of a known-leaked test value would defeat the entire hybrid hardening. Skill ceiling matches Phase 53 docs/security.md §3 KEK-rotation operator UX — the documentation will read "generate with `openssl rand -hex 32`, never use the example value below".

**Code-level implication for planner:**
- In `validateSetupClaimBoot()` (D1): after shape check, run small array of regex rejects:
  - `/^([0-9a-f])\1{63}$/` (single-char repeats incl. all-zero, all-a)
  - `/^(deadbeef){8}$/i` and `/^(0123456789abcdef){4}$/i` (well-known test patterns)
  - exact-string allowlist of any documentation example (so the example value in `docs/security.md` is REJECTED by boot — defense against operator copy-pasting the example as-is). 
- Refuse boot with EX_CONFIG + a stderr message naming the rejected pattern class ("looks like a single-character repeat — generate a fresh token with `openssl rand -hex 32`").
- Test: 4-row positive matrix (random hex64 samples) + 4-row negative matrix (each rejection class).

---

# Cross-cutting decisions also locked

## C1 — Audit emission inside the verify-email hook (closes O1)

The `afterEmailVerification` hook (D3) is the natural site for the
`recordAudit('admin.role_changed', { target_user_id, before: null, after: 'admin' })`
emission. The hook runs inside a withTenant transaction (the user row has a
tenantId — bind to it via `withTenant()` from `@openwhispr/data`). Actor =
`target_user_id` (best available — pre-admin window, no prior authenticated
actor). This closes audit-log gap O1 for FREE on the verify-email path. The
Bearer-token branch (D2) also emits the audit event before responding 201.

## C2 — Origin allowlist guard stays on the route (D8/D9 from audit)

D1 / D3 close the email-bypass + state-machine attack window, but the audit's
**Dim 8/9 MEDIUM Origin allowlist** finding still needs a preHandler on
`/api/setup/admin` (and `GET /api/setup-state` for defense-in-depth). The
guard reads `req.headers.origin` and validates against `validateIngressBoot().ingressBaseUrl`
(already available at boot). Out of scope for the boot-validator decisions
above; planner will add a 5-line preHandler alongside the D1/D2/D3 work in
the SAME quick task. Test: unit assertion that POST with `Origin: https://evil.example`
returns 403 with `{error:{code:'ORIGIN_MISMATCH'}}`.

---

# Out of scope (already decided or deferred)

- **Schema CHECK on `users.role` enum** + **partial unique index `WHERE role='admin'`** (audit O2, O3) — deferred to a follow-up migration task per CLAUDE.md HARD RULE #1 (no production-code edits to make tests pass; these are separate enhancement migrations). NOT bundled here to keep the quick-task surface focused on the auth/security perimeter.
- **`tools/lint-no-extra-setup_state-writers.ts`** (audit O7 recommendation) — separate quick task. Add when the next setup_state writer addition is proposed.
- **Setup-state public-disclosure** (audit O4) — accepted v1 trade-off per audit (same bit is implied by Better Auth's public sign-up shape). No fix.
- **Tenant isolation in setup-admin** (audit Dim 6) — v2 blocker per CLAUDE.md DISCIPLINE rule 16. The RLS posture ledger covers the boundary.
- **LOCKER-04 `schema:` declaration on setup-admin route** (audit O5) — Phase 41 backlog item; the planner SHOULD include this pre-emptive migration in the quick task since the route is already being edited (declare `schema: { body: setupAdminInput }` on `app.route` and drop the manual `safeParse`). Cost is near-zero on top of D1/D2 edits.
- **`/api/_test/reset-setup` hardening** — production-vetoed at plugin-registration time; no further work.
- **Replacing `OPENWHISPR_SETUP_CLAIM_TOKEN` with a one-time link** ("operator runs `docker compose exec api openwhispr setup-link` to print a link with embedded one-time JWT") — interesting v2/v1.1 UX win, NOT in scope for this quick task. The hex64 env approach is the simplest hybrid v1.

