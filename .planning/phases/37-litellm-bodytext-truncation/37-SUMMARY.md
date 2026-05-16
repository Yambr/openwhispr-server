---
phase: 37
plan: 37
subsystem: security / observability
tags: [crit-fix-09, cr-9, locker-05, stride-info-disclosure, pino-serializer]
key-files:
  modified:
    - packages/litellm-client/src/errors.ts
    - apps/api/src/lib/pyannote-client.ts
    - packages/litellm-client/tests/unit/index.test.ts
    - apps/api/tests/unit/lib/__tests__/pyannote-client.test.ts
    - tools/lint-secret-shape-in-error.allowlist.txt
    - package.json
    - .planning/DISCIPLINE.md
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
  created:
    - packages/litellm-client/tests/unit/errors-truncation.test.ts
    - apps/api/tests/unit/lib/pyannote-client-error-truncation.test.ts
decisions:
  - "Non-enumerable bodyText via Object.defineProperty: stronger than TypeScript-only `private` because it drops the field from JSON.stringify(err) at runtime — defends against any logger path that bypasses pino's err serializer."
  - "Override toJSON() returning only {name, message, status}: belt-and-braces second layer; pino's err serializer calls toJSON() when present."
  - "Three sites fixed atomically in one feat commit + the LOCKER-05 flip in a separate chore commit: matches Phase 31-05 DECISIONS guidance that the WARN→BLOCKING flip MUST be in the SAME closing commit boundary as the fix (atomic at the phase level)."
metrics:
  duration: ~25min
  tasks: 4
  files-changed: 11
  completed: 2026-05-16
---

# Phase 37: LitellmUpstreamError bodyText truncation (CR-9 + 2 siblings) — Summary

Three Error subclasses now truncate their `bodyText` at construction, hold it as a non-enumerable private property, and override `toJSON()` to expose only `{ name, message, status }` — closing CR-9 (STRIDE Info-Disclosure / threat V7) on all known sites and flipping LOCKER-05 to BLOCKING.

## Commits

| Task | SHA | Subject |
|------|-----|---------|
| 1 (RED) | `cc77a23` | test(37): red truncation tests for 3 error classes |
| 2 (GREEN) | `f47f929` | feat(37): truncate bodyText in 3 error classes |
| 3 (LOCKER flip) | `0501365` | chore(37): flip LOCKER-05 to BLOCKING |
| 4 (docs) | _(this commit)_ | docs(37): summary CR-9 closed |

## Behavior change

Before:
```ts
const err = new LitellmUpstreamError(500, 'x'.repeat(10000));
JSON.stringify(err); // 10000+ bytes — full body leaked via pino own-property enumeration
```

After:
```ts
const err = new LitellmUpstreamError(500, 'x'.repeat(10000));
JSON.stringify(err);          // ~250 bytes — { "status": 500, "name": "..." }; bodyText is non-enumerable
err.toJSON();                  // { name, message, status }  ← what pino's err serializer calls
Object.keys(err).includes('bodyText'); // false
```

Same fix shape applied to `PyannoteBadRequestError` and `PyannoteUpstreamError`.

## Test counts

| Suite | Tests | Pass |
|-------|------:|-----:|
| `packages/litellm-client` | 40 | 40 |
| `apps/api` pyannote-client + truncation | 38 | 38 |

New RED suite (5 + 8 = 13 tests) all initially failed against `main` (full body present in JSON.stringify, no `toJSON`), all green after Task 2.

## Coverage on diff

| File | Stmts | Branch | Funcs | Lines |
|------|------:|-------:|------:|------:|
| `packages/litellm-client/src/errors.ts` | 100% | 100% | 100% | 100% |
| `apps/api/src/lib/pyannote-client.ts` | 98.78% | 98.03% | 100% | 98.78% |

Uncovered line on pyannote-client.ts is line 279 (a pre-existing fallback in `deriveMediaUri`) — unrelated to the bodyText fix.

## LOCKER-05 BLOCKING confirmation

- `package.json` `lint:secret-shape-in-error` script: `--warn-only` flag **removed**.
- `tools/lint-secret-shape-in-error.allowlist.txt`: 3 entries **removed** (all comment-only header lines remain).
- `pnpm lint:secret-shape-in-error`: exits **0** (clean).
- `pnpm lint:lockers`: exits **0** on HEAD.
- `.planning/DISCIPLINE.md` ledger updated to reflect the BLOCKING flip.

## Design rationale for non-enumerable defineProperty

The plan suggested `private readonly bodyText` (TypeScript-only) and called out `Object.defineProperty` as "even better". We chose `Object.defineProperty(..., { enumerable: false })` because:

1. TypeScript `private` is erased at runtime — pino's serializer still walks own enumerable properties and ships the field.
2. The `toJSON()` override only protects code paths that call `JSON.stringify(err)` or use pino's `err` serializer. Any logger that does `log.warn({ err })` and then internally stringifies via a different path (or `util.inspect`) would still leak.
3. `enumerable: false` drops the field at the lowest level — `JSON.stringify`, `Object.keys`, `for-in` all skip it. This makes the invariant property-shape-based, not call-site-based.

## Deviations from plan

- Pre-existing tests in `packages/litellm-client/tests/unit/index.test.ts` and `apps/api/tests/unit/lib/__tests__/pyannote-client.test.ts` asserted the OLD leaky behavior (`expect(e.bodyText).toContain(...)`, `expect(e.bodyText.length).toBe(5000)`). These were updated in the GREEN commit to assert the new safe invariants instead (no `bodyText` in `Object.keys(e)`, `JSON.stringify(e)` does not contain the secret-shaped payload). This is Rule 1 territory — the old assertions were locking in the bug.

## Self-Check: PASSED

- All cited commit SHAs present on HEAD: `cc77a23`, `f47f929`, `0501365`.
- `pnpm lint:lockers` exit code 0 (BLOCKING mode active for LOCKER-05).
- Allowlist file contains only comment lines (zero entries).
- `--warn-only` absent from `package.json` `lint:secret-shape-in-error`.
- All 3 error classes verified to expose `toJSON()` returning the safe triple.
