// SPDX-License-Identifier: FSL-1.1-ALv2
// tests/e2e/r20-bearer-sync — R20 regression e2e (real compose stack).
//
// R20: a real signed-in user's Better Auth `session.token`, presented as
// `Authorization: Bearer <token>`, was rejected with 401 on every sync
// route — only the session cookie worked. The cloud product was
// non-functional for real users despite a green cookie-driven suite.
//
// This e2e closes the exact gap: it authenticates a fixture user, obtains
// `session.token` from `GET /api/auth/get-session`, then drives the sync
// routes with the BEARER ONLY (a fresh fetch with no cookie jar). It
// mirrors the shipped Electron client, which stores `session.token` in
// `tokenStore` and sends `Authorization: Bearer <session.token>` on every
// `cloudApiRequest`.
//
// Pre-fix this spec fails with 401 on step 2; post-fix it returns
// 200 / 201 because the encryption-lens `rewriteWhere` rewrite resolves a
// bare `{field:"token"}` clause via the `token_fp` fingerprint.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

const SessionResponse = z.object({
  session: z.object({ token: z.string().min(1) }),
  user: z.object({ email: z.string() }),
});

/**
 * Sign in a fixture user (cookie jar), then exchange the cookie for the
 * raw `session.token` via `GET /api/auth/get-session` — exactly the
 * client's `exchangeSignedTokenForRawBearer` flow (main.js:499-518).
 */
async function bearerForFixture(email: string): Promise<string> {
  const jar = await signInFixture(email);
  const res = await jar.fetch(`${BACKEND_URL}/api/auth/get-session`, { method: "GET" });
  if (!res.ok) {
    throw new Error(`get-session failed: HTTP ${res.status}`);
  }
  const parsed = SessionResponse.parse(await res.json());
  return parsed.session.token;
}

/** A bare fetch with NO cookie jar — only the Authorization header. */
function bearerFetch(token: string) {
  return (url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers ?? undefined);
    headers.set("authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers, redirect: "manual" });
  };
}

describe("e2e — R20: real-sign-in bearer is accepted on every sync route", () => {
  it("session.token as Bearer authenticates notes list + create (no cookie)", async () => {
    const token = await bearerForFixture("fixture@conformance.test");
    const call = bearerFetch(token);

    // 1. GET /api/notes/list with Bearer only → 200 (pre-fix: 401).
    const list = await call(`${BACKEND_URL}/api/notes/list`);
    expect(list.status).toBe(200);
    const listBody = z.object({ notes: z.array(z.unknown()) }).parse(await list.json());
    expect(Array.isArray(listBody.notes)).toBe(true);

    // 2. POST /api/notes/create with the same Bearer → 201.
    const clientNoteId = `e2e-r20-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const create = await call(`${BACKEND_URL}/api/notes/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_note_id: clientNoteId,
        title: "R20 bearer note",
        content: "created via Authorization: Bearer session.token",
        note_type: "note",
      }),
    });
    expect(create.status).toBe(201);
    const created = z.object({ id: z.string() }).parse(await create.json());
    expect(created.id.length).toBeGreaterThan(0);
  });

  it("the same bearer is accepted across the whole sync family + /api/usage", async () => {
    const token = await bearerForFixture("fixture@conformance.test");
    const call = bearerFetch(token);

    // Every documented authenticated sync family must accept the
    // real-sign-in bearer — not just notes. A 401 on ANY of these is the
    // R20 regression. (200 is the only acceptable status; the routes are
    // all GET-list shaped and return their entity envelope.)
    for (const path of [
      "/api/notes/list",
      "/api/folders/list",
      "/api/conversations/list",
      "/api/transcriptions/list",
      "/api/usage",
      "/api/v1/keys/list",
    ]) {
      const res = await call(`${BACKEND_URL}${path}`);
      expect(res.status, `${path} must accept the real-sign-in bearer`).toBe(200);
    }
  });

  it("an unknown bearer is still rejected with 401 (no auth bypass)", async () => {
    const call = bearerFetch("not-a-real-session-token-deadbeef");
    const res = await call(`${BACKEND_URL}/api/notes/list`);
    expect(res.status).toBe(401);
  });
});
