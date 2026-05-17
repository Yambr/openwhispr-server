# Phase 52 — Advisor decisions (locked)

Source: `gsd-advisor-researcher` run 2026-05-17 against `52-CONTEXT.md` §"Gray areas".

| GA | Pick | One-line rationale |
|---|---|---|
| GA-1 cascade strategy | **(c) Hybrid: `pnpm -r exec tsc --noEmit` per-package inventory, then sequential within package** | Packages are already independent tsc roots; avoids tsconfig mutation while preventing "fix-and-reveal surprise" |
| GA-2 undici 7.x ResponseData | **(a) Fix-at-source: `ResponseData<unknown>` at litellm-client exports + chain through 3-4 consumers** | Pre-OSS publish: types that lie via casts are worse than caller updates; cascade is bounded |
| GA-3 Cyrillic in tests | **(a) Structural-only assertions (`toBeTypeOf`, `not.toBe("Cancel")`)** | Phase 51 precedent already works; allowlist creep is a future i18n-quality phase, not Phase 52 |
| GA-4 biome auto-fix | **(a) Single `biome check --write` commit in plan 52-09** | Auto-fixable rules are AST-deterministic; manual `noNonNullAssertion` + `noUndeclaredVariables` go to 52-10 |
| GA-5 TS2748 const-enum + verbatimModuleSyntax | **(b) `import type` + local `const ARGON2_ID = 2 as const` mirror** | RFC 9106 §3.1 wire-format-fixed; type-system-only fix, no runtime change; greppable name |

## Ordering rules from advisor

1. **52-09 (biome auto-fix) lands AFTER 52-01..52-08 typecheck plans** — biome shouldn't auto-fix into files that a later TS plan rewrites.
2. **52-10 (manual biome) lands last before 52-final**.
3. **litellm-client (52-01) lands FIRST** — `apps/api` + `apps/worker` import from it; downstream typecheck cascades depend on its corrected types.
4. **lens.ts CleanedWhere (52-02) is independent** of 52-01 but blocks `packages/data` tsc — can run in parallel with 52-03..52-08 once 52-01 is done.

## Cross-GA carve-outs (sanity)

- GA-2's `bodyText` TS2564 pattern (`Object.defineProperty` lying to TS) recurs in `pyannote-client.ts:71,94`. Apply the same fix shape (definite-assignment `!:` or `= ''` initializer — NOT a cast). Both files share plan 52-04.
