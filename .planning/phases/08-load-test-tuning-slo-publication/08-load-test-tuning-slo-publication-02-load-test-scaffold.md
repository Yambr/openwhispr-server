---
phase: 08-load-test-tuning-slo-publication
plan: 02
type: tdd
wave: 0
depends_on: []
files_modified:
  - tools/load-test/package.json
  - tools/load-test/tsconfig.json
  - tools/load-test/tsup.config.ts
  - tools/load-test/vitest.config.ts
  - tools/load-test/src/scenario-picker.ts
  - tools/load-test/src/scenario-picker.test.ts
  - tools/load-test/src/setup.ts
  - tools/load-test/src/setup.test.ts
  - tools/load-test/src/utils/auth.ts
  - tools/load-test/src/utils/http.ts
  - tools/load-test/scripts/verify-compose.sh
  - tools/load-test/scripts/fd-probe.test.sh
  - tools/load-test/README.md
  - pnpm-workspace.yaml
autonomous: true
requirements:
  - SCALE-06
  - SCALE-07
  - TEST-LOAD-01
must_haves:
  truths:
    - "A new pnpm workspace `@openwhispr/load-test` exists under tools/load-test/ and is reachable via `pnpm --filter @openwhispr/load-test test`."
    - "The scenario picker, given a seedable RNG, distributes 10,000 iterations across {transcribe, reason, agent-stream, realtime-ws} within ±2% of the locked 50/25/15/10 mix (D-LOAD-3)."
    - "The k6 setup() helper is idempotent and tolerates re-runs without erroring."
    - "`bash tools/load-test/scripts/verify-compose.sh` succeeds against the existing docker-compose.yml (no load-test profile yet — script must handle 'profile not found' gracefully OR be wired to assert only on profile config validity once Wave 1 lands; Wave 0 ships the script + the unit test for its argument parsing only)."
    - "`bash tools/load-test/scripts/fd-probe.test.sh` simulates ulimit < 65535 and ulimit = 65535 inputs and asserts the probe exits 1 vs 0 (the probe shell script itself is plan 04)."
  artifacts:
    - path: "tools/load-test/package.json"
      provides: "Workspace package definition with @grafana/k6-types, tsup, typescript, vitest deps"
      contains: "@openwhispr/load-test"
    - path: "tools/load-test/src/scenario-picker.ts"
      provides: "Weighted RNG picker over 4 endpoints (50/25/15/10)"
      min_lines: 15
      exports: ["pick", "pickWith", "WEIGHTS"]
    - path: "tools/load-test/src/scenario-picker.test.ts"
      provides: "Distribution + determinism tests"
    - path: "tools/load-test/src/setup.ts"
      provides: "k6 setup() helper that pre-provisions N users via Better Auth /api/auth/sign-up/email"
    - path: "tools/load-test/src/setup.test.ts"
      provides: "Unit tests for setup() with mocked http (process boundary mock only)"
    - path: "tools/load-test/src/utils/auth.ts"
      provides: "Bearer rotation helper that reads set-auth-token from any response and updates VU bearer state"
    - path: "tools/load-test/src/utils/http.ts"
      provides: "BASE_URL constant + insecureSkipTLSVerify default + standard headers"
    - path: "tools/load-test/scripts/verify-compose.sh"
      provides: "Compose-config validator for load-test profiles"
    - path: "tools/load-test/scripts/fd-probe.test.sh"
      provides: "Shell test asserting fd-probe.sh contract"
    - path: "pnpm-workspace.yaml"
      provides: "Registers tools/load-test as a workspace member"
      contains: "tools/load-test"
  key_links:
    - from: "tools/load-test/src/scenario-picker.test.ts"
      to: "tools/load-test/src/scenario-picker.ts"
      via: "import + seeded RNG injection"
      pattern: "pickWith\\("
    - from: "tools/load-test/src/setup.test.ts"
      to: "tools/load-test/src/setup.ts"
      via: "import + mocked http boundary"
      pattern: "provisionUsers\\("
    - from: "tools/load-test/package.json"
      to: "pnpm-workspace.yaml"
      via: "workspace registration"
      pattern: "tools/load-test"
---

<objective>
Stand up the `tools/load-test/` workspace package with the TDD-first units that the k6 load test will consume: scenario picker (weighted RNG), setup() user provisioner, bearer-rotation helper, base HTTP utils, plus the two CI-validating shell scripts (`verify-compose.sh` and the test harness `fd-probe.test.sh` that will exercise the probe script created in plan 04).

This plan ships UNIT-TESTED TypeScript and the test scaffolding only. It does NOT ship the k6 flow files (transcribe.ts / reason.ts / agent-stream.ts / realtime-ws.ts) — those are Wave 2 (plan 06) because they hit live compose services and depend on the load-test profiles existing.

Per D-TDD-1 and D-TDD-2: tests RED before GREEN, ≥90/90/90/90 coverage on diff.

Output: A new workspace package buildable + testable via `pnpm --filter @openwhispr/load-test test`, ready for Wave 2 to add the k6 flows on top.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-load-test-tuning-slo-publication/08-CONTEXT.md
@.planning/phases/08-load-test-tuning-slo-publication/08-RESEARCH.md
@pnpm-workspace.yaml
@apps/api/vitest.config.ts
@apps/api/tsconfig.json

<interfaces>
<!-- Workspace conventions established in apps/api and apps/web. Mirror them. -->
<!-- Vitest config uses the same V8 coverage provider with thresholds: 90/90/90/90 (per CLAUDE.md). -->

Scenario picker contract (from RESEARCH.md §Code Examples):

```typescript
export type Endpoint = 'transcribe' | 'reason' | 'agent-stream' | 'realtime-ws';
export const WEIGHTS: Record<Endpoint, number> = {
  'transcribe': 50, 'reason': 25, 'agent-stream': 15, 'realtime-ws': 10,
};
export function pickWith(rng: () => number): Endpoint;
export const pick: () => Endpoint;  // = pickWith(Math.random)
```

setup() contract (from RESEARCH.md §Code Examples):

```typescript
export interface ProvisionedUser { email: string; token: string; }
export function provisionUsers(opts: {
  backend: string;
  count: number;
  httpClient?: HttpClient;  // injectable for tests
}): ProvisionedUser[];
```

Bearer rotation contract:

```typescript
export function extractBearer(headers: Record<string, string>): string | null;
export function updateBearer(state: { token: string }, response: { headers: Record<string,string> }): void;
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Workspace scaffold + scenario-picker (RED → GREEN)</name>
  <files>tools/load-test/package.json, tools/load-test/tsconfig.json, tools/load-test/tsup.config.ts, tools/load-test/vitest.config.ts, tools/load-test/src/scenario-picker.ts, tools/load-test/src/scenario-picker.test.ts, tools/load-test/README.md, pnpm-workspace.yaml</files>
  <behavior>
    - Test 1 (RED): pickWith(() => 0) returns 'transcribe' (first bucket).
    - Test 2 (RED): pickWith(() => 0.99) returns 'realtime-ws' (last bucket).
    - Test 3 (RED): Over 10,000 iterations with a seedable LCG (Mulberry32), distribution is within ±2% of {transcribe: 50%, reason: 25%, agent-stream: 15%, realtime-ws: 10%}.
    - Test 4 (RED): WEIGHTS sums to exactly 100 (sanity gate against future drift).
    - Test 5 (RED): All four endpoint strings exactly match what apps/api routes expect (no typos — assert against a literal-union snapshot).
  </behavior>
  <action>
    Step 1 (scaffold, no RED yet — pure infra):
    - Create `tools/load-test/package.json` with name `@openwhispr/load-test`, private: true, type: "module", devDeps: `@grafana/k6-types ^0.50`, `tsup ^8`, `typescript ^5.7`, `vitest ^1.6`, `@vitest/coverage-v8 ^1.6`. Scripts: `build`, `test`, `test:coverage`, `typecheck`.
    - Create `tools/load-test/tsconfig.json` extending root tsconfig.base.json with `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`, `types: ["@grafana/k6-types"]`.
    - Create `tools/load-test/tsup.config.ts`: entry `src/main.ts`, format `['esm']`, target `es2022`, outDir `dist`, bundle: true, sourcemap: true, splitting: false (k6 imports flat ES bundle).
    - Create `tools/load-test/vitest.config.ts` mirroring apps/api vitest.config.ts: coverage provider v8 with thresholds `{ lines: 90, functions: 90, branches: 90, statements: 90 }`, `include: ['src/**/*.ts']`, `exclude: ['src/main.ts', 'src/flows/**', 'src/fixtures/**']` (k6 globals not vitest-compatible).
    - Append `tools/load-test` to `pnpm-workspace.yaml` packages array.
    - Run `pnpm install` from repo root.

    Step 2 (RED): Write `tools/load-test/src/scenario-picker.test.ts` with all 5 behaviors. Use a Mulberry32 PRNG for test 3 (well-known seedable algorithm — inline it, no extra dep). Run `pnpm --filter @openwhispr/load-test test` — MUST fail (scenario-picker.ts does not exist yet). Commit: `test(08-02): RED — scenario picker weighted distribution`.

    Step 3 (GREEN): Implement `tools/load-test/src/scenario-picker.ts` per the interfaces block above (pickWith, pick, WEIGHTS, Endpoint). Run tests — MUST pass with coverage ≥90/90/90/90 on the diff. Commit: `feat(08-02): GREEN — scenario picker (50/25/15/10 mix per D-LOAD-3)`.

    Create a 1-page `tools/load-test/README.md` documenting: package purpose, how to run unit tests, where the k6 flows will land (Wave 2 / plan 06), and a pointer to docs/operations.md (Wave 4 / plan 08).
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/load-test test scenario-picker.test.ts</automated>
  </verify>
  <done>5 tests pass; workspace installs; coverage ≥90/90/90/90 on scenario-picker.ts; pnpm-workspace.yaml registers the package.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: setup() user provisioner + auth/http utils (RED → GREEN)</name>
  <files>tools/load-test/src/setup.ts, tools/load-test/src/setup.test.ts, tools/load-test/src/utils/auth.ts, tools/load-test/src/utils/auth.test.ts, tools/load-test/src/utils/http.ts, tools/load-test/src/utils/http.test.ts</files>
  <behavior>
    setup.ts (provisionUsers):
    - Test 1 (RED): Called with count=3, a mocked httpClient that returns 200 + body `{ token: "t<i>" }`, returns 3 ProvisionedUser objects with monotonic emails.
    - Test 2 (RED): If sign-up returns 200 but body has no token, falls back to reading `Set-Auth-Token` header (per RESEARCH.md §setup code example).
    - Test 3 (RED): If sign-up returns non-200, throws with a message identifying the offending user index.
    - Test 4 (RED): Idempotent shape — re-calling with the same count + a fresh httpClient does not crash (emails include a uniqueness suffix; verify the emails differ across invocations).
    - Test 5 (RED): Emits a paced delay (configurable, default 50ms between sign-ups) to avoid even-disabled-rate-limit hammering — verified by injecting a fake clock and asserting delay calls.

    utils/auth.ts (extractBearer / updateBearer):
    - Test 6 (RED): extractBearer reads `set-auth-token` case-insensitively from a header map.
    - Test 7 (RED): updateBearer mutates state.token only when the response carries a new token; no-op otherwise.

    utils/http.ts:
    - Test 8 (RED): exports BASE_URL = `https://api.localhost` (matches Phase 07.1 Traefik surface).
    - Test 9 (RED): exports default headers including `content-type: application/json` and a User-Agent string identifying k6 load test.
  </behavior>
  <action>
    Step 1 (RED): Write all 9 tests across setup.test.ts, utils/auth.test.ts, utils/http.test.ts. Mock the HTTP boundary only (per CLAUDE.md "no mocks of internal logic" — http is a process boundary). Use Vitest's `vi.fn()` for the injectable httpClient. Run tests — MUST fail. Commit: `test(08-02): RED — setup() + auth/http utils`.

    Step 2 (GREEN): Implement the three source files per the interfaces block. Use the exact code shape from RESEARCH.md §Code Examples §k6 setup() (lines 466-491) — but extract the body into a `provisionUsers(opts)` pure function so it is unit-testable outside k6's runtime. The k6 `setup()` thin wrapper that calls into it lives at the bottom of setup.ts and only runs when imported by main.ts (Wave 2).

    Coverage exemption: the thin k6-runtime wrapper that calls `provisionUsers({ backend: BASE_URL, count: N_USERS })` may be excluded from coverage (its execution context is k6, not vitest). Add it to `vitest.config.ts` exclude list.

    Run tests — MUST pass with coverage ≥90/90/90/90 on the diff. Commit: `feat(08-02): GREEN — setup() user provisioner + auth/http utils`.
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/load-test test setup.test.ts utils/</automated>
  </verify>
  <done>9 tests pass; coverage ≥90/90/90/90 on setup.ts + utils/auth.ts + utils/http.ts.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Shell scripts — verify-compose.sh + fd-probe.test.sh (RED → GREEN)</name>
  <files>tools/load-test/scripts/verify-compose.sh, tools/load-test/scripts/verify-compose.test.sh, tools/load-test/scripts/fd-probe.test.sh</files>
  <behavior>
    verify-compose.sh:
    - Test 1 (RED): With no arg, prints usage and exits 1.
    - Test 2 (RED): With an unknown profile name, exits 1 and the stderr contains the offending profile name.
    - Test 3 (RED): With `load-test-mock` (after Wave 1 adds the profile), `docker compose --profile load-test-mock config --quiet` returns 0. Wave 0 cannot fully test the happy path; assert only on argument-parsing and that the script invokes `docker compose --profile $1 config --quiet` (use a stub `docker` on $PATH in the test).
    - Test 4 (RED): Script is `set -euo pipefail` (grep assertion).

    fd-probe.test.sh:
    - Test 5 (RED): Given a mock probe `sh -c 'exit 1'` (simulating soft limit < 65535), the harness records FAIL.
    - Test 6 (RED): Given a mock probe `sh -c 'exit 0'`, harness records PASS.
    - Test 7 (RED): The harness can be pointed at `apps/api/scripts/fd-probe.sh` (which does not yet exist — added in plan 04) via env var `FD_PROBE_PATH`, and reports "probe not found" cleanly if missing.

    Note: The actual `fd-probe.sh` IS plan 04. This task ships only the TEST HARNESS for it, so plan 04 can validate against this harness in CI without re-inventing it.
  </behavior>
  <action>
    Step 1 (RED): Write `tools/load-test/scripts/verify-compose.test.sh` and the bare-minimum `fd-probe.test.sh` with the 7 assertions. Use the BATS-free convention already used in this repo (check `tools/lint-english.sh` style — plain bash `assert_equal` functions or a simple `[[ ... ]]` chain). If no convention exists, define minimal `_pass`/`_fail` helpers inline. Run the test scripts — MUST fail (verify-compose.sh does not exist). Commit: `test(08-02): RED — verify-compose.sh + fd-probe.test.sh harness`.

    Step 2 (GREEN): Implement `verify-compose.sh`:

    ```sh
    #!/bin/sh
    set -euo pipefail
    PROFILE="${1:-}"
    if [ -z "$PROFILE" ]; then
      echo "usage: $0 <profile>" >&2
      exit 1
    fi
    case "$PROFILE" in
      load-test-mock|load-test-realistic) ;;
      *) echo "unknown profile: $PROFILE" >&2; exit 1;;
    esac
    exec docker compose --profile "$PROFILE" config --quiet
    ```

    Finalize `fd-probe.test.sh` to read `FD_PROBE_PATH` (default `apps/api/scripts/fd-probe.sh`) and exercise it with a simulated `ulimit -n` value — runs the script and asserts exit code. Document in comments that plan 04 finishes the contract.

    Run all test scripts — MUST pass. Commit: `feat(08-02): GREEN — verify-compose.sh + fd-probe.test.sh harness`.

    Make scripts executable: `chmod +x tools/load-test/scripts/*.sh`.
  </action>
  <verify>
    <automated>bash tools/load-test/scripts/verify-compose.test.sh && bash tools/load-test/scripts/fd-probe.test.sh</automated>
  </verify>
  <done>Both test scripts exit 0; verify-compose.sh + fd-probe.test.sh are executable; comment block in fd-probe.test.sh references plan 04 explicitly.</done>
</task>

</tasks>

<verification>
- `pnpm --filter @openwhispr/load-test test` runs all unit tests green
- `pnpm --filter @openwhispr/load-test test:coverage` shows ≥90/90/90/90 on the diff
- `pnpm --filter @openwhispr/load-test build` produces a dist/main.js (empty entry is OK for now)
- `pnpm --filter @openwhispr/load-test typecheck` clean
- Shell test harnesses run green: `bash tools/load-test/scripts/verify-compose.test.sh && bash tools/load-test/scripts/fd-probe.test.sh`
- Workspace is registered: `pnpm -r exec true 2>&1 | grep -q load-test`
</verification>

<success_criteria>
- New workspace `@openwhispr/load-test` exists, installs, builds, tests, typechecks
- Scenario picker enforces the locked 50/25/15/10 mix
- setup() pure function is unit-testable outside k6
- Shell harnesses are ready for plan 04 to validate against
- Six RED→GREEN commit pairs land (one per task pair)
</success_criteria>

<output>
After completion, create `.planning/phases/08-load-test-tuning-slo-publication/08-02-SUMMARY.md` per template.
</output>
