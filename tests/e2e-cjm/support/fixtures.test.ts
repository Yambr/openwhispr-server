// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-06 — vitest unit coverage for the provisionVerifiedTenant
// support helper, per memory `feedback_cjm_steps_need_unit_tests`. The HTTP
// boundary (undici global fetch) + the Mailpit poll are mocked; we assert the
// real signup → verify-link → sign-in call SEQUENCE and the error branches,
// catching URL/payload/parse drift at sub-second speed without a live stack.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The helper issues HTTP via undici's `fetch` (not the global), so mock the
// undici module. `Agent` must remain a real constructor (the localhost
// dispatcher news it up). The mock fetch is reconfigured per test. Declared via
// vi.hoisted so it's initialized before the hoisted vi.mock factory runs.
const { undiciFetchMock } = vi.hoisted(() => ({ undiciFetchMock: vi.fn() }));
vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof import("undici")>("undici");
  return { ...actual, fetch: undiciFetchMock };
});

// Mock the Mailpit helper so no real poll happens; the verify URL is injected
// via the returned message body.
vi.mock("./mailpit-helper.js", () => ({
  DEFAULT_MAILPIT_API_URL: "https://mailpit.localhost/api/v1",
  waitForEmail: vi.fn(),
}));

import { freshTenant, provisionVerifiedTenant } from "./fixtures.js";
import { waitForEmail } from "./mailpit-helper.js";

const API = "https://api.localhost";
const MAILPIT = "https://mailpit.localhost/api/v1";

interface Call {
  url: string;
  method: string;
  body?: string;
}

/** Configure the undici fetch mock to reply per a url→Response handler. */
function stubFetch(handler: (url: string, method: string) => Response): { calls: Call[] } {
  const calls: Call[] = [];
  undiciFetchMock.mockImplementation(
    async (url: string | URL, init?: { method?: string; body?: unknown }) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      calls.push({ url: u, method, body: init?.body as string | undefined });
      return handler(u, method);
    },
  );
  return { calls };
}

function res(status: number, headers?: Record<string, string>): Response {
  return new Response(status === 200 ? "{}" : "", { status, headers });
}

/** A 200 sign-in response carrying a Set-Cookie. */
function signinOk(): Response {
  return new Response("{}", {
    status: 200,
    headers: { "set-cookie": "better-auth.session_token=abc123; Path=/; HttpOnly" },
  });
}

describe("provisionVerifiedTenant (Phase 69 / Plan 69-06)", () => {
  beforeEach(() => {
    undiciFetchMock.mockReset();
    vi.mocked(waitForEmail).mockReset();
  });

  it("runs signup → verify-link → signin and returns the session cookie", async () => {
    const id = freshTenant();
    vi.mocked(waitForEmail).mockResolvedValue({
      ID: "m1",
      From: { Address: "no-reply@local.test" },
      To: [{ Address: id.email }],
      Subject: "Verify your email",
      HTML: `<a href="${API}/api/auth/verify-email?token=TKN123&callbackURL=/">verify</a>`,
      Text: "",
      Created: new Date().toISOString(),
    } as unknown as Awaited<ReturnType<typeof waitForEmail>>);

    const { calls } = stubFetch((url) => {
      if (url.includes("/api/auth/sign-up/email")) return res(200);
      if (url.includes("/api/auth/verify-email")) return res(302, { location: "/" });
      if (url.includes("/api/auth/sign-in/email")) return signinOk();
      throw new Error(`unexpected fetch ${url}`);
    });

    const cookie = await provisionVerifiedTenant(API, MAILPIT, id);

    expect(cookie).toBe("better-auth.session_token=abc123");
    // Sequence: signup, then verify-link GET, then signin.
    const seq = calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);
    expect(seq).toEqual([
      "POST /api/auth/sign-up/email",
      "GET /api/auth/verify-email",
      "POST /api/auth/sign-in/email",
    ]);
    // waitForEmail was scoped to this tenant's email + the Verify subject.
    expect(vi.mocked(waitForEmail)).toHaveBeenCalledWith(
      id.email,
      expect.objectContaining({ subjectContains: "Verify", baseUrl: MAILPIT }),
    );
  });

  it("skips the verify step when signup returns 422 (already-registered) and still signs in", async () => {
    const id = freshTenant();
    const { calls } = stubFetch((url) => {
      if (url.includes("/api/auth/sign-up/email")) return res(422);
      if (url.includes("/api/auth/sign-in/email")) return signinOk();
      throw new Error(`unexpected fetch ${url}`);
    });

    const cookie = await provisionVerifiedTenant(API, MAILPIT, id);
    expect(cookie).toBe("better-auth.session_token=abc123");
    expect(vi.mocked(waitForEmail)).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.includes("/verify-email"))).toBe(false);
  });

  it("throws when sign-up fails with a non-200/422 status", async () => {
    const id = freshTenant();
    stubFetch((url) => {
      if (url.includes("/api/auth/sign-up/email")) return res(500);
      throw new Error(`unexpected fetch ${url}`);
    });
    await expect(provisionVerifiedTenant(API, MAILPIT, id)).rejects.toThrow(/sign-up.*→ 500/);
  });

  it("throws when the verification email carries no verify URL", async () => {
    const id = freshTenant();
    vi.mocked(waitForEmail).mockResolvedValue({
      ID: "m2",
      To: [{ Address: id.email }],
      Subject: "Verify your email",
      HTML: "<p>no link here</p>",
      Text: "",
      Created: new Date().toISOString(),
    } as unknown as Awaited<ReturnType<typeof waitForEmail>>);
    stubFetch((url) => {
      if (url.includes("/api/auth/sign-up/email")) return res(200);
      throw new Error(`unexpected fetch ${url}`);
    });
    await expect(provisionVerifiedTenant(API, MAILPIT, id)).rejects.toThrow(/no verify URL/);
  });

  it("throws when sign-in does not return 200 + a cookie", async () => {
    const id = freshTenant();
    stubFetch((url) => {
      if (url.includes("/api/auth/sign-up/email")) return res(422);
      if (url.includes("/api/auth/sign-in/email")) return res(400);
      throw new Error(`unexpected fetch ${url}`);
    });
    await expect(provisionVerifiedTenant(API, MAILPIT, id)).rejects.toThrow(/sign-in.*→ 400/);
  });
});
