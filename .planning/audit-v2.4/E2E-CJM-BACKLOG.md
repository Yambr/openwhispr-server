# e2e-cjm + conformance-axe — known structural backlog

**Status:** Failing on main since Wave 2 root-causing cycle revealed
the underlying structural issues. NOT blocking other CI lanes.
Deferred to a dedicated cleanup phase.

## What's broken

1. ~~**Duplicate step definitions** across 6 files all declaring
   `Given "a signed-in user"`~~ — **CLOSED in quick/r34
   (`quick/r34-dedupe-signed-in-user-step`).** The canonical step now
   lives at `tests/e2e-cjm/steps/shared/auth-shared.steps.ts`; it
   writes the session cookie onto `ctx.cookie` (declared on
   `CjmFixtures` in `support/world.ts`). The 6 prior duplicate blocks
   were deleted; downstream When/Then handlers fall back to
   `ctx.cookie` via inline `(s.cookie ?? ctxCookie)` reads or a tiny
   per-file `cookieFor(ctx, s)` helper. bddgen no longer reports
   `Error: Multiple definitions matched scenario step`.

   **Follow-up surfaced** (not closed here, per quick scope):
   playwright-bdd 8.5.1's `fixtureParameterNames` check now refuses
   handler signatures whose first runtime argument is not an object-
   destructure pattern (`function ({ apiBaseURL, ... }, ctx)`). The
   existing 6 step files use `function (this, ctx)`; TS type-strip
   reduces this to `function (ctx)` at runtime, which the gen-time
   guard rejects. Tracked as the next e2e-cjm-load defect; needs a
   sweep to convert every handler in `tests/e2e-cjm/steps/**/*.steps.ts`
   to the destructured-first-arg form before the suite can run.

2. The dedicated cucumber-expression cleanup quick (Wave 2 #18 =
   `07160543`) covered the two bare-slash step expressions that
   blocked spec generation. The duplicate-definition layer surfaces
   only AFTER that fix.

3. The `bddgen` step wiring into `make e2e-cjm` (reverted) revealed
   that the .bdd-gen/ directory ships nothing useful — the local
   .bdd-gen contents are stale from a previous bddgen run on a
   different branch.

## Wave 2 progress that LED here

After 17 root-cause layers (env secrets → DSN → HTTPS origin → API
healthcheck race → YAML duplicate key → log-dump trap → web
healthcheck favicon → wget regex syntax → web wget bare /), all
containers finally went healthy on CI run 26330458065:

```
api-1     healthy
web-1     healthy
litellm-1 healthy
worker-1  Up
migrate-1 Exited (0)
```

Only then did the playwright layer surface — `Error: No tests found`
→ cucumber-expressions bare slashes → duplicate step definitions.

## Resolution path (NOT in this session)

Separate cleanup phase needed:

- **Extract shared step definitions** into a single `auth.steps.ts`
  or `support/common-steps.ts`. The other 6 files import from there
  or declare a more-specific predicate (e.g. `Given "a signed-in
  user with a corporate LiteLLM key"`).

- **Add bddgen step to Makefile** explicitly (`pnpm exec bddgen
  --config tests/e2e-cjm/playwright.config.ts`) between `wait-for-
  readiness` and `playwright test`. The Make target currently
  assumes .bdd-gen/ is pre-generated, which is brittle in CI.

- **Optionally**: add a `pnpm test:e2e-cjm-bdd-lint` script that
  runs bddgen and fails on conflicts, gated as a CI lane separate
  from the actual e2e run. Catches drift earlier.

## What WORKS now (Wave 2 win)

The diagnostic artifact pipeline (log-dump before teardown, yq
merge for compose overrides, per-service log capture) is now solid
infrastructure. Future e2e-cjm runs WILL produce actionable
compose-logs artifacts on every failure. That capability was the
session's biggest win even if e2e-cjm itself stays red until the
duplicate-defs cleanup phase.
