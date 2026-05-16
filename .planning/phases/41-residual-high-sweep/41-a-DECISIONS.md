# Phase 41.a — Decisions Log

## D-01: Scope of "Residual bootstrap concerns from api-core HI-03"

**Date:** 2026-05-16
**Decision-maker:** executor (user offline)

**Context:** 41-CONTEXT.md § 41.a bullet 3 says "Residual bootstrap concerns from api-core review HI-03". But `.planning/review/api-core.md` HI-03 is the **hardcoded tenant UUID** finding (auth.ts:330, 380), which is already covered by Task 1.

The api-core review has separate HIGH findings:
- HI-01 (CRITICAL): `tenantPlugin` trusts `x-tenant-id` header — out of scope (CRITICAL, separate sub-plan, touches dual-auth surface)
- HI-02: `placeholder.ts` — Task 2
- HI-03: hardcoded tenant UUID — Task 1
- HI-04: `as unknown as AuthLike` cast at buildAuth boundary — bootstrap-adjacent
- HI-05: `extractBearer` greedy regex — defense-in-depth tightening

And the api-core review **Notes section** flags:
- Note 3: "Multiple bootstrap warnings logged BEFORE structured logger initialization" — bypass redact policy

**Decision:** Task 3 interpreted as **audit-only** for bootstrap concerns. `bootstrap.ts` itself is now clean (Phase 6 closure). The remaining bootstrap-adjacent finding (Note 3, console.warn before pino) is a LOW-rated note, not a HIGH, and remediation requires non-trivial refactor of the `index.ts` boot sequence (synchronous pino destination wiring before LiteLLM/email/Valkey detection branches). 

**Action:** Defer Note 3 with rationale to a future targeted phase. HI-04 and HI-05 are **also out of 41.a scope** — they are not bootstrap concerns per the CONTEXT bullet wording; HI-04 is a TS-narrowing pattern across `index.ts`/`auth.ts`/`dual-auth.ts`, and HI-05 is a regex hardening in `dual-auth.ts`. Both should be opened as targeted sub-plans (41.h or v2.3) if the user wants them inside Phase 41.

**Rationale:** Phase 41.a explicitly enumerates 2 hardcoded-UUID call sites + delete placeholder.ts + "bootstrap concerns audit". The lightweight scope (per orchestrator prompt) confirms 3-4 atomic commits. Expanding to HI-04/HI-05 would double the diff surface and pull in regex-fuzz testing for the bearer cap — not appropriate for a "lightweight sub-plan".
