# Phase 59 — Client e2e server follow-ups (R14–R18)

## Background

The OpenWhispr Electron client's Phase 9 e2e suite (full run, 2026-05-20)
caught one BLOCKER — `R13` (`/api/_test/seed-tenant` 401) — now closed by
server commit `8f30df26`. The same triage run surfaced **five additional
server bugs**, R14–R18, recorded in the client repo's work-order:

`/Users/nick/openwhispr/.planning/phases/08-client-server-audit/SERVER-REQUIREMENTS.md`
— §R14 (lines ~674-753), §R15 (~756-873), §R16 (~876-961),
§R17 (~964-1015), §R18 (~1018-1093), verification protocol (~1096-1115).

None of R14–R18 blocks the client's green e2e run (every affected
scenario is tagged `@blocked-rN` and excluded), but all five are real
server contract / correctness defects that must be fixed before public
release. This phase closes all five.

The server team IS this repo — there is no separate team to "hand off"
to. All five fixes land here.

## Triage — verified against the live slim-test stack (2026-05-20)

Each finding was reproduced or probed before this CONTEXT was written
(CLAUDE.md hard rule 3 — verify, don't relay):

- **R14 — CONFIRMED.** Second `POST /api/_test/seed-tenant` with an
  already-seeded email → `500 {"error":"Internal server error"}`.
  Root cause located: `apps/api/src/routes/test-only.ts:413` does
  `await signUpEmail(...)` with NO try/catch. Better Auth's
  `auth.api.signUpEmail` *throws* an `APIError` on a duplicate email —
  it does NOT return `{data:null, error}`. The handler's idempotent
  recovery `else` branch (lines 424-450) only handles the
  *returned-error* shape, so on the production path it is dead code and
  the thrown `APIError` escapes to the global error handler → generic
  500. The handler comment at line 411 ("surfaces a typed error rather
  than the existing row") is wrong about the shape.

- **R15 — CONFIRMED.** With one fresh seed-tenant bearer:
  `/api/usage` → 200, but `/api/auth/verification-status?email=x` and
  `DELETE /api/auth/delete-account` → `401 {"error":"Session expired"}`.
  Also `GET /api/auth/verification-status` WITHOUT `?email=` →
  `400 querystring/email Invalid input` — the param is mandatory, the
  exact inverse of what R5 required (R5 wanted it tolerated/optional).
  The seed bearer works on the custom Bearer middleware but not on the
  Better-Auth-mounted `/api/auth/*` routes — server-internal resolver
  divergence. Re-opens R5.

- **R16 — CONFIRMED (facet 1).** The api container's own logs show
  repeated `ssrf.guard … host_not_allowed … host=litellm … blocked` —
  the server's SSRF outbound allowlist rejects its own internal compose
  service `litellm`. `GET /readyz` → 503 with
  `litellm.ok:false … host_not_allowed`. Facet 2 (empty-file
  `POST /api/transcribe` → 502 instead of 400) follows from the same
  allowlist self-block plus a missing zero-byte input guard — to be
  re-probed during planning.

- **R17 — CONFIRMED (behavior).** Two distinct seed-tenants both try to
  create an API key named `<dup>`: first → 200, second →
  `409 API_KEY_NAME_TAKEN`. NOTE for the planner: in v1 both
  seed-tenants resolve to the *same default tenant* (RLS posture ledger
  — single-installation-single-tenant). So the live repro proves the
  name index is NOT `(user_id, name)`-scoped at minimum; the planner
  must inspect the actual schema/index to determine whether it is
  global on `name` or `(tenant_id, name)`, and whether the correct
  scope is `(tenant_id, name)` or `(user_id, name)`.

- **R18 — CLAIM DIVERGES FROM LIVE PROBE — planner must verify.** The
  R18 claim: undici `Origin: null` on `POST /api/auth/sign-in/email` →
  `403 MISSING_OR_NULL_ORIGIN`. A `curl` with an explicit `origin: null`
  header against the slim-test stack got *past* the Origin gate and
  returned `401 INVALID_EMAIL_OR_PASSWORD` (wrong creds, but the Origin
  check passed). The slim stack now runs `NODE_ENV=development` (post-
  R13), which may already relax `trustedOrigins`. R18 must be RE-PROBED
  during planning with a genuine Node `fetch` (undici) AND valid seeded
  credentials before any fix is designed — the fix may be a no-op, or
  the gate may only bite under a config the slim stack no longer uses.
  Do NOT implement an R18 fix on the strength of the relayed claim
  alone.

## Goal

After this phase:
1. R14, R15, R16, R17 are fixed and verified against the live stack;
   R18 is either fixed or formally closed as not-reproducible with
   evidence (a re-probe log) — whichever the planning-stage verification
   establishes.
2. Each fix lands via strict TDD (RED→GREEN→REFACTOR), atomic commits
   (test + production code in the same commit).
3. Tests cover the regression-shape — would catch a future revert.
4. `pnpm test` green per affected package; `pnpm lint:lockers` green
   (8 lockers); `pnpm typecheck` no new errors vs the documented
   5-error baseline.
5. The client repo's `SERVER-REQUIREMENTS.md` R14–R18 (and R5, folded
   into R15) annotated with closure markers + the server commit SHA.

## Track summary

### Track A — R14: seed-tenant 500 on duplicate email
Finding: **R14** (MEDIUM)

`apps/api/src/routes/test-only.ts:413` — wrap `signUpEmail(...)` in a
try/catch. On a thrown Better Auth `APIError` whose code indicates a
duplicate (`USER_ALREADY_EXISTS` or equivalent — verify the exact code
Better Auth emits), fall into the existing idempotent-lookup branch:
look up the existing user, re-mint a fresh bearer, return `200
{token, user}` with the existing user's id. (The seed-tenant contract
in R1 already promises idempotency-on-email; option (a) is the chosen
fix — making the promise true. NOT a 409.) The existing
returned-error `else` branch stays as defence-in-depth. A 500 on a
foreseeable re-seed must become a 200. Add a RED test that drives a
real duplicate through the throwing path (the current unit test's fake
`signUpEmail` *returns* an error — it does not throw — so it never
exercised this; the new test must make the fake THROW an APIError-shaped
object, matching production).

### Track B — R16: SSRF allowlist self-blocks internal services
Finding: **R16** (MEDIUM, two facets)

The SSRF outbound guard rejects the internal compose hostname `litellm`
(and by extension the STT upstream). Internal first-party compose
service names are NOT a user-controlled SSRF surface. Fix: either add
the internal service host(s) to the SSRF allowlist, OR have the
server-controlled internal probes/proxy paths bypass the user-facing
SSRF policy. Planner decides which (grey-area — spawn an advisor: a
blanket allowlist entry vs a policy-bypass seam have different security
postures; the SSRF guard is security-sensitive code). Facet 2: `POST
/api/transcribe` must reject a zero-byte file with `400` BEFORE any
upstream call (input validation), independent of the SSRF fix. After
the fix `/readyz` returns 200 with `litellm.ok` true (or `litellm`
honestly reported as `skipped` and not dragging the aggregate to 503).

### Track C — R18: sign-in/email Origin gate (VERIFY FIRST)
Finding: **R18** (MEDIUM — status unconfirmed)

Planner's FIRST task on this track: re-probe with a genuine Node
`fetch` and valid seeded credentials against the slim stack. If the
403 does NOT reproduce (the live `curl` probe suggests it may not under
`NODE_ENV=development`), close R18 as not-reproducible with the probe
log as evidence — no production change. If it DOES reproduce, the fix
is to extend Better Auth's `trustedOrigins` to accept a missing/`null`
Origin ONLY when `OPENWHISPR_TEST_ROUTES === "true"` AND
`NODE_ENV !== "production"` — the SAME double-gate R1/R13 used for
seed-tenant. Do NOT use `trustedOrigins: ['*']`.

### Track D — R15: Better-Auth-mounted routes 401 every auth form
Finding: **R15** (HIGH — re-opens R5)

`/api/auth/verification-status` + `/api/auth/delete-account` 401 a
valid session that `/api/usage` accepts. Two sub-problems:
(1) `verification-status` made `?email=` a *required* querystring param
— must become OPTIONAL (R5 contract); identity derives from
session/Bearer.
(2) Both routes resolve the session through a code path that diverges
from the resolver `sign-in`/`sign-out`/the custom Bearer middleware
use. The planner must locate the divergence — likely a stale custom
auth hook on those handlers, or `auth.api.getSession()` called with a
request object stripped of cookies/headers — and unify them onto the
working resolver. Verify the seed-tenant bearer is honored by the
Better-Auth session routes after the fix (or, if seed-tenant tokens are
deliberately Bearer-middleware-only, that must be stated and R1 amended
— but the live probe shows a genuine session is ALSO rejected, so this
is a server bug regardless).

### Track E — R17: API-key name uniqueness scope
Finding: **R17** (HIGH — tenant-isolation defect)

The API-key `name` uniqueness constraint must be composite —
`(tenant_id, name)` or `(user_id, name)`, planner to determine the
correct scope from the schema + the BYOK ownership model. Currently a
second tenant/user gets `409 API_KEY_NAME_TAKEN` for a name they never
used (cross-tenant info leak + usability bug). Requires a forward
migration to drop the existing index and add the composite one. Server
is not in production — no data-migration cost. Add a property/
integration test proving two distinct owners can hold the same key
name, and the same owner reusing a name still 409s.

## Constraints

- **Strict TDD** — RED→GREEN→REFACTOR; test + production code atomic.
- **No mocks of internal logic** — DB/route tests use real Postgres +
  PgBouncer + Valkey via testcontainers (already wired in `apps/api`).
- **No bypassing gitleaks hooks** — CLAUDE.md hard rule 4.
- **Constitutional lockers green** — `pnpm lint:lockers` (8) after
  every track.
- **No production code edited "to make tests pass"** — CLAUDE.md hard
  rule 1. HALT + `.planning/deferred-items.md` if a test exposes a
  deeper constraint.
- **Verify before fixing** — R18 especially: the relayed claim diverges
  from a live probe; the planner re-probes before designing any fix.
- **Advisor before grey-area decisions** — R16 (allowlist-entry vs
  policy-bypass seam) is security-sensitive; spawn an advisor before
  presenting options.
- **Track order:** A (R14, cheap, isolated, adjacent to R13) →
  C (R18, verify-first — may be a no-op) → B (R16) → D (R15) →
  E (R17, schema migration last). E owns the only migration; no
  migration-number clash with the others.
- **Each track = its own RED+GREEN commit pair** (or atomic combined).
- No skipped tests, no `.only`, no `@ts-expect-error` without
  `issue-NNNN:`.
- **EN-only** source artifacts (CLAUDE.md hard rule).

## Verification gate

Phase passes when:
1. R14/R15/R16/R17 have a RED test + GREEN fix on main; R18 is fixed
   OR closed-not-reproducible with a probe log committed as evidence.
2. Live-stack re-verification of each, per the
   `SERVER-REQUIREMENTS.md` §"R14/R15/R16/R17/R18 verification
   protocol" (lines ~1096-1115):
   - R14: re-POST a seeded email → 200 (idempotent), never 500.
   - R15: `verification-status` w/o `?email=` → 200; w/ `?email=` +
     valid session → 200; `delete-account` w/ valid session → 200.
   - R16: `/readyz` → 200 (`litellm.ok` or `skipped`); empty-file
     `transcribe` → 400.
   - R17: two distinct owners create a key with the same name → both
     200; same owner reusing → 409.
   - R18: Node-`fetch` `sign-in/email` w/ valid seeded creds → 200
     (or documented not-reproducible).
3. `pnpm test` green per affected package.
4. `pnpm lint:lockers` green (8 lockers).
5. `pnpm typecheck` — no new errors vs the 5-error baseline.
6. `git log --oneline` shows the expected RED/GREEN commits.
7. Client repo `SERVER-REQUIREMENTS.md` R14–R18 + R5 annotated with
   closure markers + server commit SHA(s).

## Reference

- Client work-order: `/Users/nick/openwhispr/.planning/phases/08-client-server-audit/SERVER-REQUIREMENTS.md` §R14–R18
- R13 (just closed): server commit `8f30df26`
- R5 (re-opened, folded into R15): same SERVER-REQUIREMENTS.md, earlier section
- Phase 56 (R1–R12 client-contract conformance): `.planning/phases/56-client-contract-conformance/`
- CLAUDE.md hard rules: 1 (no schema mutation for tests), 3 (verify, don't relay), 4 (no gitleaks bypass)
- RLS posture ledger (relevant to R17 scope): CLAUDE.md §Constraints item 16
- Seed-tenant route: `apps/api/src/routes/test-only.ts`
