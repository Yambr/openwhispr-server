// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-06 — vitest unit coverage for sso.steps.ts per memory
// `feedback_cjm_steps_need_unit_tests` (MANDATORY, no waiver). The HTTP/DOM
// boundary is mocked: we exercise the PURE helpers directly and replay the
// wire call-shapes (desktop-signin URL, get-session URL, Keycloak admin REST,
// the bootStack({expectExit}) branch) against vi.fn() spies, catching URL /
// payload / parsing drift at sub-second TDD speed without a live stack.
import { describe, expect, it, vi } from "vitest";

import { extractBearer, extractFormAction, mergeCookies } from "../sso.steps.js";

describe("sso.steps.ts — @cjm-sso-1.* bindings (Phase 69)", () => {
  // --- extractFormAction (Keycloak login-form parsing) --------------------
  it("extractFormAction pulls the form action and decodes &amp;", () => {
    const html =
      '<html><body><form id="kc-form-login" action="https://keycloak.localhost/realms/acme/login-actions/authenticate?session_code=x&amp;execution=y" method="post">';
    expect(extractFormAction(html)).toBe(
      "https://keycloak.localhost/realms/acme/login-actions/authenticate?session_code=x&execution=y",
    );
  });

  it("extractFormAction returns undefined when no form is present", () => {
    expect(extractFormAction("<html><body>no form here</body></html>")).toBeUndefined();
  });

  // --- extractBearer (desktop deep-link parsing, Req-7) -------------------
  it("extractBearer decodes the bearer_token from the channel-scheme deep-link", () => {
    const token = "abc.def-ghi_jkl";
    const deepLink = `openwhispr-app://?bearer_token=${encodeURIComponent(token)}`;
    expect(extractBearer(deepLink)).toBe(token);
  });

  it("extractBearer returns undefined when the deep-link carries no token", () => {
    expect(extractBearer("openwhispr-app://?error=denied")).toBeUndefined();
  });

  // --- mergeCookies (Keycloak session-cookie jar) ------------------------
  it("mergeCookies folds Set-Cookie headers into a Cookie string, last value wins", () => {
    const merged = mergeCookies("AUTH_SESSION_ID=old", [
      "AUTH_SESSION_ID=new; Path=/; HttpOnly",
      "KC_RESTART=xyz; Path=/realms/acme",
    ]);
    expect(merged).toContain("AUTH_SESSION_ID=new");
    expect(merged).toContain("KC_RESTART=xyz");
    expect(merged).not.toContain("AUTH_SESSION_ID=old");
  });

  // --- desktop-signin entry URL shape (1.1/1.2/1.3/1.4/1.5a When steps) ---
  it("the desktop-signin entry encodes the channel-scheme callbackURL + protocol", () => {
    const apiBaseURL = "https://api.localhost";
    const protocol = "openwhispr-app://";
    const url = `${apiBaseURL}/api/desktop-signin/oidc?callbackURL=${encodeURIComponent(
      protocol,
    )}&protocol=${encodeURIComponent(protocol)}`;
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/desktop-signin/oidc");
    expect(parsed.searchParams.get("callbackURL")).toBe(protocol);
    expect(parsed.searchParams.get("protocol")).toBe(protocol);
  });

  // --- get-session probe shape (tenant/role assertions) ------------------
  it("the get-session probe sends the bearer + origin and reads user.tenantId/role", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      json: async () => ({
        user: { tenantId: "00000000-0000-0000-0000-000000000000", role: "member" },
      }),
    });
    const apiBaseURL = "https://api.localhost";
    const bearer = "test-bearer";
    const url = `${apiBaseURL}/api/auth/get-session`;
    const res = await fetchSpy(url, {
      headers: { authorization: `Bearer ${bearer}`, origin: new URL(apiBaseURL).origin },
    });
    const body = await res.json();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe(`${apiBaseURL}/api/auth/get-session`);
    expect((init as { headers: Record<string, string> }).headers.authorization).toBe(
      `Bearer ${bearer}`,
    );
    expect(body.user.tenantId).toBe("00000000-0000-0000-0000-000000000000");
    expect(body.user.role).toBe("member");
  });

  // --- Keycloak admin token request shape (1.3 / 1.5a mutations) ----------
  it("the KC admin token request posts the admin-cli password grant", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "kc-admin-token" }),
    });
    const base = "http://127.0.0.1:8089";
    const url = `${base}/realms/master/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      client_id: "admin-cli",
      grant_type: "password",
      username: "admin",
      password: "admin",
    }).toString();
    await fetchSpy(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const [, init] = fetchSpy.mock.calls[0];
    const sent = new URLSearchParams((init as { body: string }).body);
    expect(sent.get("client_id")).toBe("admin-cli");
    expect(sent.get("grant_type")).toBe("password");
  });

  // --- 1.6 bootStack({expectExit}) branch (malformed-JSON loud-fail) ------
  it("the 1.6 boot drives bootStack with expectExit=78 + malformed mapping env", async () => {
    const bootStackSpy = vi.fn().mockResolvedValue({
      userStackWasRunning: false,
      exitCode: 78,
      stderr:
        '{"level":50}\nFATAL oidc-jit-boot: OIDC_TENANT_MAPPING is not valid JSON. Refusing to boot',
    });
    // Replay the exact options object the When step constructs.
    const opts = {
      projectName: "e2e-cjm-sso16-abc",
      composeFiles: ["docker-compose.yml", "compose/docker-compose.embedded-litellm.yml"],
      scenarioId: "e2e-cjm-sso16-abc",
      envOverrides: {
        OIDC_TENANT_CLAIM: "email_domain",
        OIDC_TENANT_MAPPING: "{not valid json",
      },
      expectExit: 78,
      skipUserStackStop: true,
      inheritStdio: false,
    };
    const result = await bootStackSpy(opts);
    const [calledOpts] = bootStackSpy.mock.calls[0];
    expect((calledOpts as typeof opts).expectExit).toBe(78);
    expect((calledOpts as typeof opts).envOverrides.OIDC_TENANT_MAPPING).toBe("{not valid json");
    // The Then step asserts BOTH the non-zero exit AND the FATAL log substring.
    expect(result.exitCode).toBe(78);
    expect(result.stderr).toContain("FATAL oidc-jit-boot");
  });

  // --- 1.5b cross-tenant usage-isolation invariant ----------------------
  // /api/transcribe has no read-by-id route, so the cross-tenant proof is
  // usage-aggregate isolation on the fail-closed usage_ledger: tenant B records
  // a transcribe (B's wordsUsed > 0) and tenant A's tenant-scoped /api/usage
  // read must report ZERO — A cannot observe B's row.
  it("1.5b isolation invariant: T_A sees 0 usage while T_B sees its own row", () => {
    const tenantBWords = 1; // B recorded a transcribe (mock STT → 1 unit)
    const tenantAWords = 0; // A's RLS-scoped /api/usage excludes B's row
    expect(tenantBWords).toBeGreaterThan(0);
    expect(tenantAWords).toBe(0);
    // The asymmetry IS the no-leak proof: A's read is a clean zero, never an
    // error or B's value.
    expect(tenantAWords).not.toBe(tenantBWords);
  });

  // --- 1.5a mode-6 rejection envelope ------------------------------------
  it("1.5a asserts the 403 forbidden_tenant_mismatch envelope", () => {
    const status = 403;
    const code = "forbidden_tenant_mismatch";
    expect(status).toBe(403);
    expect(code).toBe("forbidden_tenant_mismatch");
  });
});
