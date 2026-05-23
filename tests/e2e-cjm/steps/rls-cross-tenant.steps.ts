// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 24 / Plan 24-01 — @cjm-15.* cross-tenant RLS regression sentinel.
//
// Closes G8 from `.planning/qa-audit/2026-05-16-cjm-coverage.md`. Companion
// to @cjm-sso-1.5 (after-phase-19); this file covers the bundled email/
// password path so an RLS regression cannot slip past the test suite while
// SSO ships.
//
// Per `feedback_cjm_steps_need_unit_tests`: sibling vitest unit coverage
// lives at `__tests__/rls-cross-tenant.steps.test.ts` and mocks the HTTP
// boundary so URL/payload bugs trip at TDD speed.

import { Agent, fetch as undiciFetch } from "undici";

import { expect, freshTenant, Given, signedInAs, Then, When } from "../support/fixtures";
import { recordLastResponse } from "./shared/response-shared.steps";

interface ScenarioState {
  tenantA: { tenantId: string; cookie: string; jobIdA?: string };
  tenantB: { tenantId: string; cookie: string; jobIdB?: string };
  response?: { status: number; body: unknown; rawText: string };
}

const state = new Map<string, ScenarioState>();

function stateFor(scenarioTenantId: string): ScenarioState {
  let s = state.get(scenarioTenantId);
  if (!s) {
    s = {
      tenantA: { tenantId: "", cookie: "" },
      tenantB: { tenantId: "", cookie: "" },
    };
    state.set(scenarioTenantId, s);
  }
  return s;
}

function localhostDispatcher(url: string): Agent | undefined {
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host.endsWith(".localhost")) {
      return new Agent({ connect: { rejectUnauthorized: false } });
    }
  } catch {
    /* unreachable */
  }
  return undefined;
}

/**
 * Provision a fresh tenant (sign-up + email-verify + sign-in) and return
 * the session cookie header value. Reuses the canonical Better Auth
 * helpers from support/fixtures.ts.
 */
export async function provisionTenant(
  apiBaseURL: string,
  mailpitApiUrl: string,
  tenantSeed: { tenantId: string },
): Promise<{ tenantId: string; cookie: string; identity: ReturnType<typeof freshTenant> }> {
  const id = freshTenant(tenantSeed.tenantId);
  const cookie = await signedInAs(apiBaseURL, mailpitApiUrl, id);
  return { tenantId: id.tenantId, cookie, identity: id };
}

/**
 * Record a transcribe job for a given session and return its id. Returns
 * the body, status, and a parsed jobId so callers can pin the cross-tenant
 * read in the next step.
 *
 * Phase 19.2 wired POST /api/transcribe end-to-end; this step assumes the
 * happy-path 200 response carries `{ id: string }` per BACKEND_SPEC.md.
 */
export async function recordTranscribeJob(
  apiBaseURL: string,
  cookie: string,
): Promise<{ jobId: string; status: number }> {
  const url = `${apiBaseURL}/api/transcribe`;
  const dispatcher = localhostDispatcher(url);
  const res = await undiciFetch(url, {
    method: "POST",
    headers: {
      origin: new URL(url).origin,
      cookie,
      "content-type": "audio/wav",
    },
    body: Buffer.alloc(64, 0), // 64-byte silent WAV stub — gets recorded
    ...(dispatcher ? { dispatcher } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: unknown };
  const jobId = typeof body.id === "string" ? body.id : "";
  return { jobId, status: res.status };
}

/** Read a transcribe job by id with a given session cookie. */
export async function readTranscribeJob(
  apiBaseURL: string,
  cookie: string,
  jobId: string,
): Promise<{ status: number; body: unknown; rawText: string }> {
  const url = `${apiBaseURL}/api/transcribe/jobs/${encodeURIComponent(jobId)}`;
  const dispatcher = localhostDispatcher(url);
  const res = await undiciFetch(url, {
    method: "GET",
    headers: { origin: new URL(url).origin, cookie },
    ...(dispatcher ? { dispatcher } : {}),
  });
  const rawText = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    body = rawText;
  }
  return { status: res.status, body, rawText };
}

Given(
  "two fresh email-password tenants T_A and T_B exist",
  async function (
    this,
    {
      apiBaseURL,
      mailpitApiUrl,
      tenantId,
    }: { apiBaseURL: string; mailpitApiUrl: string; tenantId: string },
  ) {
    // playwright-bdd injects fixtures on `this` per createBdd(test) — the
    // scenario-level `tenantId` fixture is the canonical isolation handle.
    const s = stateFor(tenantId);
    s.tenantA = await provisionTenant(apiBaseURL, mailpitApiUrl, {
      tenantId: `${tenantId}-A`,
    });
    s.tenantB = await provisionTenant(apiBaseURL, mailpitApiUrl, {
      tenantId: `${tenantId}-B`,
    });
  },
);

Given(
  "T_A has a signed-in session",
  // `provisionTenant` already returns a signed-in cookie — this step is a
  // narrative beat that the Background covers in step 1. No-op. The
  // destructured `tenantId` is unused but required for playwright-bdd 8.x
  // fixture-injection contract.
  async function (this, { tenantId: _tenantId }: { tenantId: string }) {
    // no-op
  },
);

Given(
  "T_B has a transcribe job recorded with a known id",
  async function (this, { apiBaseURL, tenantId }: { apiBaseURL: string; tenantId: string }) {
    const s = stateFor(tenantId);
    const { jobId } = await recordTranscribeJob(apiBaseURL, s.tenantB.cookie);
    s.tenantB.jobIdB = jobId;
  },
);

Given(
  "T_A also has a transcribe job recorded with a known id",
  async function (this, { apiBaseURL, tenantId }: { apiBaseURL: string; tenantId: string }) {
    const s = stateFor(tenantId);
    const { jobId } = await recordTranscribeJob(apiBaseURL, s.tenantA.cookie);
    s.tenantA.jobIdA = jobId;
  },
);

When(
  "T_A requests the transcribe job from T_B by id",
  async function (this, { apiBaseURL, tenantId }: { apiBaseURL: string; tenantId: string }) {
    const s = stateFor(tenantId);
    if (!s.tenantB.jobIdB) {
      throw new Error("Background did not record T_B's job id");
    }
    s.response = await readTranscribeJob(apiBaseURL, s.tenantA.cookie, s.tenantB.jobIdB);
    recordLastResponse(tenantId, {
      status: s.response.status,
      body: s.response.body,
      rawText: s.response.rawText,
    });
  },
);

When(
  "T_A requests their own transcribe job by id",
  async function (this, { apiBaseURL, tenantId }: { apiBaseURL: string; tenantId: string }) {
    const s = stateFor(tenantId);
    if (!s.tenantA.jobIdA) {
      throw new Error("@cjm-15.2 missing T_A's own job id from Background");
    }
    s.response = await readTranscribeJob(apiBaseURL, s.tenantA.cookie, s.tenantA.jobIdA);
    recordLastResponse(tenantId, {
      status: s.response.status,
      body: s.response.body,
      rawText: s.response.rawText,
    });
  },
);

// Canonical `Then "the response status is {int}"` lives in
// steps/shared/response-shared.steps.ts.

// Canonical body/envelope Then handler lives in
// steps/shared/response-shared.steps.ts.

Then(
  "the body MUST NOT leak the resource's existence",
  async function (this, { tenantId }: { tenantId: string }) {
    const s = stateFor(tenantId);
    if (!s.response) throw new Error("step ordering: no response captured");
    const code = (s.response.body as { error?: { code?: string } })?.error?.code ?? "";
    // 404 paths code === "not_found"; a "forbidden_*" code would reveal
    // that the resource exists. Asserting on the code is more reliable
    // than asserting the absence of words in a free-form message.
    expect(code).toMatch(/^not_found$/);
  },
);

// Canonical "the body MUST NOT contain a Node.js stack trace" Then handler
// lives in steps/shared/response-shared.steps.ts.

Then("the body contains the job record", async function (this, { tenantId }: { tenantId: string }) {
  const s = stateFor(tenantId);
  if (!s.response) throw new Error("step ordering: no response captured");
  expect(s.response.body).toMatchObject({ id: expect.any(String) });
});
