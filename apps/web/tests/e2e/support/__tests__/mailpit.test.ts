// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 54 / Plan 54-01 RED — unit coverage for the mailpit Playwright
// support helper (apps/web/tests/e2e/support/mailpit.ts).
//
// The helper is the single source of truth for pulling verify-email and
// password-reset links out of mailpit during long-form e2e flows. It
// replaces the inline `fetchVerificationLink` in
// 100-fullflow-signup-verify-signin.spec.ts (lines 33-74) and the
// undici-flavoured `fetchVerificationUrl` in
// tests/e2e-cjm/steps/signin.steps.ts (lines 61-94).
//
// HTTP boundary is mocked via `vi.stubGlobal("fetch", ...)`. NO live
// mailpit dependency for these unit tests — they run on every PR via the
// standard apps/web vitest suite.
//
// CLAUDE.md feedback_cjm_steps_need_unit_tests applies: every e2e
// support helper MUST have vitest unit coverage with the HTTP boundary
// mocked. Coverage waivers banned.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearMessages,
  fetchPasswordResetLink,
  fetchVerificationLink,
  MAILPIT_BASE,
} from "../mailpit";

interface MessagesListBody {
  messages: Array<{ ID: string; Created: string }>;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function listBody(messages: MessagesListBody["messages"]): MessagesListBody {
  return { messages };
}

const TEST_EMAIL = "alice+54-01@test.local";
const NOW_ISO = "2026-05-19T08:00:00.000Z";
const SINCE = new Date(NOW_ISO);

describe("apps/web/tests/e2e/support/mailpit", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("MAILPIT_BASE exposes the canonical default base URL", () => {
    // The helper resolves process.env.MAILPIT_API_URL ?? "http://localhost:8025/api/v1"
    // at import time. vitest tests inherit the test runner's env, which
    // does not set MAILPIT_API_URL, so we expect the default.
    expect(MAILPIT_BASE).toBe("http://localhost:8025/api/v1");
  });

  it("fetchVerificationLink returns the URL when body contains /api/auth/verify-email", async () => {
    const link = `http://localhost:4000/api/auth/verify-email?token=abc.def-123`;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(listBody([{ ID: "msg-1", Created: NOW_ISO }])))
      .mockResolvedValueOnce(jsonResponse({ HTML: `<a href="${link}">Verify</a>`, Text: "" }));

    const got = await fetchVerificationLink(TEST_EMAIL, {
      since: SINCE,
      timeoutMs: 1_000,
      pollIntervalMs: 10,
    });

    expect(got).toBe(link);
    // First call: list with to:email query
    const firstCall = fetchMock.mock.calls[0]?.[0] as string;
    expect(firstCall).toContain(`${MAILPIT_BASE}/messages?query=`);
    expect(firstCall).toContain(encodeURIComponent(`to:${TEST_EMAIL}`));
    // Second call: full message fetch by ID
    const secondCall = fetchMock.mock.calls[1]?.[0] as string;
    expect(secondCall).toBe(`${MAILPIT_BASE}/message/msg-1`);
  });

  it("fetchVerificationLink returns the URL for the /verify-email web-page variant", async () => {
    const link = "http://localhost:3000/verify-email?token=xyz-987";
    fetchMock
      .mockResolvedValueOnce(jsonResponse(listBody([{ ID: "msg-2", Created: NOW_ISO }])))
      .mockResolvedValueOnce(jsonResponse({ HTML: "", Text: `Click here: ${link}` }));

    const got = await fetchVerificationLink(TEST_EMAIL, {
      since: SINCE,
      timeoutMs: 1_000,
      pollIntervalMs: 10,
    });

    expect(got).toBe(link);
  });

  it("fetchVerificationLink THROWS after timeoutMs when mailpit returns empty list", async () => {
    fetchMock.mockResolvedValue(jsonResponse(listBody([])));

    await expect(
      fetchVerificationLink(TEST_EMAIL, {
        since: SINCE,
        timeoutMs: 50,
        pollIntervalMs: 10,
      }),
    ).rejects.toThrow(/verification email/i);
  });

  it("fetchVerificationLink skips messages older than (since - 1s)", async () => {
    const olderCreated = new Date(SINCE.getTime() - 60_000).toISOString();
    const freshCreated = new Date(SINCE.getTime() + 5_000).toISOString();
    const link = "http://localhost:4000/api/auth/verify-email?token=fresh-only";

    fetchMock
      // First poll: only old message → no candidate → loop
      .mockResolvedValueOnce(jsonResponse(listBody([{ ID: "msg-old", Created: olderCreated }])))
      // Second poll: fresh message present
      .mockResolvedValueOnce(
        jsonResponse(
          listBody([
            { ID: "msg-old", Created: olderCreated },
            { ID: "msg-fresh", Created: freshCreated },
          ]),
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ HTML: `<a href="${link}">go</a>`, Text: "" }));

    const got = await fetchVerificationLink(TEST_EMAIL, {
      since: SINCE,
      timeoutMs: 1_000,
      pollIntervalMs: 10,
    });

    expect(got).toBe(link);
    // The full-message fetch must target the FRESH message, never the old one
    const fullFetchCalls = fetchMock.mock.calls
      .map((c) => c[0] as string)
      .filter((u) => u.startsWith(`${MAILPIT_BASE}/message/`));
    expect(fullFetchCalls).toEqual([`${MAILPIT_BASE}/message/msg-fresh`]);
  });

  it("fetchPasswordResetLink matches /reset-password?token=... in the HTML body", async () => {
    const link = "http://localhost:3000/reset-password?token=reset-html-1";
    fetchMock
      .mockResolvedValueOnce(jsonResponse(listBody([{ ID: "msg-r1", Created: NOW_ISO }])))
      .mockResolvedValueOnce(
        jsonResponse({ HTML: `<p><a href="${link}">reset</a></p>`, Text: "" }),
      );

    const got = await fetchPasswordResetLink(TEST_EMAIL, {
      since: SINCE,
      timeoutMs: 1_000,
      pollIntervalMs: 10,
    });
    expect(got).toBe(link);
  });

  it("fetchPasswordResetLink matches /reset-password?token=... in the Text body when HTML is missing", async () => {
    const link = "http://localhost:3000/reset-password?token=reset-text-1";
    fetchMock
      .mockResolvedValueOnce(jsonResponse(listBody([{ ID: "msg-r2", Created: NOW_ISO }])))
      .mockResolvedValueOnce(jsonResponse({ Text: `Reset link: ${link}` }));

    const got = await fetchPasswordResetLink(TEST_EMAIL, {
      since: SINCE,
      timeoutMs: 1_000,
      pollIntervalMs: 10,
    });
    expect(got).toBe(link);
  });

  it("clearMessages issues DELETE ${MAILPIT_BASE}/messages and resolves even on 500", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));

    await expect(clearMessages()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MAILPIT_BASE}/messages`);
    expect(init?.method).toBe("DELETE");
  });

  it("clearMessages resolves silently on fetch rejection (network down)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("ECONNREFUSED"));

    await expect(clearMessages()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
