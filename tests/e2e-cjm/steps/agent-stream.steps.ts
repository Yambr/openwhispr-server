// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 25 / Plan 25-01 — @cjm-12.* agent-stream NDJSON wire-shape steps.
//
// Closes G5 from `.planning/qa-audit/2026-05-16-cjm-coverage.md`. Asserts
// the end-to-end NDJSON contract on /api/agent/stream (Phase 4 / D-02 /
// sse-parser.ts) against the bundled mock-litellm SSE upstream.
//
// Per `feedback_cjm_steps_need_unit_tests`: sibling vitest unit coverage
// lives at `__tests__/agent-stream.steps.test.ts`.

import { Agent, fetch as undiciFetch } from "undici";

import { expect, Then, When } from "../support/fixtures";
import { recordLastResponse } from "./shared/response-shared.steps";

interface ScenarioState {
  cookie?: string;
  status?: number;
  contentType?: string;
  rawBody?: string;
  lines?: string[];
  parsedTypes?: string[];
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

/**
 * Issue POST /api/agent/stream and slurp the whole NDJSON body. The
 * stream is short enough in the mock-litellm fixture that buffering is
 * fine; full streaming-assertion lives in the unit test layer.
 */
export async function postAgentStream(
  apiBaseURL: string,
  cookie: string | undefined,
  prompt: string,
): Promise<{ status: number; contentType: string; rawBody: string }> {
  const url = `${apiBaseURL}/api/agent/stream`;
  const dispatcher = localhostDispatcher(url);
  const headers: Record<string, string> = {
    origin: new URL(url).origin,
    "content-type": "application/json",
  };
  if (cookie) headers.cookie = cookie;
  const res = await undiciFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt }),
    ...(dispatcher ? { dispatcher } : {}),
  });
  const rawBody = await res.text();
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    rawBody,
  };
}

/** Parse an NDJSON body into the array of typed chunks. Throws on a
 *  line that is not a valid JSON object with a `type` field. */
export function parseNdjson(body: string): Array<{ type: string; [k: string]: unknown }> {
  const out: Array<{ type: string; [k: string]: unknown }> = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const obj = JSON.parse(line) as { type?: unknown };
    if (typeof obj.type !== "string") {
      throw new Error(`NDJSON line missing "type" field: ${line}`);
    }
    out.push(obj as { type: string });
  }
  return out;
}

// Canonical `Given "a signed-in user"` lives in steps/shared/auth-shared.steps.ts;
// it writes the session cookie onto ctx.cookie. Local state.cookie falls back
// to ctx.cookie where read below.

When(
  "the user POSTs to \\/api\\/agent\\/stream with prompt {string}",
  async function (
    this,
    {
      apiBaseURL,
      tenantId,
      cookie: ctxCookie,
    }: { apiBaseURL: string; tenantId: string; cookie?: string },
    prompt: string,
  ) {
    const s = stateFor(tenantId);
    const res = await postAgentStream(apiBaseURL, s.cookie ?? ctxCookie, prompt);
    s.status = res.status;
    s.contentType = res.contentType;
    s.rawBody = res.rawBody;
    recordLastResponse(tenantId, { status: res.status, rawText: res.rawBody });
  },
);

When(
  "an unauthenticated POST to \\/api\\/agent\\/stream is issued",
  async function (this, { apiBaseURL, tenantId }: { apiBaseURL: string; tenantId: string }) {
    const s = stateFor(tenantId);
    const res = await postAgentStream(apiBaseURL, undefined, "ignored");
    s.status = res.status;
    s.contentType = res.contentType;
    s.rawBody = res.rawBody;
    recordLastResponse(tenantId, { status: res.status, rawText: res.rawBody });
  },
);

Then(
  "the response Content-Type is {string}",
  async function (this, { tenantId }: { tenantId: string }, expected: string) {
    const s = stateFor(tenantId);
    expect(s.contentType ?? "").toContain(expected);
  },
);

Then(
  "the response Content-Type is NOT {string}",
  async function (this, { tenantId }: { tenantId: string }, notExpected: string) {
    const s = stateFor(tenantId);
    expect(s.contentType ?? "").not.toContain(notExpected);
  },
);

Then(
  'every response line is a valid JSON object with a "type" field',
  async function (this, { tenantId }: { tenantId: string }) {
    const s = stateFor(tenantId);
    const parsed = parseNdjson(s.rawBody ?? "");
    s.parsedTypes = parsed.map((p) => p.type);
    expect(parsed.length).toBeGreaterThan(0);
  },
);

Then(
  "the stream contains at least one event of type {string}",
  async function (this, { tenantId }: { tenantId: string }, eventType: string) {
    const s = stateFor(tenantId);
    const types = s.parsedTypes ?? parseNdjson(s.rawBody ?? "").map((p) => p.type);
    expect(types).toContain(eventType);
  },
);

Then(
  "the stream ends with an event of type {string}",
  async function (this, { tenantId }: { tenantId: string }, finalType: string) {
    const s = stateFor(tenantId);
    const types = s.parsedTypes ?? parseNdjson(s.rawBody ?? "").map((p) => p.type);
    expect(types[types.length - 1]).toBe(finalType);
  },
);

// Canonical `Then "the response status is {int}"` lives in
// steps/shared/response-shared.steps.ts.

// Canonical body/envelope Then handler lives in
// steps/shared/response-shared.steps.ts (it parses rawText fallback when
// the per-feature handler only mirror-wrote rawText, as we do here).

// Canonical "the body MUST NOT contain a Node.js stack trace" Then handler
// lives in steps/shared/response-shared.steps.ts.
