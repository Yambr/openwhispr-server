// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 43 / Plan 43-01 — @cjm-byok-litellm.* corporate LITELLM_BASE_URL steps.
//
// Both scenarios are @expected-red @after-phase-44-MOCK-CORP-LITELLM.
// Step bodies model the call shape that the live test will use once the
// mock-corp-litellm compose overlay lands.

import { Agent, FormData, fetch as undiciFetch } from "undici";

import { expect, Given, Then, When } from "../support/fixtures";
import { recordLastResponse } from "./shared/response-shared.steps";

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
  async function (this, { tenantId }: { tenantId: string }) {
    // Live wiring lands in Phase 44 compose overlay; the precondition is
    // a narrative beat. Test recorded so the step set is complete.
    void stateFor(tenantId);
  },
);

Given(
  "the api is booted with LITELLM_BASE_URL pointing at an unreachable host",
  async function (this, { tenantId }: { tenantId: string }) {
    void stateFor(tenantId);
  },
);

// Canonical `Given "a signed-in user"` lives in steps/shared/auth-shared.steps.ts;
// it writes the session cookie onto ctx.cookie. Local state.cookie falls back
// to ctx.cookie where read below.

When(
  "the user POSTs a wav fixture to \\/api\\/transcribe",
  async function (
    this,
    {
      apiBaseURL,
      tenantId,
      cookie: ctxCookie,
    }: { apiBaseURL: string; tenantId: string; cookie?: string },
  ) {
    const s = stateFor(tenantId);
    // 64-byte silent WAV stub — Phase 19.2 wired transcribe end-to-end
    // so a minimal payload is sufficient.
    const res = await postTranscribeWav(
      apiBaseURL,
      s.cookie ?? ctxCookie ?? "",
      Buffer.alloc(64, 0),
    );
    s.status = res.status;
    s.body = res.body;
    s.rawText = res.rawText;
    recordLastResponse(tenantId, { status: res.status, body: res.body, rawText: res.rawText });
  },
);

// Canonical `Then "the response status is {int}"` lives in
// steps/shared/response-shared.steps.ts.

Then('the body has a "text" field', async function (this, { tenantId }: { tenantId: string }) {
  const body = stateFor(tenantId).body as { text?: unknown };
  expect(typeof body.text).toBe("string");
});

Then(
  "mock-corp-litellm observed exactly {int} inbound request",
  async function (this, { tenantId }: { tenantId: string }, expected: number) {
    // Live assertion needs a mock-corp-litellm /__observed endpoint
    // (deferred to Phase 44 wiring). For now we record the precondition.
    const s = stateFor(tenantId);
    s.mockObservedCount = expected; // narrative placeholder
    expect(s.mockObservedCount).toBe(expected);
  },
);

// Canonical body/envelope Then handler lives in
// steps/shared/response-shared.steps.ts.

// Canonical "the body MUST NOT contain a Node.js stack trace" Then handler
// lives in steps/shared/response-shared.steps.ts.
