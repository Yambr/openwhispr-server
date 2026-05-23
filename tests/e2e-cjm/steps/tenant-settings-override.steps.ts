// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 42 / Plan 42-01 — @cjm-9.* per-tenant STT override steps.
// Both scenarios are @expected-red @after-phase-WIRE-11-PUT until the
// PUT route is added; step bodies model the expected call shape so
// only the gate flips when the route lands.

import { Agent, fetch as undiciFetch } from "undici";

import { expect, freshTenant, Given, signedInAs, Then, When } from "../support/fixtures";
import { recordLastResponse } from "./shared/response-shared.steps";

interface ScenarioState {
  cookie?: string;
  status?: number;
  body?: unknown;
  rawText?: string;
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

export async function putSttConfig(
  apiBaseURL: string,
  cookie: string,
  body: { model: string },
): Promise<{ status: number; body: unknown; rawText: string }> {
  const url = `${apiBaseURL}/api/stt-config`;
  const dispatcher = localhostDispatcher(url);
  const res = await undiciFetch(url, {
    method: "PUT",
    headers: {
      origin: new URL(url).origin,
      cookie,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
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

export async function getSttConfig(
  apiBaseURL: string,
  cookie: string,
): Promise<{ status: number; body: { model?: string } }> {
  const url = `${apiBaseURL}/api/stt-config`;
  const dispatcher = localhostDispatcher(url);
  const res = await undiciFetch(url, {
    method: "GET",
    headers: { origin: new URL(url).origin, cookie },
    ...(dispatcher ? { dispatcher } : {}),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { model?: string } };
}

Given(
  "a signed-in admin",
  async function (
    this,
    {
      apiBaseURL,
      mailpitApiUrl,
      tenantId,
    }: { apiBaseURL: string; mailpitApiUrl: string; tenantId: string },
  ) {
    const s = stateFor(tenantId);
    s.cookie = await signedInAs(apiBaseURL, mailpitApiUrl, freshTenant(tenantId));
  },
);

When(
  "the admin PUTs \\/api\\/stt-config with model {string}",
  async function (
    this,
    { apiBaseURL, tenantId }: { apiBaseURL: string; tenantId: string },
    model: string,
  ) {
    const s = stateFor(tenantId);
    const res = await putSttConfig(apiBaseURL, s.cookie ?? "", { model });
    s.status = res.status;
    s.body = res.body;
    s.rawText = res.rawText;
    recordLastResponse(tenantId, { status: res.status, body: res.body, rawText: res.rawText });
  },
);

// Canonical `Then "the response status is {int}"` lives in
// steps/shared/response-shared.steps.ts; it reads the per-tenant snapshot
// the When handler above mirror-writes via recordLastResponse().

Then(
  "subsequent GET \\/api\\/stt-config returns model {string}",
  async function (
    this,
    { apiBaseURL, tenantId }: { apiBaseURL: string; tenantId: string },
    expected: string,
  ) {
    const s = stateFor(tenantId);
    const res = await getSttConfig(apiBaseURL, s.cookie ?? "");
    expect(res.body.model).toBe(expected);
  },
);

// Canonical body/envelope/error-code Then handlers live in
// steps/shared/response-shared.steps.ts.
