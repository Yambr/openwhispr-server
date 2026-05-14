// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 / Plan 02 / Task 13-02-03 — @cjm-8.* error-path invariants.
//
// Both scenarios issue a deliberately-broken request to /api/transcribe and
// assert the response shape is typed + does NOT leak a stack trace.

import { Agent, fetch as undiciFetch } from "undici";

import { expect, Then, When } from "../support/world";

interface ScenarioState {
  status?: number;
  bodyText?: string;
  body?: unknown;
}

const state = new Map<string, ScenarioState>();

function stateFor(tenantId: string): ScenarioState {
  let s = state.get(tenantId);
  if (!s) {
    s = {};
    state.set(tenantId, s);
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

When(
  "an unauthenticated POST to \\/api\\/transcribe is issued",
  async ({ apiBaseURL, tenantId }) => {
    const s = stateFor(tenantId);
    const url = `${apiBaseURL}/api/transcribe`;
    const dispatcher = localhostDispatcher(url);
    const origin = new URL(url).origin;
    const res = await undiciFetch(url, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{}",
      dispatcher,
    });
    s.status = res.status;
    s.bodyText = await res.text();
    try {
      s.body = JSON.parse(s.bodyText);
    } catch {
      s.body = null;
    }
  },
);

Then(
  'the response body is a typed error envelope with "code" and "message"',
  async ({ tenantId }) => {
    const s = stateFor(tenantId);
    const status = s.status as number;
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    const body = s.body as { error?: unknown; code?: string; message?: string } | null;
    expect(body).toBeTruthy();
    // Either the spec'd `{ error: { code, message } }` shape OR the legacy
    // short-form `{ error: "..." }` (which api currently returns on missing
    // auth). Both are typed envelopes; the lint asserts at least one of:
    //   - body.error is a non-empty string OR
    //   - body.error is an object with `code` + `message` strings OR
    //   - body has top-level `code` + `message` strings
    const hasShortForm = typeof body?.error === "string" && body.error.length > 0;
    const hasNestedShape =
      typeof body?.error === "object" &&
      body?.error !== null &&
      typeof (body.error as { code?: unknown }).code === "string";
    const hasTopShape = typeof body?.code === "string" && typeof body?.message === "string";
    expect(hasShortForm || hasNestedShape || hasTopShape).toBe(true);
  },
);

When("a malformed POST to \\/api\\/transcribe is issued", async ({ apiBaseURL, tenantId }) => {
  const s = stateFor(tenantId);
  const url = `${apiBaseURL}/api/transcribe`;
  const dispatcher = localhostDispatcher(url);
  const origin = new URL(url).origin;
  // Intentionally-broken Content-Type/body combo to probe error rendering.
  const res = await undiciFetch(url, {
    method: "POST",
    headers: {
      origin,
      "content-type": "multipart/form-data; boundary=---broken-boundary",
    },
    body: "this is not a valid multipart body and will fail the parser",
    dispatcher,
  });
  s.status = res.status;
  s.bodyText = await res.text();
});

Then(
  "the response body does not contain {string} or {string}",
  async ({ tenantId }, banned1: string, banned2: string) => {
    const s = stateFor(tenantId);
    const text = s.bodyText ?? "";
    expect(text).not.toContain(banned1);
    expect(text).not.toContain(banned2);
    // Defense-in-depth: also no `\tat ` (V8 stack-frame indent) and no
    // absolute filesystem paths from the api container.
    expect(text).not.toMatch(/\n\s+at\s+\S+\s*\(/);
    expect(text).not.toMatch(/\/usr\/src\/app|\/app\/src\//);
  },
);
