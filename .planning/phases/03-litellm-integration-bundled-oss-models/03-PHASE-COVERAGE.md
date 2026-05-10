# Phase 3 — Per-Package Coverage Thresholds (HIGH-3 closure)

> **Status:** active
> **Authored by:** Plan 03-02 / Task 4
> **Verified by:** `/gsd-verify-work` on phase closeout

## Why

CLAUDE.md (constitutional) mandates a **per-phase coverage floor ≥ 90%** on
all new/modified code in that phase. The repository root
[`vitest.config.ts`](../../../vitest.config.ts) enforces 85/80/80/85
project-wide — that is the codebase floor, not the phase floor.

Phase 3 plans 03..08 each cite ≥ 90% in their `<done>` blocks. Before
this plan, no machinery enforced that claim — the previous review
(HIGH-3) flagged it as unverifiable. This plan wires per-package vitest
configs that override the root thresholds upward to 90 for the four
Phase-3-touched packages.

## Per-package configs

| Package | Config | Threshold (lines/branches/functions/statements) |
|---|---|---|
| `apps/api` | [`apps/api/vitest.config.ts`](../../../apps/api/vitest.config.ts) | **90 / 90 / 90 / 90** |
| `packages/litellm-client` | [`packages/litellm-client/vitest.config.ts`](../../../packages/litellm-client/vitest.config.ts) | **90 / 90 / 90 / 90** |
| `packages/data` | [`packages/data/vitest.config.ts`](../../../packages/data/vitest.config.ts) | **90 / 90 / 90 / 90** |
| `apps/worker` | _DOES NOT EXIST YET_ | **Plan 03-08 MUST author `apps/worker/vitest.config.ts` with the same shape** as part of its task. |

Root `vitest.config.ts` is **unchanged** (still 85/80/80/85) — it remains
the project-wide floor for everything else. Per-package configs use
`mergeConfig(rootConfig, ...)` so they inherit the root exclude list,
provider, and reporter — overriding ONLY thresholds and narrowing
`coverage.include` to the package's `src/**/*.ts`.

## Critical correctness — Vitest 4 silent-breakage trap

Thresholds **MUST** be nested under `coverage.thresholds.*`. The Vitest 2
flat-key shape (`coverage.lines`, `coverage.branches`) is silently
ignored by Vitest 4 — it parses without error and runs without
enforcement. This is the single highest-risk failure mode for the
constitutional coverage gate. See
[the long comment block in the root config](../../../vitest.config.ts).

`tests/unit/per-package-coverage-thresholds.test.ts` pins this invariant
across all four packages.

## Plan invocation contract

Plans **03..08** MUST cite `pnpm --filter <pkg> test --coverage` in
their `<done>` blocks; `<pkg>` is the package whose new code that plan
adds:

| Plan | Package(s) covered |
|---|---|
| 03-03 | `apps/api`, `packages/litellm-client` |
| 03-04 | `apps/api`, `packages/litellm-client` |
| 03-05 | `apps/api` |
| 03-06 | `apps/api` |
| 03-07 | `apps/api` |
| 03-08 | `apps/worker`, `packages/data` |

If a plan's diff lands code in a package whose config does not yet
exist (e.g. `apps/worker` before Plan 03-08), the plan MUST author the
config in the SAME commit as the first source file.

## Plan 03-08 reminder

Plan 03-08 creates `apps/worker/`. Before its first source-file commit,
it MUST author `apps/worker/vitest.config.ts` with the same shape as
the three configs above — same `mergeConfig(rootConfig, ...)`, same
nested `thresholds.{lines,branches,functions,statements}=90`, same
`include: ['src/**/*.ts']`. Without that config, the worker package
would inherit the looser root 85/80/80/85 floor and the Plan 03-08
`<done>` block's 90% claim would be unverifiable — re-opening HIGH-3.

## Verification on phase closeout

`/gsd-verify-work` runs:

```bash
pnpm --filter @openwhispr/api test --coverage --run
pnpm --filter @openwhispr/litellm-client test --coverage --run
pnpm --filter @openwhispr/data test --coverage --run
pnpm --filter @openwhispr/worker test --coverage --run   # only after Plan 03-08
```

Each must exit 0 with no `coverage threshold for X (90%) not met` lines.

## Open follow-up — apps/api/src/index.ts exclusion

The root vitest.config.ts excludes `apps/api/src/index.ts` (Phase-0
placeholder). Plan 03-03 Task 2 (HIGH-4 — multipart-plugin
registration) adds NEW lines to that file. **Plan 03-03 MUST remove the
`apps/api/src/index.ts` entry from the root exclude list in the SAME
commit that fills out the file.** Without that, the new multipart-
registration lines would not count toward the 90% floor.
