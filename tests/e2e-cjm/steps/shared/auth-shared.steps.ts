// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase r34 / quick — canonical `Given "a signed-in user"` step binding.
//
// Six CJM step files previously each declared their own copy of this
// step (agent-stream, byok-corporate-litellm, byok-key-rotation,
// diarization, realtime-stream, web-search). playwright-bdd refuses to
// load the suite with `Error: Multiple definitions matched scenario
// step`, so the entire e2e-cjm CI lane is signal-free.
//
// This file is the SINGLE source of truth for the step. It writes the
// session cookie onto the per-scenario `ctx.cookie` fixture (declared in
// `support/world.ts`); downstream When/Then handlers in each feature's
// step file read `ctx.cookie` as a fallback when their local state map
// has no cookie populated yet.
//
// Per `feedback_cjm_steps_need_unit_tests`: sibling vitest unit coverage
// lives at `__tests__/auth-shared.steps.test.ts`.

import { freshTenant, Given, signedInAs } from "../../support/fixtures";

// Existing call-shape preserved verbatim from the 6 original step files.
// The 3-arg signature used here (`apiBaseURL, mailpitApiUrl, id`) pre-
// existed this refactor; see E2E-CJM-BACKLOG.md for the follow-up to
// reconcile against `fixtures.ts` `signedInAs(apiBaseURL, email, password)`.
type SignedInArgs = [apiBaseURL: string, mailpitApiUrl: string, id: ReturnType<typeof freshTenant>];
type SignedInResult = string;
const callSignedIn = signedInAs as unknown as (...args: SignedInArgs) => Promise<SignedInResult>;

Given("a signed-in user", async ({ apiBaseURL, mailpitApiUrl, tenantId }, ctx) => {
  // playwright-bdd 8.x requires the first parameter to be an object-destructure
  // pattern (it's the Playwright fixture set); the second param `ctx` is the
  // bdd-world ctx used to share state across steps. We treat `ctx` as a mutable
  // bag carrying the per-scenario session cookie. The destructured names above
  // (apiBaseURL, mailpitApiUrl, tenantId) line up with CjmFixtures keys.
  void apiBaseURL;
  void mailpitApiUrl;
  const c = ctx as { apiBaseURL: string; mailpitApiUrl: string; tenantId: string; cookie?: string };
  c.cookie = await callSignedIn(c.apiBaseURL, c.mailpitApiUrl, freshTenant(c.tenantId ?? tenantId));
});
