// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 05 — auth-client unit tests (RED before GREEN).
//
// Verifies that better-auth/react 1.6.9 surface, wrapped by our
// `apps/web/src/lib/auth-client.ts`, exposes every method the U1..U13
// + A2..A3 screens consume (per RESEARCH § Pattern 3 + Assumption A2).
//
// Coverage goal: 90/90/90/90 on `apps/web/src/lib/auth-client.ts`.
//
// Mocks: NONE. We import the real `better-auth/react` client. No network
// is hit at import time — `createAuthClient` is synchronous and only
// constructs Proxies that lazily resolve method paths to fetch calls
// (CLAUDE.md: no internal-logic mocks; network is the only allowed
// boundary, and we don't call any method here so no network is touched).
import { describe, expect, it } from "vitest";
import {
  authClient,
  deleteAccount,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  signIn,
  signOut,
  signUp,
  useSession,
  verifyEmail,
} from "../../../../src/lib/auth-client";

describe("auth-client (Phase 07.1 / Plan 05)", () => {
  it("exports a defined authClient", () => {
    expect(authClient).toBeDefined();
  });

  it("authClient.signIn.email is a function (RESEARCH A2 surface check)", () => {
    expect(typeof authClient.signIn.email).toBe("function");
  });

  it("authClient.signIn.social is a function (OIDC entry point, U1)", () => {
    expect(typeof authClient.signIn.social).toBe("function");
  });

  it("authClient.signUp.email is a function (U2)", () => {
    expect(typeof authClient.signUp.email).toBe("function");
  });

  it("authClient.signOut is a function", () => {
    expect(typeof authClient.signOut).toBe("function");
  });

  it("authClient.useSession is a function (RSC + Client session hook)", () => {
    expect(typeof authClient.useSession).toBe("function");
  });

  it("authClient.verifyEmail is a function (U3)", () => {
    expect(typeof authClient.verifyEmail).toBe("function");
  });

  it("authClient.revokeSession is a function (U5 — current device)", () => {
    expect(typeof authClient.revokeSession).toBe("function");
  });

  it("authClient.revokeOtherSessions is a function (U5 — all other devices)", () => {
    expect(typeof authClient.revokeOtherSessions).toBe("function");
  });

  it("authClient.deleteAccount is a function (U5 danger zone)", () => {
    expect(typeof authClient.deleteAccount).toBe("function");
  });

  it("authClient.listSessions is a function (U5 device list)", () => {
    expect(typeof authClient.listSessions).toBe("function");
  });

  it("named re-export signIn is a function", () => {
    expect(typeof signIn).toBe("function");
  });

  it("named re-export signUp is a function", () => {
    expect(typeof signUp).toBe("function");
  });

  it("named re-export signOut is a function", () => {
    expect(typeof signOut).toBe("function");
  });

  it("named re-export useSession is a function", () => {
    expect(typeof useSession).toBe("function");
  });

  it("named re-export verifyEmail is a function", () => {
    expect(typeof verifyEmail).toBe("function");
  });

  it("named re-exports revokeSession/revokeOtherSessions/deleteAccount/listSessions are functions", () => {
    expect(typeof revokeSession).toBe("function");
    expect(typeof revokeOtherSessions).toBe("function");
    expect(typeof deleteAccount).toBe("function");
    expect(typeof listSessions).toBe("function");
  });
});
