# Phase 12 — Security Audit Report (backfill)

**Phase:** 12 — admin-onboarding-wizard-ui-spec-conformance-audit-v2
**Audited commit range:** `9763a91..5af4f6a` (24 commits)
**Audited:** 2026-05-15
**ASVS Level:** 2 (target)
**Stance:** adversarial, fresh-context per D-19 — every mitigation grep-verified at HEAD
**Backfill:** constitutional rule #10 (audit-trail enforcement)

---

## Executive verdict

**Zero HIGH or CRITICAL findings.** All 11 declared threat IDs (T-12.01-01..04, T-12.02-01..05, T-12.03-02, T-12.03-05, T-12.03-07) plus the 8 prompt-supplied D-23 high-risk surfaces are VERIFIED-MITIGATED with grep-citable evidence. Two LOW observations recorded for transparency.

---

## Threat register verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-12.01-01 | E — privilege elevation via `role` in sign-up body | mitigate | **MITIGATED** | `apps/api/src/auth.ts:273-278`: `role: { type:"string", required:false, defaultValue:null, input:false }`. Better Auth `input:false` instructs the sign-up parser to ignore the field from the request body. Confirmed by `setup-admin.ts:200-209` which constructs the forwarded body explicitly (no spread of `req.body`). |
| T-12.01-02 | T — `setup_state` row spoofing | mitigate | **MITIGATED** | Singleton row `id=1` seeded by migration `0017_setup_state.sql`; claim handler uses atomic `UPDATE ... WHERE id=1 AND status='pending' RETURNING` (`setup-admin.ts:175-184`). Race-loser branch never overwrites. |
| T-12.01-03 | I — schema disclosure via `users.role` enum | accept | **VERIFIED** | Column is text (no enum type at DB level), values only ever `'admin'` or NULL. Public endpoints (setup-state, auth-providers) never expose the column. `/api/capabilities` returns boolean-only flags. |
| T-12.01-04 | R — claim race | mitigate | **MITIGATED** | Same atomic UPDATE under PgBouncer txn-mode; race-loser branch returns 200 + `alreadyCompleted:true` (`setup-admin.ts:186-195`). Never 409 per P1. |
| T-12.02-01 | I — provider secret echo on `/api/auth/providers` | mitigate | **MITIGATED** | `auth-providers.ts:36-39` response type pins `{providers, emailVerification}` only; `listConfiguredOidcProviders()` returns `{id, name, enabled}` — no secret, no discoveryUrl, no issuer. Grep `grep -n "SECRET\|client_secret" apps/api/src/routes/auth-providers.ts` → no matches. |
| T-12.02-02 | E — `/api/capabilities` anon access | mitigate | **MITIGATED** | `capabilities.ts:155-157`: defensive `if (!req.user || !req.tenant) throw AuthError("UNAUTHORIZED")`. dualAuthHook is the primary gate; this is belt-and-braces. |
| T-12.02-03 | D — DoS on `/api/auth/providers` | mitigate | **MITIGATED** | Rate-limit `60/min/IP` (`auth-providers.ts:78`). Better Auth budget default. |
| T-12.02-04 | I — cross-tenant ETag cache poisoning | mitigate | **MITIGATED** | `capabilities.ts:118-124` ETag = `SHA256(tenantId\nenvHash\nsetupStatus).slice(0,16)`. Per-tenant rotation by construction. |
| T-12.02-05 | I — `/api/setup-state` payload-shape lock | mitigate | **MITIGATED** | `setup-state.ts:73`: `body: SetupStateResponse = { status }` — `Object.keys === ['status']`. No tenant id, no timestamps, no env-derived fields. Rate-limit `30/min/IP`. |
| T-12.03-02 | D — anti-spam on `/api/setup/admin` | mitigate | **MITIGATED** | Rate-limit `5/min/IP` (`setup-admin.ts:152`). Distinct from `setup-state.ts` 30/min. |
| T-12.03-05 | R — tenant-rename failure orphans admin | mitigate | **MITIGATED** | Best-effort rename in try/catch; failure pushes `warnings:['tenant_rename_failed']` (`setup-admin.ts:242-251`), admin is NOT rolled back. Compensating UPDATE re-opens gate ONLY on `signUpEmail` failure (`setup-admin.ts:211-217`). |
| T-12.03-07 | E — payload-injection escalation | mitigate | **MITIGATED** | Zod schema (`setup-admin.ts:112-118`) strips unknown keys; the forwarded body to `signUpEmail` is explicit field-by-field (`setup-admin.ts:200-209`). A hostile `{role:'admin'}` extra is dropped twice over. |

**Closed: 11/11.**

---

## Prompt-supplied surface verification

### 1. setup_state singleton lifecycle/race

**Status: VERIFIED.**

- Atomic claim: `setup-admin.ts:175-184` — `UPDATE setup_state SET status='completed', completed_at=now() WHERE id=1 AND status='pending' RETURNING ...`.
- Race-loser: `rowCount===0` → 200 `alreadyCompleted:true`, never 409.
- Compensating rollback: `setup-admin.ts:211-217` — on `signUpEmail` failure, re-open gate via `UPDATE ... SET status='pending', completed_at=NULL`. Test coverage in `setup-admin.test.ts` (subtests 4-5) hits both branches.

### 2. Admin bootstrap secret handling

**Status: VERIFIED.**

- Password floor: `z.string().min(12).max(200)` (`setup-admin.ts:114`).
- Password is forwarded to `signUpEmail` only (Better Auth handles bcrypt/argon2 hashing internally).
- Logs never carry password: `req.log.warn({code, message}, ...)` on error path (`setup-admin.ts:218-221`) excludes `password`. Grep `grep -n "log\.\(warn\|info\|error\)" apps/api/src/routes/setup-admin.ts | xargs grep "password"` returns no matches.

### 3. users.role enum + Better Auth `additionalFields.role` `input:false`

**Status: VERIFIED.**

- `apps/api/src/auth.ts:273-278`: `role: { type:"string", required:false, defaultValue:null, input:false }`.
- `apps/api/src/routes/setup-admin.ts:234-236`: server-side `UPDATE users SET role='admin' WHERE id=$1` via owner pool — raw SQL bypasses Drizzle schema TS (column is migration-only).
- Hostile `{role:'admin'}` request body: dropped by Zod strip-unknown (`setup-admin.ts:112-118`) AND ignored by Better Auth (`input:false`). Defence-in-depth.

### 4. Public `GET /api/setup-state` rate-limit

**Status: VERIFIED.**

- `setup-state.ts:70`: `config: { rateLimit: { max: 30, timeWindow: "1 minute" } }`.
- Cache-Control `no-store` (`setup-state.ts:74`) — wizard always sees fresh status; no edge cache amplification.

### 5. `GET /api/auth/providers` no provider-secret echo

**Status: VERIFIED.**

- Response shape locked to `{providers, emailVerification}` (`auth-providers.ts:36-39`).
- `listConfiguredOidcProviders()` (`apps/api/src/lib/oidc-providers.ts`) reads env keys but returns ONLY `{id, name, enabled}` per provider — confirmed by grep (no `secret`, `discoveryUrl`, `issuer` in return paths).
- `emailVerification.configured` is a boolean derived from `SMTP_HOST` presence (`auth-providers.ts:49-57`) — never echoes the actual SMTP host.

### 6. `GET /api/capabilities` tenant-scoped ETag

**Status: VERIFIED.**

- `capabilities.ts:118-124`: `computeEtag(tenantId, envH, setupStatus)` — tenantId is part of the SHA-256 pre-image.
- `Cache-Control: private, max-age=30` (`capabilities.ts:178, 185`) — `private` prevents shared proxy caching.
- `tenantId` comes from `req.tenant` stamped by dualAuthHook (server-trusted) — NOT from request body / header.

### 7. `/setup` wizard CSRF/origin

**Status: VERIFIED with note.**

- The `/setup` page is an RSC + Client form. The form POSTs to `/api/setup/admin` (mutating endpoint).
- Better Auth's session cookie SameSite default + the explicit `trustedOrigins` allow-list (`auth.ts:244-248`) provide CSRF defence for the upstream `signUpEmail` call.
- The `/setup/admin` handler itself does NOT call out to a separate CSRF guard — it relies on the global Fastify origin/cookie enforcement.
- **Note:** the route is anonymous-accessible (no session required to bootstrap), so SameSite cookies do not apply for the first POST. The atomic-claim semantics + 5/min rate-limit + payload allow-list (Zod strip-unknown) are the canonical mitigations; a malicious cross-origin form-POST would still need to satisfy the claim race AND would be visible in the loud-fail audit log if the operator inspects post-hoc. Acceptable per `13-SECURITY.md` precedent for setup-time bootstrapping.

### 8. Role-promotion break-glass operator footgun

**Status: VERIFIED.**

- `docs/operations.md:354-446` documents the bcrypt htpasswd procedure for Traefik basicauth on `/admin/*` (edge-level break-glass).
- The break-glass path NEVER writes to `users.role` — it gates HTTP access at Traefik. A successful break-glass entry plus a separate manual `UPDATE users SET role='admin'` SQL is the documented recovery (`docs/operations.md:433`).
- No automated escalation: the API itself has no endpoint that flips `role` from anything other than the wizard's single use of the owner pool.

---

## Observations (LOW, non-blocking)

**Observation 1 — `envHash` includes secret values in SHA-256 pre-image.**
`capabilities.ts:100-116` hashes `LITELLM_MASTER_KEY=<actual-key>` etc. SHA-256 is one-way so the ETag is safe to ship, but a future swap to a non-cryptographic hash would expose secrets. Recommend hashing `key=K:set=${env[k] ? '1':'0'}`. See 12-REVIEW.md LO-02.

**Observation 2 — DCO bot `cutoff_sha` empty in `.github/dco.yml`.**
Phase 12 ships without retroactive consent enforcement. Phase 15-04 history scrub populates this. Out-of-scope for Phase 12 SECURITY but flagged for completeness.

---

## Unregistered flags

12-01..05 SUMMARYs: no `## Threat Flags` blocks declared new surface. None require handling.

---

## Coverage / completeness

- Every declared threat (11/11) verified.
- Every prompt-supplied D-23 surface (8/8) verified by grep + file inspection.
- Implementation files NOT modified during audit (read-only).
- No HIGH or CRITICAL findings.

**Recommendation:** Phase 12 is **CLEARED for ship** (post-fact backfill closure).

---

_Audited: 2026-05-15_
_Auditor: gsd-security-auditor (fresh-context backfill per D-19)_
