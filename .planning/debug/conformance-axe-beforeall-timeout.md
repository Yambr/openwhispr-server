---
status: fixing
trigger: "conformance-axe.yml job 77546104712 run 26342214898 — axe baseline /sign-in fails, 4 others didn't run"
created: 2026-05-23T20:29:11Z
updated: 2026-05-23T20:29:11Z
---

## Current Focus

hypothesis: Playwright `test.beforeAll` default timeout (30000ms) kills `bootStack()` mid-image-pull; `bootStack` budgets 240000ms for cold compose boot.
test: Read job log timing + axe.spec.ts hook + compose-harness DEFAULT_BOOT_TIMEOUT_MS.
expecting: Step elapsed ~30s, log shows "beforeAll hook timeout of 30000ms exceeded", image pulls still in progress at termination.
next_action: Apply fix — set explicit timeout on the beforeAll hook (4th argument or `test.setTimeout` in body) sufficient to cover DEFAULT_BOOT_TIMEOUT_MS + margin.

## Symptoms

expected: All 5 axe-baseline tests run; each /sign-in /sign-up /verify-email /setup /admin produces zero WCAG 2.1 AA violations.
actual: /sign-in fails with "beforeAll hook timeout of 30000ms exceeded"; other 4 tests skipped (Playwright cancels suite when beforeAll fails).
errors: |
  "beforeAll" hook timeout of 30000ms exceeded.
    at tests/conformance/ui-spec/axe.spec.ts:35:6
reproduction: CI conformance-axe.yml on push to main; reproducible whenever cold image pulls take >30s (effectively always on fresh runner).
started: First run on Yambr/openwhispr-server fork (no prior green baseline visible).

## Eliminated

- hypothesis: Recent commit 5e3be923 (healthcheck 127.0.0.1) caused web/api healthcheck to never go healthy.
  evidence: Image pulls hadn't completed at 30s mark — containers had not even started, let alone hit healthcheck phase. Timeout fires long before healthcheck would be probed.
  timestamp: 2026-05-23T20:29:11Z

- hypothesis: Recent commit 07dfa407 (LITELLM_MASTER_KEY fixture) was missing and litellm never came up healthy.
  evidence: Same as above — boot terminated during image-pull phase, before LiteLLM ever started.
  timestamp: 2026-05-23T20:29:11Z

- hypothesis: axe-core WCAG violation on /sign-in page.
  evidence: Test never executed; failure is in `beforeAll` hook before any page navigation or axe scan.
  timestamp: 2026-05-23T20:29:11Z

## Evidence

- timestamp: 2026-05-23T20:29:11Z
  checked: Job 77546104712 log (gh run view --log)
  found: |
    `"beforeAll" hook timeout of 30000ms exceeded.` at axe.spec.ts:35:6.
    Step started 20:05:20, failed 20:05:52 → 32s elapsed.
    At failure, compose-pull was mid-stream (many "Pulling fs layer" entries, only the first 190MB layer "Pull complete").
  implication: Default Playwright beforeAll timeout (30000ms) is far too short for `bootStack()` which budgets 240000ms for cold compose boot (image pulls + container start + healthcheck readiness).

- timestamp: 2026-05-23T20:29:11Z
  checked: tests/e2e-cjm/support/compose-harness.ts L91-92
  found: `export const DEFAULT_BOOT_TIMEOUT_MS = 240_000;` — comment: "laptops cold-pull image layers in <120s typically."
  implication: bootStack documents a 240s budget; Playwright default is 30s — 8× mismatch.

- timestamp: 2026-05-23T20:29:11Z
  checked: tests/conformance/ui-spec/playwright.config.ts
  found: No `timeout`, no `expect.timeout`, no `hooks` timeout override. Default Playwright timeouts apply.
  implication: Config does not bump hook timeout to match bootStack budget.

- timestamp: 2026-05-23T20:29:11Z
  checked: tests/conformance/ui-spec/axe.spec.ts L35-38
  found: |
    test.beforeAll(async () => {
      const result = await bootStack();
      userStackWasRunning = result.userStackWasRunning;
    });
  implication: No timeout argument passed to beforeAll; relies on default.

## Resolution

root_cause: Playwright `test.beforeAll` default timeout of 30000ms is shorter than `bootStack()`'s 240000ms boot budget. On CI cold-start (no Docker layer cache), image pulls exceed 30s and Playwright kills the hook before the compose stack is up.
fix: Add explicit `timeout` argument to both `test.beforeAll` and `test.afterAll` in axe.spec.ts, sized for compose cold boot + teardown margin (use 300000ms for beforeAll to cover the 240000ms bootStack budget + 60s buffer; 120000ms for afterAll teardown).
verification: pending CI re-run after push.
files_changed: ["tests/conformance/ui-spec/axe.spec.ts"]
