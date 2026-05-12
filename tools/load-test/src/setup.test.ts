// Phase 08 / Plan 02 — Task 2 RED: provisionUsers() user provisioner.
//
// `provisionUsers()` is the pure, vitest-testable core of the k6 setup()
// hook. It pre-creates N test users via Better Auth's
// /api/auth/sign-up/email endpoint so the load test can run with a stable
// VU-to-user mapping (avoids sign-up storms inside the steady-state).
//
// Per CLAUDE.md "no mocks of internal logic" — only the HTTP boundary is
// mocked, via the injectable httpClient. Everything else is real.
import { describe, expect, it, vi } from "vitest";

import { provisionUsers } from "./setup.js";

interface FakeResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

function ok(token: string, viaHeader = false): FakeResponse {
  return {
    status: 200,
    body: viaHeader ? {} : { token },
    headers: viaHeader ? { "set-auth-token": token } : {},
  };
}

describe("provisionUsers", () => {
  it("returns N users when sign-up returns 200 with a token body", () => {
    const httpClient = vi.fn((_url: string, _body: unknown) => ok("t0"));
    let i = 0;
    httpClient.mockImplementation(() => ok(`t${i++}`));

    const users = provisionUsers({
      backend: "https://api.localhost",
      count: 3,
      httpClient,
      sleep: () => undefined,
    });

    expect(users).toHaveLength(3);
    expect(users.map((u) => u.token)).toEqual(["t0", "t1", "t2"]);
    expect(users[0]?.email).toMatch(/@/);
    expect(httpClient).toHaveBeenCalledTimes(3);
  });

  it("falls back to Set-Auth-Token header when body has no token", () => {
    const httpClient = vi.fn(() => ok("hdr-token", true));
    const users = provisionUsers({
      backend: "https://api.localhost",
      count: 1,
      httpClient,
      sleep: () => undefined,
    });
    expect(users[0]?.token).toBe("hdr-token");
  });

  it("throws with the offending user index when sign-up returns non-200", () => {
    const httpClient = vi.fn((_url: string, _body: unknown): FakeResponse => {
      return { status: 500, body: {}, headers: {} };
    });
    expect(() =>
      provisionUsers({
        backend: "https://api.localhost",
        count: 2,
        httpClient,
        sleep: () => undefined,
      }),
    ).toThrowError(/user 0/);
  });

  it("generates fresh emails across separate invocations (uniqueness suffix)", () => {
    const httpClient = vi.fn(() => ok("t"));
    const a = provisionUsers({
      backend: "https://api.localhost",
      count: 2,
      httpClient,
      sleep: () => undefined,
    });
    // Small delay to bump the timestamp suffix; tests do not actually
    // wait — we just call again and assert emails differ.
    const b = provisionUsers({
      backend: "https://api.localhost",
      count: 2,
      httpClient,
      sleep: () => undefined,
    });
    expect(a.map((u) => u.email)).not.toEqual(b.map((u) => u.email));
  });

  it("paces sign-ups with a configurable sleep (default 50ms)", () => {
    const httpClient = vi.fn(() => ok("t"));
    const sleep = vi.fn();
    provisionUsers({
      backend: "https://api.localhost",
      count: 3,
      httpClient,
      sleep,
    });
    // 3 sign-ups -> sleep called once between each + once after the last
    // = 3 invocations. Each with the default 50ms.
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(50);
  });

  it("respects a custom paceMs value", () => {
    const httpClient = vi.fn(() => ok("t"));
    const sleep = vi.fn();
    provisionUsers({
      backend: "https://api.localhost",
      count: 1,
      httpClient,
      sleep,
      paceMs: 0,
    });
    expect(sleep).toHaveBeenCalledWith(0);
  });
});
