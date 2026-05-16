# Phase 31 / Plan 05 — Decisions

**Recorded:** 2026-05-16 (autonomous execution; user offline)
**Plan:** `31-05-PLAN.md` (LOCKER-05, `lint-secret-shape-in-error.ts`)
**Resolution path:** Hard Rule #1 (`CLAUDE.md`) + plan's explicit "Out of Scope: Fixing CR-9 (Phase 37)" clause; no advisor invocation needed — the rule is unambiguous.

## D-31-05-01 — Two additional CR-9-class violations in `apps/api/src/lib/pyannote-client.ts`

**Context.** Plan §"GREEN" predicts: *"Run locker once against current main → exactly one finding at `packages/litellm-client/src/errors.ts:31`."* Reality at HEAD `a2a470d`:

```
WARN  packages/litellm-client/src/errors.ts:68     [LitellmUpstreamError.bodyText]
WARN  apps/api/src/lib/pyannote-client.ts:68       [PyannoteBadRequestError.bodyText]
WARN  apps/api/src/lib/pyannote-client.ts:80       [PyannoteUpstreamError.bodyText]
```

The two `pyannote-client.ts` classes follow the exact same shape as the documented CR-9 source — `public readonly bodyText: string` on an `extends Error` class with the constructor storing the field un-truncated. They are genuine sibling leaks, NOT linter false positives.

**Options considered.**

1. **Fix the pyannote-client classes in Plan 31-05.** Forbidden by Hard Rule #1 (`CLAUDE.md` Conventions): *"NEVER edit production server code to make tests pass."* The plan is a tooling phase; Phase 37 (CRIT-FIX-09) is the production-fix phase for CR-9-class leaks.
2. **Fix and document as Rule-1 deviation.** Plan's "Out of Scope" section explicitly lists "Fixing CR-9 (Phase 37)" — same principle extends to sibling-leak surface discovered during locker execution. Out-of-scope means out-of-scope.
3. **Allowlist both lines with a Phase-37-sibling marker.** Matches the canonical seed pattern; keeps WARN→BLOCKING flip trigger intact (Phase 37 closes the umbrella by truncating ALL three classes, not just the original CR-9 site). Chosen.

**Decision.** Option 3. The allowlist now seeds three entries:

```
packages/litellm-client/src/errors.ts:31  # issue-31-debt-LOCKER-05-cr-9-phase-37
apps/api/src/lib/pyannote-client.ts:68    # issue-31-debt-LOCKER-05-cr-9-phase-37-sibling-PyannoteBadRequestError
apps/api/src/lib/pyannote-client.ts:80    # issue-31-debt-LOCKER-05-cr-9-phase-37-sibling-PyannoteUpstreamError
```

**Impact on Phase 37.** Its closing commit must now truncate **three** classes (was: one) and clear **three** allowlist entries (was: one). All three live in `apps/api/src/lib/pyannote-client.ts` (lines 68, 80) plus `packages/litellm-client/src/errors.ts` (line 31). The locker remains a single-commit flip target.

**Impact on Plan 31-05 verification gate.** Plan says: *"Without `--warn-only`, exit 0 because the single hit is allowlisted."* With three allowlisted hits, still exit 0 — the assertion holds, just with a higher hit count. The verification-gate text in the plan is informally inaccurate (one → three) but the BEHAVIOUR (exit 0 with WARN-only and all hits allowlisted, exit 1 on fresh un-allowlisted leak) is unchanged.

**No production code touched.** Plan 31-05's worktree boundary held: only `tools/lint-secret-shape-in-error.{ts,test.ts,allowlist.txt}`, the fixtures directory, `package.json`, and this DECISIONS.md.

## D-31-05-02 — `private` modifier exempts from the locker

**Context.** Plan §"Task 1.4" requires the linter to skip `private readonly bodyText: string` even though TS `private` is compile-time only at runtime. The plan acknowledges this is an imperfect runtime invariant.

**Decision.** Implemented as specified. The locker enforces the simpler invariant (visible field name + truncation); Phase 37's actual fix overrides `toJSON()` for the runtime defence. This is documented in the source-file header comment of `lint-secret-shape-in-error.ts`.

**No advisor invocation.** The plan documents the decision in advance; no grey-area resolution needed.

## D-31-05-03 — `string | undefined` typed fields treated identically to `string`

**Context.** Plan §"Risks + Mitigations" row 3: *"Field type is `string | undefined` — treat same as `string` for the property check; field must still be truncated in the assigning constructor branch or stay undefined."*

**Decision.** Implemented `isStringTyped()` to accept both `string` and the union `string | undefined`. The constructor-truncation check (`ctorTruncatesField`) does not distinguish — if any constructor branch assigns the field un-truncated, the class is flagged. A class that ALWAYS leaves the field undefined (no assignment) passes — the locker only fires on actual assignment of an un-truncated value, which is the realistic leak shape.

**No advisor invocation.** Risk-table decision is binding.
