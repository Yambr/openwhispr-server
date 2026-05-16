// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 26 / Plan 26-01 — @cjm-13.* web-search CJM steps (G6 closure).
//
// Memory feedback_loadtest_cost_discipline: this file MUST NOT call any
// live Tavily/Yandex endpoint. The "WEB_SEARCH_PROVIDER is configured
// to mock" precondition is a no-op from the test side — the compose
// stack boots with WEB_SEARCH_PROVIDER=mock already (operator wiring
// out of scope for the CJM layer). For the negative twin we cannot
// reconfigure the api at test time; the scenario instead documents the
// expected response shape, and the gherkin step records the precondition
// as a no-op (live wiring asserted in the integration test layer).

import { Agent, fetch as undiciFetch } from "undici";

import { expect, freshTenant, Given, signedInAs, Then, When } from "../support/fixtures";

interface ScenarioState {
  cookie?: string;
  providerConfig?: string;
  status?: number;
  body?: unknown;
  rawText?: string;
}

const state = new Map<string, ScenarioState>();

function stateFor(scenarioTenantId: string): ScenarioState {
  let s = state.get(scenarioTenantId);
  if (!s) {
    s = {};
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

export async function postWebSearch(
  apiBaseURL: string,
  cookie: string,
  body: { query: string; numResults?: number },
): Promise<{ status: number; body: unknown; rawText: string }> {
  const url = `${apiBaseURL}/api/agent/web-search`;
  const dispatcher = localhostDispatcher(url);
  const res = await undiciFetch(url, {
    method: "POST",
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

Given("a signed-in user", async function (this, ctx) {
  const { apiBaseURL, mailpitApiUrl, tenantId } = ctx as {
    apiBaseURL: string;
    mailpitApiUrl: string;
    tenantId: string;
  };
  const s = stateFor(tenantId);
  const id = freshTenant(tenantId);
  s.cookie = await signedInAs(apiBaseURL, mailpitApiUrl, id);
});

Given(
  "WEB_SEARCH_PROVIDER is configured to {string}",
  async function (this, ctx, provider: string) {
    // Precondition is set by the operator at compose-up time; we record it
    // here for narrative clarity. The live test stack MUST boot with
    // WEB_SEARCH_PROVIDER=mock per Phase 5 wiring; @cjm-13.2 is tagged
    // `@expected-red @after-phase-26.next` until a compose overlay flips
    // the provider per-scenario (deferred to a follow-up phase).
    const { tenantId } = ctx as { tenantId: string };
    stateFor(tenantId).providerConfig = provider;
  },
);

Given(
  "WEB_SEARCH_PROVIDER is configured to {string} without TAVILY_API_KEY",
  async function (this, ctx, provider: string) {
    const { tenantId } = ctx as { tenantId: string };
    stateFor(tenantId).providerConfig = `${provider}-no-key`;
  },
);

When(
  "the user POSTs to /api/agent/web-search with query {string} and numResults {int}",
  async function (this, ctx, query: string, numResults: number) {
    const { apiBaseURL, tenantId } = ctx as { apiBaseURL: string; tenantId: string };
    const s = stateFor(tenantId);
    const res = await postWebSearch(apiBaseURL, s.cookie ?? "", { query, numResults });
    s.status = res.status;
    s.body = res.body;
    s.rawText = res.rawText;
  },
);

Then("the response status is {int}", async function (this, ctx, expected: number) {
  const { tenantId } = ctx as { tenantId: string };
  expect(stateFor(tenantId).status).toBe(expected);
});

Then(
  "the body contains a results array with at least {int} item",
  async function (this, ctx, n: number) {
    const { tenantId } = ctx as { tenantId: string };
    const body = stateFor(tenantId).body as { results?: unknown[] };
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results!.length).toBeGreaterThanOrEqual(n);
  },
);

Then(
  "every result item has the three string fields title, url, snippet",
  async function (this, ctx) {
    const { tenantId } = ctx as { tenantId: string };
    const body = stateFor(tenantId).body as {
      results: Array<{ title: unknown; url: unknown; snippet: unknown }>;
    };
    for (const item of body.results) {
      expect(typeof item.title).toBe("string");
      expect(typeof item.url).toBe("string");
      expect(typeof item.snippet).toBe("string");
    }
  },
);

Then(
  'the body is the typed envelope shape "{ error: { code, message } }"',
  async function (this, ctx) {
    const { tenantId } = ctx as { tenantId: string };
    const body = stateFor(tenantId).body;
    expect(body).toMatchObject({
      error: expect.objectContaining({
        code: expect.any(String),
        message: expect.any(String),
      }),
    });
  },
);

Then("the error code is {string}", async function (this, ctx, code: string) {
  const { tenantId } = ctx as { tenantId: string };
  const body = stateFor(tenantId).body as { error?: { code?: string } };
  expect(body.error?.code).toBe(code);
});

Then("the body MUST NOT contain a Node.js stack trace", async function (this, ctx) {
  const { tenantId } = ctx as { tenantId: string };
  expect(stateFor(tenantId).rawText ?? "").not.toMatch(/at Object\.<anonymous>|node_modules\//);
});
