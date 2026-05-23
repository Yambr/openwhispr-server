// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 30 / Plan 30-01 — @cjm-byok-rotation.* api key rotation steps (G1).

import { randomUUID } from "node:crypto";
import { Agent, fetch as undiciFetch } from "undici";

import { expect, Then, When } from "../support/fixtures";
import { recordLastResponse } from "./shared/response-shared.steps";

interface KeyRecord {
  id: string;
  name: string;
  revoked_at: string | null;
}

interface ScenarioState {
  cookie?: string;
  oldKeyId?: string;
  newKeyId?: string;
  revokeStatus?: number;
  list?: KeyRecord[];
  lastStatus?: number;
  lastBody?: unknown;
  lastRawText?: string;
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

export async function createKey(
  apiBaseURL: string,
  cookie: string,
  name: string,
): Promise<{ status: number; body: unknown }> {
  const url = `${apiBaseURL}/api/v1/keys/create`;
  const dispatcher = localhostDispatcher(url);
  const res = await undiciFetch(url, {
    method: "POST",
    headers: {
      origin: new URL(url).origin,
      cookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name }),
    ...(dispatcher ? { dispatcher } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export async function listKeys(
  apiBaseURL: string,
  cookie: string,
): Promise<{ status: number; body: { data?: KeyRecord[] } }> {
  const url = `${apiBaseURL}/api/v1/keys/list`;
  const dispatcher = localhostDispatcher(url);
  const res = await undiciFetch(url, {
    method: "GET",
    headers: { origin: new URL(url).origin, cookie },
    ...(dispatcher ? { dispatcher } : {}),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as { data?: KeyRecord[] },
  };
}

export async function revokeKey(
  apiBaseURL: string,
  cookie: string,
  id: string,
): Promise<{ status: number; body: unknown; rawText: string }> {
  const url = `${apiBaseURL}/api/v1/keys/${encodeURIComponent(id)}/revoke`;
  const dispatcher = localhostDispatcher(url);
  const res = await undiciFetch(url, {
    method: "POST",
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

function extractCreatedId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const d = (body as { data?: unknown }).data;
  if (typeof d !== "object" || d === null) return undefined;
  const id = (d as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

// Canonical `Given "a signed-in user"` lives in steps/shared/auth-shared.steps.ts;
// it writes the session cookie onto ctx.cookie. Local state.cookie reads
// fall back to ctx.cookie via cookieFor().
function cookieFor(ctxCookie: string | undefined, s: ScenarioState): string {
  if (s.cookie) return s.cookie;
  if (ctxCookie) s.cookie = ctxCookie;
  return s.cookie ?? "";
}

When(
  "the user creates an api key named {string}",
  async function (
    this,
    {
      apiBaseURL,
      tenantId,
      cookie: ctxCookie,
    }: { apiBaseURL: string; tenantId: string; cookie?: string },
    name: string,
  ) {
    const s = stateFor(tenantId);
    const res = await createKey(apiBaseURL, cookieFor(ctxCookie, s), name);
    const id = extractCreatedId(res.body);
    if (!s.oldKeyId) s.oldKeyId = id;
    else s.newKeyId = id;
    s.lastStatus = res.status;
    s.lastBody = res.body;
    recordLastResponse(tenantId, { status: res.status, body: res.body });
  },
);

When(
  "the user creates a second api key named {string}",
  async function (
    this,
    {
      apiBaseURL,
      tenantId,
      cookie: ctxCookie,
    }: { apiBaseURL: string; tenantId: string; cookie?: string },
    name: string,
  ) {
    const s = stateFor(tenantId);
    const res = await createKey(apiBaseURL, cookieFor(ctxCookie, s), name);
    s.newKeyId = extractCreatedId(res.body);
    s.lastStatus = res.status;
    s.lastBody = res.body;
    recordLastResponse(tenantId, { status: res.status, body: res.body });
  },
);

When(
  "the user revokes the first key",
  async function (
    this,
    {
      apiBaseURL,
      tenantId,
      cookie: ctxCookie,
    }: { apiBaseURL: string; tenantId: string; cookie?: string },
  ) {
    const s = stateFor(tenantId);
    if (!s.oldKeyId) throw new Error("step ordering: first create did not return an id");
    const res = await revokeKey(apiBaseURL, cookieFor(ctxCookie, s), s.oldKeyId);
    s.revokeStatus = res.status;
    s.lastStatus = res.status;
    s.lastBody = res.body;
    s.lastRawText = res.rawText;
    recordLastResponse(tenantId, { status: res.status, body: res.body, rawText: res.rawText });
    const list = await listKeys(apiBaseURL, cookieFor(ctxCookie, s));
    s.list = list.body.data ?? [];
  },
);

When(
  "the user POSTs \\/api\\/v1\\/keys\\/:id\\/revoke with an unknown uuid",
  async function (
    this,
    {
      apiBaseURL,
      tenantId,
      cookie: ctxCookie,
    }: { apiBaseURL: string; tenantId: string; cookie?: string },
  ) {
    const s = stateFor(tenantId);
    const fakeId = randomUUID();
    const res = await revokeKey(apiBaseURL, cookieFor(ctxCookie, s), fakeId);
    s.lastStatus = res.status;
    s.lastBody = res.body;
    s.lastRawText = res.rawText;
    recordLastResponse(tenantId, { status: res.status, body: res.body, rawText: res.rawText });
  },
);

Then(
  "the response status for the revoke is {int}",
  async function (this, { tenantId }: { tenantId: string }, expected: number) {
    expect(stateFor(tenantId).revokeStatus).toBe(expected);
  },
);

// Canonical `Then "the response status is {int}"` lives in
// steps/shared/response-shared.steps.ts.

Then(
  "listing keys shows the new key with revoked_at null",
  async function (this, { tenantId }: { tenantId: string }) {
    const s = stateFor(tenantId);
    const newKey = (s.list ?? []).find((k) => k.id === s.newKeyId);
    expect(newKey).toBeDefined();
    expect(newKey?.revoked_at).toBeNull();
  },
);

Then(
  "listing keys shows the old key with revoked_at non-null",
  async function (this, { tenantId }: { tenantId: string }) {
    const s = stateFor(tenantId);
    const oldKey = (s.list ?? []).find((k) => k.id === s.oldKeyId);
    expect(oldKey).toBeDefined();
    expect(oldKey?.revoked_at).not.toBeNull();
  },
);

// Canonical body/envelope/error-code Then handlers live in
// steps/shared/response-shared.steps.ts.

// Canonical "the body MUST NOT contain a Node.js stack trace" Then handler
// lives in steps/shared/response-shared.steps.ts.
