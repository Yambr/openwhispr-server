# PLAN-CHECK — 260527-im6 admin-claim hybrid hardening (Iteration 2/2)

**Verdict:** GREEN — ready for executor.

**Iteration:** 2 of 2. Planner applied A1/A2/A3 in revision 2. No new YELLOW findings; no regressions on iter-1 invariants. Verification cap reached either way; this is a final pass, not a recommendation to re-plan.

---

## Adjustment verification

### A1 — Single-parse property (env-token Buffer threaded through deps)

**Applied.** Evidence:

- `SetupClaimBootValidation.envTokenBuffer?: Buffer` declared at PLAN.md line 192, with explicit doc-comment that the route MUST NOT re-call `parseSetupClaimToken`.
- `validateSetupClaimBoot` returns `envTokenBuffer` at lines 264–267 (conditional spread only when `envBuffer` is defined).
- `apps/api/src/index.ts` Step 4: captures `setupClaimValidation.envTokenBuffer` at line 477 and threads into `buildOpts.setupAdmin.envClaimTokenBuffer` at lines 500–503.
- `SetupAdminDeps.envClaimTokenBuffer?: Buffer` declared at line 640 with the same MUST-NOT-re-call directive.
- Route handler (Step 5) consumes `deps.envClaimTokenBuffer` at line 557 with comment "we MUST NOT call parseSetupClaimToken again here".
- Verification step 12 (line 966) requires the executor to grep the route file for `parseSetupClaimToken` and confirm zero call-expressions.
- Unit test U-C-9 (line 884) asserts the single-parse property as a property-test.

**Call-site audit on PLAN.md content:** `parseSetupClaimToken` is called EXACTLY ONCE in production code paths — line 218 inside `validateSetupClaimBoot`. All other occurrences are either (a) export/import/type references, (b) prose explanations, or (c) test directives forbidding re-call. PASS.

### A2 — ADDITIONAL_ALLOWED_ORIGINS env knob

**Applied.** Evidence:

- `getAllowedOrigins` accessor declared at PLAN.md lines 321–363, returns `{ canonical, additional, all }` triple with strict-equality semantics.
- Boot-time validation rejects malformed entries (lines 336–357): non-URL → throw; path component → throw; query/hash → throw; null origin → throw. All raise `SetupClaimConfigError`, propagated via `onFail` → exit 78.
- `validateSetupClaimBoot` invokes `getAllowedOrigins` (line 365), so malformed entries refuse boot alongside other gates.
- Origin guard (`makeOriginGuard`, lines 522–535) pre-builds a `ReadonlySet<string>` and runs `allowed.has(presented)` — O(1) strict-equality lookup, identical to `===` over each entry. **Missing/non-string Origin still returns 403** (line 529: `typeof presented !== "string" || !allowed.has(presented)`). Confirmed: no permissive fallthrough.
- `SetupAdminDeps.allowedOrigins: ReadonlyArray<string>` declared at line 646.
- 4 new tests added: U-D-Origin-5 (additional match #1), U-D-Origin-6 (additional match #2), U-D-Origin-7 (boot-validation rejection on path-bearing entry). U-D-Origin-1..4 retain canonical-only coverage including the empty-Origin and suffix-attack cases (Set.has on absent key returns false → 403).
- Docs updated: `docs/operations.md` new section "Origin allowlist — `ADDITIONAL_ALLOWED_ORIGINS`" at lines 741–768 documents format rules, strict-equality semantics, dev `.env.local` recipe.
- Operator runbook (lines 1042–1049) adds A2 step #4 with example.
- Compose smoke (verification step 11) adds boot-refuse case for malformed `ADDITIONAL_ALLOWED_ORIGINS=http://localhost:5173/with/path`.

**Permissiveness audit:** the only semantic change is expansion of the strict allowlist by N explicit, boot-validated entries. No wildcards, no `startsWith`, no relaxation. Missing-Origin still 403. Empty `additional` array reduces to canonical-only behaviour. PASS.

### A3 — Drop `/i` flag from bad-pattern regexes

**Applied.** Evidence:

- All three bad-pattern regexes (lines 125–127) declared without `/i` flag.
- In-source comment at lines 120–123 explains why: upstream `OPENWHISPR_SETUP_CLAIM_TOKEN_FORMAT` shape gate (`/^[0-9a-f]{64}$/`) guarantees `raw` is lowercase ASCII by the time bad-pattern matching runs, so `/i` is unreachable dead code.
- Inline comment at line 144 re-states the invariant at the call site.
- Tests U-A-6 (uppercase rejected upstream by shape gate) and U-A-7 (lowercase `deadbeef.repeat(8)` rejected by BAD_TOKEN_PATTERNS) confirm both layers.
- Verification step 12 (line 968) requires executor to grep the source file for `/i\b` and confirm absent.
- Threat model T-im6-07 explicitly cites A3.

PASS.

---

## Iter-1 invariants — no regressions

| Invariant | Status | Location |
|-----------|--------|----------|
| Async boot validator returns `Promise<...>` | preserved | line 203 |
| Validator placed AFTER db construction, BEFORE buildApp | preserved | line 48, lines 476–477 |
| Boot-fatal via `process.exit(78)`, NOT WARN | preserved | line 275 |
| setupStateStatus enum includes `'completed'` | preserved | line 194 |
| Bearer branch UPDATE drops `AND email_verified = true` | preserved | Step 5 description (line 623); grep gate at line 965 |
| Audit `before: 'user'` literal | preserved | line 465 |
| tenantId fallback via `resolveDefaultTenantId()` | preserved | line 455 |
| `completed_at` column referenced | preserved | lines 432, 450 |
| `recordAudit` invoked inside `withTenant` | preserved | lines 456–468 |
| Cross-cutting cite of A1/A2/A3 in Appendix B/C | confirmed | lines 1108–1113, 1137–1139 |

---

## New-risk audit on the patches

- **A2 origin-guard permissiveness:** missing/empty Origin → 403 (line 529 short-circuit). Suffix-attack (U-D-Origin-4) still rejected because `Set.has()` is strict equality. Boot-validation prevents `https://example.com/*` style smuggling. No expansion of attack surface beyond explicit operator-declared entries. PASS.
- **A1 deps-threading:** Buffer is constructed once and shared by reference. `Buffer` is a Node `Uint8Array` subclass; `timingSafeEqual(presented, expected)` is read-only on `expected`. No mutation risk. The deps interface declares `envClaimTokenBuffer?: Buffer` (optional), so the route's `envBuffer === undefined` defence-in-depth branch (line 571: `SETUP_TOKEN_NOT_CONFIGURED`) is preserved. PASS.
- **A3 lowercase-only regexes:** the only case that becomes unreachable is uppercase hex matching the bad-pattern set — but the shape gate `/^[0-9a-f]{64}$/` rejects ALL uppercase first. U-A-6 confirms. No bypass. PASS.

---

## Frontmatter

`revision: 2` confirmed at PLAN.md line 7. Source-audit, locked_decisions, findings_closed all carried forward.

---

## Recommendation

**GREEN — proceed to executor.** All three YELLOW adjustments are correctly applied with cross-cutting threat-model and coverage-table updates. No new risks introduced; no regressions on iter-1 invariants. Single-parse, additional-origins-strict-equality, and lowercase-only regex properties are all enforceable at runtime (the executor's grep gates in §7 verification will catch any drift).
