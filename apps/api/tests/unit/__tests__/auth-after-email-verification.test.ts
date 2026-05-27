// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick-task 260527-im6 / D3 — afterEmailVerification closure-wiring tests.
//
// Verifies the hybrid admin-claim email branch:
//   * U-E-1: when `completeSetupAdmin` is supplied, the hook delegates
//     to it with `{id, email, tenantId?}`.
//   * U-E-2: when omitted, the hook is a defensive no-op (preserves
//     backward-compat for legacy `buildAuth({db})` fakes in the api
//     suite).
//   * U-E-3: spy throw propagates -- BA surrounding catch turns it to
//     500 (we verify the throw is observed).
//   * U-E-4: defensive predicate fires when `user.emailVerified=false`
//     (spy NOT called).
//
// Mocks are scoped to a process-boundary surface (the `completeSetupAdmin`
// callable injected via BuildAuthOptions). Real Better Auth is constructed;
// only the closure under test is exercised directly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAuth } from "../../../src/auth.js";

const stubDb = {} as unknown as Parameters<typeof buildAuth>[0]["db"];
const ORIGINAL_SECRET = process.env.BETTER_AUTH_SECRET;

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET =
    "0000000000000000000000000000000000000000000000000000000000000000";
  delete process.env.OIDC_ISSUER_URL;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_CLIENT_SECRET;
});
afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = ORIGINAL_SECRET;
});

interface AuthOptionsRuntime {
  emailVerification?: {
    afterEmailVerification?: (
      user: { id: string; email: string; emailVerified?: boolean; tenantId?: string },
      request?: Request,
    ) => Promise<void>;
  };
}

describe("buildAuth — afterEmailVerification hook (260527-im6 / D3)", () => {
  it("U-E-1: calls completeSetupAdmin with {id,email,tenantId} when supplied", async () => {
    const spy = vi.fn(async () => undefined);
    const auth = buildAuth({ db: stubDb, completeSetupAdmin: spy });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    const hook = opts.emailVerification?.afterEmailVerification;
    expect(typeof hook).toBe("function");
    if (!hook) throw new Error("hook missing");
    await hook({
      id: "user-1",
      email: "admin@example.com",
      emailVerified: true,
      tenantId: "11111111-1111-1111-1111-111111111111",
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      id: "user-1",
      email: "admin@example.com",
      tenantId: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("U-E-1b: omits tenantId from the delegate call when user.tenantId is undefined", async () => {
    const spy = vi.fn(async () => undefined);
    const auth = buildAuth({ db: stubDb, completeSetupAdmin: spy });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    const hook = opts.emailVerification?.afterEmailVerification;
    if (!hook) throw new Error("hook missing");
    await hook({
      id: "user-2",
      email: "no-tenant@example.com",
      emailVerified: true,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const callArg = spy.mock.calls[0]?.[0] as { tenantId?: string } | undefined;
    expect(callArg).toEqual({ id: "user-2", email: "no-tenant@example.com" });
    expect(callArg && "tenantId" in callArg).toBe(false);
  });

  it("U-E-2: hook is a no-op when completeSetupAdmin is omitted (backward-compat)", async () => {
    const auth = buildAuth({ db: stubDb });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    const hook = opts.emailVerification?.afterEmailVerification;
    // Hook should still be wired (the closure exists), and calling it
    // should resolve without throwing -- this protects every existing
    // buildAuth() unit-test fixture in the api suite.
    expect(typeof hook).toBe("function");
    if (!hook) throw new Error("hook missing");
    await expect(
      hook({ id: "user-3", email: "x@example.com", emailVerified: true }),
    ).resolves.toBeUndefined();
  });

  it("U-E-3: spy throw propagates (BA's surrounding catch turns it to 500)", async () => {
    const spy = vi.fn(async () => {
      throw new Error("simulated downstream failure");
    });
    const auth = buildAuth({ db: stubDb, completeSetupAdmin: spy });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    const hook = opts.emailVerification?.afterEmailVerification;
    if (!hook) throw new Error("hook missing");
    await expect(
      hook({ id: "user-4", email: "boom@example.com", emailVerified: true }),
    ).rejects.toThrow("simulated downstream failure");
  });

  it("U-E-4: defensive predicate -- spy NOT called when user.emailVerified=false", async () => {
    const spy = vi.fn(async () => undefined);
    const auth = buildAuth({ db: stubDb, completeSetupAdmin: spy });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    const hook = opts.emailVerification?.afterEmailVerification;
    if (!hook) throw new Error("hook missing");
    await hook({ id: "user-5", email: "unverified@example.com", emailVerified: false });
    expect(spy).not.toHaveBeenCalled();
  });

  it("U-E-4b: emailVerified missing (undefined) -> hook short-circuits, spy NOT called", async () => {
    const spy = vi.fn(async () => undefined);
    const auth = buildAuth({ db: stubDb, completeSetupAdmin: spy });
    const opts = auth.options as unknown as AuthOptionsRuntime;
    const hook = opts.emailVerification?.afterEmailVerification;
    if (!hook) throw new Error("hook missing");
    await hook({ id: "user-6", email: "noflag@example.com" });
    expect(spy).not.toHaveBeenCalled();
  });
});
