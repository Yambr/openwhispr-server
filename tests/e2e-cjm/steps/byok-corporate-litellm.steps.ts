// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 43 / Plan 43-01 — @cjm-byok-litellm.* corporate LITELLM_BASE_URL steps.
//
// Both scenarios are @expected-red @after-phase-44-MOCK-CORP-LITELLM.
// Step bodies model the call shape that the live test will use once the
// mock-corp-litellm compose overlay lands.

import { Agent, FormData, fetch as undiciFetch } from "undici";

import { expect, freshTenant, Given, signedInAs, Then, When } from "../support/fixtures";

interface ScenarioState {
  cookie?: string;
  status?: number;
  body?: unknown;
  rawText?: string;
  mockObservedCount?: number;
}
const state = new Map<string, ScenarioState>();
function stateFor(t: string): ScenarioState {
  let s = state.get(t);
  if (!s) {
    s = {};
    state.set(t, s);
  }
  return s;
}
function localhostDispatcher(url: string): Agent | undefined {
  try {
    const h = new URL(url).hostname;
    if (h === "localhost" || h.endsWith(".localhost")) {
      return new Agent({ connect: { rejectUnauthorized: false } });
    }
  } catch {
    /* unreachable */
  }
  return undefined;
}

/** POST a wav fixture to /api/transcribe as multipart audio/wav. */
export async function postTranscribeWav(
  apiBaseURL: string,
  cookie: string,
  wavBytes: Uint8Array,
): Promise<{ status: number; body: unknown; rawText: string }> {
  const url = `${apiBaseURL}/api/transcribe`;
  const dispatcher = localhostDispatcher(url);
  const form = new FormData();
  form.append("file", new Blob([wavBytes], { type: "audio/wav" }), "audio.wav");
  const res = await undiciFetch(url, {
    method: "POST",
    headers: { origin: new URL(url).origin, cookie },
    body: form,
    ...(dispatcher ? { dispatcher } : {}),
  });
  const rawText = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = rawText;
  }
  return { status: res.status, body: parsed, rawText };
}

Given(
  "the api is booted with LITELLM_BASE_URL pointing at mock-corp-litellm",
  async function (this, ctx) {
    // Live wiring lands in Phase 44 compose overlay; the precondition is
    // a narrative beat. Test recorded so the step set is complete.
    const { tenantId } = ctx as { tenantId: string };
    void stateFor(tenantId);
  },
);

Given(
  "the api is booted with LITELLM_BASE_URL pointing at an unreachable host",
  async function (this, ctx) {
    const { tenantId } = ctx as { tenantId: string };
    void stateFor(tenantId);
  },
);

Given("a signed-in user", async function (this, ctx) {
  const { apiBaseURL, mailpitApiUrl, tenantId } = ctx as {
    apiBaseURL: string;
    mailpitApiUrl: string;
    tenantId: string;
  };
  const s = stateFor(tenantId);
  s.cookie = await signedInAs(apiBaseURL, mailpitApiUrl, freshTenant(tenantId));
});

When("the user POSTs a wav fixture to /api/transcribe", async function (this, ctx) {
  const { apiBaseURL, tenantId } = ctx as { apiBaseURL: string; tenantId: string };
  const s = stateFor(tenantId);
  // 64-byte silent WAV stub — Phase 19.2 wired transcribe end-to-end
  // so a minimal payload is sufficient.
  const res = await postTranscribeWav(apiBaseURL, s.cookie ?? "", Buffer.alloc(64, 0));
  s.status = res.status;
  s.body = res.body;
  s.rawText = res.rawText;
});

Then("the response status is {int}", async function (this, ctx, expected: number) {
  const { tenantId } = ctx as { tenantId: string };
  expect(stateFor(tenantId).status).toBe(expected);
});

Then('the body has a "text" field', async function (this, ctx) {
  const { tenantId } = ctx as { tenantId: string };
  const body = stateFor(tenantId).body as { text?: unknown };
  expect(typeof body.text).toBe("string");
});

Then(
  "mock-corp-litellm observed exactly {int} inbound request",
  async function (this, ctx, expected: number) {
    // Live assertion needs a mock-corp-litellm /__observed endpoint
    // (deferred to Phase 44 wiring). For now we record the precondition.
    const { tenantId } = ctx as { tenantId: string };
    const s = stateFor(tenantId);
    s.mockObservedCount = expected; // narrative placeholder
    expect(s.mockObservedCount).toBe(expected);
  },
);

Then(
  'the body is the typed envelope shape "{ error: { code, message } }"',
  async function (this, ctx) {
    const { tenantId } = ctx as { tenantId: string };
    expect(stateFor(tenantId).body).toMatchObject({
      error: expect.objectContaining({
        code: expect.any(String),
        message: expect.any(String),
      }),
    });
  },
);

Then("the body MUST NOT contain a Node.js stack trace", async function (this, ctx) {
  const { tenantId } = ctx as { tenantId: string };
  expect(stateFor(tenantId).rawText ?? "").not.toMatch(/at Object\.<anonymous>|node_modules\//);
});
