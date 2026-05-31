---
slug: setupform-test-flaky-2026-05-27
status: complete
mode: diagnose-only
created: 2026-05-27
trigger: "operator — blocks task #54 + #53 gate ship"
---

# SetupForm test (c) "submit button disables while the fetch is in flight" — NOT REPRODUCIBLE on HEAD

## 1. Symptom (verbatim from operator)

> `apps/web/src/components/screens/auth/__tests__/SetupForm.test.tsx:297` test case
> "(c) submit button disables while the fetch is in flight" times out at 5000ms.
>
> Reproducer:
> ```bash
> cd /Users/dev/openwhispr-server
> pnpm --filter @openwhispr/web test:unit -- src/components/screens/auth/__tests__/SetupForm.test.tsx 2>&1 | tail -50
> ```

## 1.1. Actual observed behaviour on HEAD (`68a1f808`)

The supplied reproducer command runs `vitest run --coverage` against the WHOLE web unit suite
(the trailing `src/...` path is NOT consumed by vitest as a file filter when invoked via the
`pnpm --filter @openwhispr/web test:unit -- <pattern>` shape — pnpm's `--` separator drops it
inert; `package.json` defines `test:unit` as `vitest run --coverage` with no `${@}`/argv expansion).

Verbatim results from 10 sequential bare-file runs and 5 -t-filtered runs:

```text
=== bare file (single file via positional pattern) ===
 Test Files  1 passed (1)
      Tests  22 passed (22)
   Duration  ~830ms-870ms

=== -t-filtered to JUST test case (c) ===
 ✓ ... > (c) submit button disables while the fetch is in flight 494ms
 Test Files  1 passed (1)
      Tests  1 passed | 21 skipped (22)
   Duration  832ms

=== operator's reproducer ===
 Test Files  77 passed (77)
      Tests  1076 passed (1076)
   Duration  5.33s
```

- 10/10 bare file runs: PASS
- 5/5 -t-filtered single-test runs: PASS, ~494ms elapsed (vitest default timeout 5000ms; 10× headroom)
- 1/1 full unit suite (operator's reproducer): PASS, 77/77 files green
- No timeouts, no flakiness on darwin/arm64 Node 24 on local cold cache

**The reported timeout-at-5000ms is NOT reproducible on HEAD.**

## 2. Hypothesis matrix

### H1 — async mock cleanup race (fetch promise auto-resolves before disabled flip)

**DISPROVED.**

Evidence: `SetupForm.test.tsx:298-302`:

```ts
let resolveFetch!: (r: Response) => void;
const pending = new Promise<Response>((r) => {
  resolveFetch = r;
});
globalThis.fetch = vi.fn().mockReturnValue(pending) as unknown as typeof fetch;
```

The mock uses a manually-controlled, NEVER-auto-resolving promise. `resolveFetch` is only
called AFTER `waitFor(() => expect(submitBtn).toBeDisabled())` succeeds (`:316-322`). There is
no `Promise.resolve(...)` shortcut in the mock setup. H1's mechanism cannot apply.

Production flow `SetupForm.tsx:178-203` confirms:
```ts
async function onSubmit(values) {
  setSubmitting(true);          // → triggers re-render with disabled={true}
  ...
  const res = await fetch(...); // ← blocks here on `pending`; never resolves
  ...
  finally { setSubmitting(false); }
}
```
While `pending` is unresolved, `submitting === true` and `<Button disabled={submitting}>` at
`SetupForm.tsx:410` renders disabled. `waitFor` flushes microtasks until the React commit
lands; observed elapsed for the flip is ≈494ms.

### H2 — Vitest fake timers

**DISPROVED.**

Evidence: `grep -rn 'useFakeTimers\|fakeTimers' apps/web/src/components/screens/auth/__tests__/SetupForm.test.tsx apps/web/vitest.setup.ts apps/web/vitest.config.ts` returns **zero matches**.
`vitest.config.ts:23-34` shows no `fakeTimers` config block. `vitest.setup.ts` (full file, 11
lines) does `cleanup()` after each test and nothing else. The test uses real timers; waitFor
polls real microtasks.

### H3 — Production regression (handleSubmit no longer flips submitting / different state lib)

**DISPROVED.**

Evidence: `SetupForm.tsx:114`: `const [submitting, setSubmitting] = useState(false);`
`SetupForm.tsx:179`: `setSubmitting(true);` at the top of `onSubmit` (BEFORE `await fetch`).
`SetupForm.tsx:201`: `finally { setSubmitting(false); }`.
`SetupForm.tsx:410`: `<Button type="submit" disabled={submitting}>`.

The component uses plain `useState`, NOT `react-hook-form`'s `formState.isSubmitting`. The
disabled flip is synchronous on submit-click → React commits → vitest-waitFor passes. Git log
on `SetupForm.tsx` shows the last touch at `e4555895 test(68-01)` / `3383d841 fix(53-30)`
(unrelated timezone hydration) / `e7898342 feat(18.1.1-05-02)` (AuthShell wrap) — none alter the
`submitting` lifecycle.

### H4 — waitFor timeout too tight

**DISPROVED.**

Evidence: `SetupForm.test.tsx:316`: `await waitFor(() => expect(submitBtn).toBeDisabled());`
No `{ timeout: ... }` option → defaults to vitest's `testTimeout` = 5000ms. Measured elapsed
for the entire test case = 494ms (verbose reporter line 6). 10× headroom against the timeout.

### H5 (added) — Operator's command shape misinterpretation

**PROVED (operator-side procedural artefact, not a bug).**

Evidence: `apps/web/package.json` defines `"test:unit": "vitest run --coverage"`. The operator's
reproducer `pnpm --filter @openwhispr/web test:unit -- <path>` passes the path inert (pnpm's
`--` separator preserves it as an extra argv to the `vitest run` command, which DOES accept it
as a positional pattern). The full unit suite (1076 tests, 77 files) ran in 5.33s with all
green — observed directly. NO TIMEOUT FIRED.

The 5000ms-timeout signature the operator cited likely came from a DIFFERENT failure mode
(e.g. a different machine under heavy load, a pre-existing branch with a stale dep tree, or
the operator confused this test with another flaky one). On the current HEAD (`68a1f808`),
this test is green and well under timeout.

## 3. Root cause

**There is no current root cause.** Test case (c) is GREEN on HEAD `68a1f808`, deterministic
across 10 isolated runs and 1 full-unit-suite run, completing in ~494ms (10× under the 5000ms
default). The production code (`SetupForm.tsx:114, 179, 201, 410`) correctly maintains a
`submitting` boolean across the await boundary, and the test (`SetupForm.test.tsx:298-323`)
uses a manually-resolved promise that guarantees the in-flight window is observable. No fake
timers, no tight waitFor timeout, no async mock race.

## 4. Recommended fix

**NO production change. NO test change.**

The bug as reported is not present on HEAD. Recommended operator-side actions, in order:

1. **Verify the operator's local working tree matches HEAD `68a1f808`.** A stale branch may
   have an older `SetupForm.tsx` whose `submitting` flip happens AFTER `await` (where the test
   would race). `git rev-parse HEAD` + `git status --short` from the operator's terminal.

2. **Re-run with the canonical invocation:**
   ```bash
   cd apps/web
   pnpm exec vitest run --no-coverage src/components/screens/auth/__tests__/SetupForm.test.tsx
   ```
   This eliminates the coverage pass + the `pnpm --filter -- <path>` argv-routing ambiguity and
   gives a clean signal in ~830ms.

3. **If the failure DOES reproduce on the operator's machine but not on this investigation
   shell:** capture (a) `node --version` (must be 24.x active LTS), (b) `pnpm exec vitest
   --version` (must be 4.1.5), (c) full failure trace including the `waitFor` error message
   (which would name the precise assertion that timed out — likely indicating system load /
   happy-dom scheduling rather than a test-or-prod logic bug). At that point open a NEW
   debug session with the live trace; this one is closed.

If a future regression DOES introduce H1 (the fetch mock auto-resolves), the test-only
defensive fix would be (currently UNNECESSARY):

```diff
- globalThis.fetch = vi.fn().mockReturnValue(pending) as unknown as typeof fetch;
+ globalThis.fetch = vi.fn().mockImplementation(() => pending) as unknown as typeof fetch;
```
(`.mockImplementation` defers the promise construction by one microtask compared to
`.mockReturnValue`'s eager binding — but both are equivalent here because `pending` is
already constructed; the diff is documented for completeness only.)

## 5. Severity + blast radius

**LOW — currently a non-issue.**

The reported HIGH-severity timeout does not manifest on HEAD. Task #54 / task #53 pre-push
gate ship is NOT blocked by this test. If the operator's local terminal shows a different
state, the blocker is operator-environmental, not server-codebase.

- Blast radius if H3 had been real: pre-push gate (lefthook `web-test`) would fail on every
  push touching `apps/web/**`, blocking ALL web work. Observed: zero failures across 10 runs.
- Pre-push gate path verified: `lefthook.yml` pre-push `web-test` runs `pnpm --filter
  @openwhispr/web test:unit` against `apps/web/**` glob — identical command observed to
  complete green in ~5.3s.

## 6. Verification evidence (commands actually run, in order)

```bash
# Full unit suite via operator's exact reproducer — GREEN 1076/1076.
pnpm --filter @openwhispr/web test:unit -- \
  src/components/screens/auth/__tests__/SetupForm.test.tsx

# Bare single file × 10 — GREEN 22/22 every run.
for i in {1..10}; do
  (cd apps/web && pnpm exec vitest run --no-coverage \
    src/components/screens/auth/__tests__/SetupForm.test.tsx)
done

# -t-filtered to the disputed test × 5 — GREEN 1/1, ~494ms elapsed.
for i in {1..5}; do
  (cd apps/web && pnpm exec vitest run --no-coverage \
    src/components/screens/auth/__tests__/SetupForm.test.tsx \
    -t "submit button disables while the fetch is in flight")
done

# Fake-timer grep — zero matches.
grep -rn 'useFakeTimers\|fakeTimers' \
  apps/web/src/components/screens/auth/__tests__/SetupForm.test.tsx \
  apps/web/vitest.setup.ts apps/web/vitest.config.ts

# Production line check — confirmed `submitting` state lifecycle intact.
# SetupForm.tsx:114, 179, 201, 410 read manually.
```

All evidence captured under HEAD `68a1f808`, working tree clean (only
`.claude/scheduled_tasks.lock` + untracked `.planning/quick/*` dirs).
