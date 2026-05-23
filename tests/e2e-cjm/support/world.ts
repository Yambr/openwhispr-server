// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 / Plan 01 / Task 13-01-07 — final playwright-bdd 8.4.2 world.
//
// This file extends `test` from "playwright-bdd" with the per-scenario
// fixtures the CJM step files need, and binds the BDD DSL (Given/When/Then)
// against the extended test. Step files import the DSL from here:
//
//   import { Given, When, Then } from "../support/world";
//
// Per Session-1 §4c: `createBdd()` REQUIRES a `test` instance derived from
// `"playwright-bdd"` (NOT `@playwright/test`). Passing the bare playwright
// test fails fast at bddgen with:
//
//   Error: createBdd() should use 'test' extended from "playwright-bdd"
//
// Fixtures wired here:
//   - apiBaseURL: canonical `https://api.localhost`; honors a
//     `WEB_BASE_URL`-style override via `API_BASE_URL` env for future
//     CI matrix slices.
//   - mailpitApiUrl: canonical `https://mailpit.localhost/api/v1`; honors
//     `MAILPIT_API_URL` env.
//   - tenantId: per-scenario UUID v4 so RLS isolation is provable in
//     downstream multi-tenant CJM scenarios (Plan 13-02+). Used by the
//     Better Auth signup body in the step files.
//
// Per Session-1 §4b the `importTestFrom` option is gone; this file is
// loaded via the `steps: ["support/**/*.ts", ...]` glob in
// `playwright.config.ts` so the binding fires before any step file
// references the DSL.
// `expect` is re-exported from @playwright/test; `test` MUST come from
// playwright-bdd (see Session-1 §4c). The two-source import is intentional.

import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { test as base, createBdd } from "playwright-bdd";

import {
  DEFAULT_MAILPIT_API_URL,
  extractVerificationLink,
  type MailpitMessage,
  type WaitForEmailOptions,
  waitForEmail,
} from "./mailpit-helper.js";

/**
 * Per-scenario fixture surface. playwright-bdd worker fixtures could also
 * carry these (shared once per worker), but per-test scope is what the CJM
 * scenarios want: each scenario gets a fresh tenant + a fresh mailpit
 * cursor. Worker-scope fixtures should be used only for things that cost
 * real money to build (browser context per worker is already worker-scope
 * in upstream playwright).
 */
export interface CjmFixtures {
  apiBaseURL: string;
  mailpitApiUrl: string;
  /** Per-scenario tenant id (UUID v4). */
  tenantId: string;
  /**
   * Session cookie populated by the canonical `Given "a signed-in user"`
   * step (see `steps/shared/auth-shared.steps.ts`). Per-scenario step
   * files read this via `ctx.cookie` instead of re-running sign-in.
   * Mutated by the shared Given handler; downstream When/Then handlers
   * fall back to this when their local state map has no cookie yet.
   */
  cookie?: string;
  /**
   * Wait for a verification email sent to `toAddress`. Closure-binds the
   * `mailpitApiUrl` fixture so steps don't repeat the env-resolution dance.
   */
  waitForVerificationEmail: (
    toAddress: string,
    opts?: Omit<WaitForEmailOptions, "baseUrl">,
  ) => Promise<MailpitMessage>;
  /** Pure helper — exposed via fixture so step files don't import directly. */
  extractVerificationLink: (msg: MailpitMessage) => string;
}

/**
 * Extended test. Each fixture uses the standard playwright `[fn, scope]`
 * tuple form. `tenantId` is `test`-scoped (fresh per scenario); `apiBaseURL`
 * and `mailpitApiUrl` are also test-scoped (cheap; lets `pw test --env-...`
 * overrides land deterministically).
 */
// Playwright's `test.extend` fixture signature requires the first argument to
// be a destructuring pattern; empty `{}` declares "no upstream fixtures
// consumed". Rewriting as `_fixtures` is a Playwright API mismatch (the runner
// introspects the destructured names to wire dependencies). The per-fixture
// `biome-ignore` directives are intentional.
export const test = base.extend<CjmFixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture API.
  apiBaseURL: async ({}, use) => {
    await use(process.env.API_BASE_URL ?? "https://api.localhost");
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture API.
  mailpitApiUrl: async ({}, use) => {
    await use(DEFAULT_MAILPIT_API_URL);
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture API.
  tenantId: async ({}, use) => {
    await use(randomUUID());
  },
  waitForVerificationEmail: async ({ mailpitApiUrl }, use) => {
    await use(async (toAddress, opts) =>
      waitForEmail(toAddress, { ...opts, baseUrl: mailpitApiUrl }),
    );
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture API.
  extractVerificationLink: async ({}, use) => {
    await use(extractVerificationLink);
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture API.
  cookie: async ({}, use) => {
    // Default is undefined; the shared Given step mutates ctx.cookie
    // in-place on sign-in. See steps/shared/auth-shared.steps.ts.
    await use(undefined);
  },
});

export { expect };

export const { Given, When, Then, Step, Before, After, BeforeAll, AfterAll } = createBdd(test);
