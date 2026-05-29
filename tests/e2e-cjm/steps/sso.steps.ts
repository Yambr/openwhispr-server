// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-06 / Wave 4 — @cjm-sso-1.* live-Keycloak OIDC SSO step bindings.
//
// Replaces the Phase-18 placeholder stubs. These drive REAL OIDC flows against a
// LIVE Keycloak 26 container (realm `acme`, seeded by scripts/seed-keycloak-realm.sh
// + the @sso-only api↔Keycloak fixture overlay compose/test/keycloak-api-env.yml).
// No IdP mock — constitutional (T-69-17).
//
// Driving strategy (per 69-RESEARCH + D-69-1/3/4):
//   * JIT provisioning + re-sync + downgrade + tenant-derivation + mode-6 403
//     are driven through the DESKTOP bearer-mint path (GET /api/desktop-signin/oidc
//     → live Keycloak login form → /api/auth/desktop-callback/oidc → channel-scheme
//     deep-link). This single flow also satisfies Req-7 (the desktop bearer leg).
//     The whole 302-chain + the Keycloak login-form POST are driven with undici so
//     the terminal `openwhispr-app://?bearer_token=...` deep-link (an unknown
//     protocol a browser cannot navigate) is observable as a Location header.
//   * The provisioning OUTCOME (tenant/role) is read back from the authenticated
//     session via GET /api/auth/get-session (tenantId + role are Better Auth
//     additionalFields — auth.ts:499-544). The AUDIT EVENT is asserted from the
//     api container's structured stderr log (the JIT hooks emit
//     `{event:"sso.jit.user.created"|...}` — oidc-jit-hooks.ts) read via
//     `docker compose -p e2e-cjm logs api`, since no audit-read route exists and
//     adding one would be new production code (D-69-4 / CLAUDE.md hard-rule-1).
//   * 1.5b clones the proven cross-tenant 404 RLS read against a fail-closed app
//     table (rls-cross-tenant.steps.ts) — `users` fails OPEN so it cannot host
//     the isolation proof (69-RESEARCH fact 3 / D-69-3).
//   * 1.6 is a pure boot-config test (no Keycloak): malformed OIDC_TENANT_MAPPING
//     JSON → validateJitBoot() exits 78 + `FATAL oidc-jit-boot` (oidc-jit-boot.ts:84-98),
//     driven via the compose-harness bootStack({expectExit}) seam (byok.steps.ts:158-175).
//
// Per cjm-steps-need-unit-tests: sibling unit coverage with the HTTP/DOM boundary
// mocked lives at __tests__/sso.steps.test.ts.

import { Agent, fetch as undiciFetch } from "undici";

import {
  type BootStackResult,
  bootStack,
  REPO_ROOT,
  tearStack,
} from "../support/compose-harness.js";
import { expect, Given, Then, When } from "../support/fixtures";
import { After } from "../support/world";
import { provisionTenant, readTranscribeJob, recordTranscribeJob } from "./rls-cross-tenant.steps";

// ---------------------------------------------------------------------------
// Constants — Keycloak realm `acme` seeded fixture (LOCKER-03 allows localhost +
// admin/test-token literals inside tests/).
// ---------------------------------------------------------------------------

/** Keycloak admin REST base (host-published port from compose/test/keycloak.yml). */
const KC_ADMIN_BASE = process.env.KC_URL ?? "http://127.0.0.1:8089";
const KC_ADMIN_USER = process.env.KC_ADMIN_USER ?? "admin";
const KC_ADMIN_PASSWORD = process.env.KC_ADMIN_PASSWORD ?? "admin";
const KC_REALM = "acme";

/** The desktop custom-protocol scheme the deep-link echoes (Req-7).
 * MUST be one of the desktop-signin built-in allow-list schemes
 * (apps/api/src/lib/scheme-allowlist.ts BUILTIN_SCHEMES = openwhispr /
 * openwhispr-dev / openwhispr-staging) or the test 400s with
 * "scheme is not in the configured allow-list". `openwhispr-app` is NOT
 * allow-listed; use the canonical built-in `openwhispr`. */
const CHANNEL_SCHEME = "openwhispr";

/** Seeded realm users (realm-openwhispr-test.json). */
const USERS = {
  alice: { username: "alice", password: "alice-test-password", email: "alice@acme.example" },
  carol: { username: "carol", password: "carol-test-password", email: "carol@acme.example" },
  dave: { username: "dave", password: "dave-test-password", email: "dave@acme.example" },
  bob: { username: "bob", password: "bob-test-password", email: "bob@acme.example" },
} as const;

// ---------------------------------------------------------------------------
// Per-scenario state
// ---------------------------------------------------------------------------

interface ScenarioState {
  /** Bearer minted by the most recent desktop OIDC login. */
  bearer?: string;
  /** The terminal deep-link Location header (Req-7). */
  deepLink?: string;
  /** Last session payload from GET /api/auth/get-session. */
  session?: { tenantId?: string; role?: string; name?: string; email?: string };
  /** Last desktop-callback HTTP status (for the 1.5a 403 assertion). */
  lastLoginStatus?: number;
  /** Last desktop-callback error envelope code, if any. */
  lastErrorCode?: string;
  /** 1.6 boot result. */
  bootResult?: BootStackResult;
  /** 1.6 hermetic project name (for After() teardown). */
  bootProjectName?: string;
  /** 1.5b cross-tenant read state. */
  rls?: {
    tenantA: { tenantId: string; cookie: string };
    tenantB: { tenantId: string; cookie: string; jobId?: string };
    response?: { status: number; body: unknown };
  };
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

// ---------------------------------------------------------------------------
// undici localhost dispatcher (self-signed TLS for *.localhost — LOCKER-03 allows)
// ---------------------------------------------------------------------------

function dispatcherFor(url: string): Agent | undefined {
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host.endsWith(".localhost")) {
      return new Agent({ connect: { rejectUnauthorized: false } });
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

/** Merge Set-Cookie headers into a Cookie request-header string (last value wins). */
export function mergeCookies(prev: string, setCookies: string[]): string {
  const jar = new Map<string, string>();
  for (const c of prev
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const eq = c.indexOf("=");
    if (eq > 0) jar.set(c.slice(0, eq), c.slice(eq + 1));
  }
  for (const sc of setCookies) {
    const first = sc.split(";", 1)[0];
    const eq = first.indexOf("=");
    if (eq > 0) jar.set(first.slice(0, eq), first.slice(eq + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function getSetCookie(res: Response): string[] {
  return (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
}

// ---------------------------------------------------------------------------
// Keycloak Admin REST helpers (used to mutate seeded users between two logins —
// the only honest way to drive the role-downgrade + tenant-mismatch mechanisms
// against a single shared live realm with fixed JIT env).
// ---------------------------------------------------------------------------

async function kcAdminToken(): Promise<string> {
  const url = `${KC_ADMIN_BASE}/realms/master/protocol/openid-connect/token`;
  const res = await undiciFetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: "admin-cli",
      grant_type: "password",
      username: KC_ADMIN_USER,
      password: KC_ADMIN_PASSWORD,
    }).toString(),
    dispatcher: dispatcherFor(url),
  });
  if (!res.ok) throw new Error(`kc admin token failed: ${res.status}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("kc admin token missing access_token");
  return body.access_token;
}

async function kcFindUserId(token: string, username: string): Promise<string> {
  const url = `${KC_ADMIN_BASE}/admin/realms/${KC_REALM}/users?username=${encodeURIComponent(username)}&exact=true`;
  const res = await undiciFetch(url, {
    headers: { authorization: `Bearer ${token}` },
    dispatcher: dispatcherFor(url),
  });
  if (!res.ok) throw new Error(`kc find user failed: ${res.status}`);
  const rows = (await res.json()) as Array<{ id: string }>;
  const first = rows[0];
  if (!first) throw new Error(`kc user not found: ${username}`);
  return first.id;
}

async function kcFindGroupId(token: string, groupName: string): Promise<string> {
  const url = `${KC_ADMIN_BASE}/admin/realms/${KC_REALM}/groups?search=${encodeURIComponent(groupName)}`;
  const res = await undiciFetch(url, {
    headers: { authorization: `Bearer ${token}` },
    dispatcher: dispatcherFor(url),
  });
  if (!res.ok) throw new Error(`kc find group failed: ${res.status}`);
  const rows = (await res.json()) as Array<{ id: string; name: string }>;
  const match = rows.find((g) => g.name === groupName);
  if (!match) throw new Error(`kc group not found: ${groupName}`);
  return match.id;
}

/** Remove a seeded user from a realm group (drives the 1.3 role downgrade). */
async function kcRemoveUserFromGroup(username: string, groupName: string): Promise<void> {
  const token = await kcAdminToken();
  const userId = await kcFindUserId(token, username);
  const groupId = await kcFindGroupId(token, groupName);
  const url = `${KC_ADMIN_BASE}/admin/realms/${KC_REALM}/users/${userId}/groups/${groupId}`;
  const res = await undiciFetch(url, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
    dispatcher: dispatcherFor(url),
  });
  if (res.status >= 400) throw new Error(`kc remove from group failed: ${res.status}`);
}

/** Rewrite a seeded user's email (drives the 1.5a resolved-tenant change). */
async function kcSetUserEmail(username: string, email: string): Promise<void> {
  const token = await kcAdminToken();
  const userId = await kcFindUserId(token, username);
  const url = `${KC_ADMIN_BASE}/admin/realms/${KC_REALM}/users/${userId}`;
  const res = await undiciFetch(url, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ email, emailVerified: true }),
    dispatcher: dispatcherFor(url),
  });
  if (res.status >= 400) throw new Error(`kc set email failed: ${res.status}`);
}

// ---------------------------------------------------------------------------
// Desktop OIDC bearer-mint login driver (undici end-to-end against live Keycloak)
// ---------------------------------------------------------------------------

interface DesktopLoginResult {
  status: number;
  deepLink?: string;
  bearer?: string;
  errorCode?: string;
}

/**
 * Drive the full desktop OIDC flow against the live Keycloak with undici:
 *   1. GET /api/desktop-signin/oidc?callbackURL=&protocol= → 302 to KC authorize.
 *   2. GET the KC authorize URL → 200 login-form HTML; capture KC cookies + the
 *      form `action` URL.
 *   3. POST the login form (username/password) → 302 back to /api/auth/desktop-callback/oidc.
 *   4. GET the callback → 302 to `<scheme>://?bearer_token=...` (the deep-link) OR
 *      a 4xx error envelope (the mode-6 rejection path).
 */
async function desktopOidcLogin(
  apiBaseURL: string,
  user: { username: string; password: string },
): Promise<DesktopLoginResult> {
  const apiDispatcher = dispatcherFor(apiBaseURL);
  // The desktop-signin scheme allow-list validates `protocol` as a BARE RFC 3986
  // scheme name (e.g. `openwhispr-app`) — NOT `openwhispr-app://`, which fails the
  // grammar (`scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`, no `://`). The
  // `callbackURL` is the full custom-scheme URL. Mirrors the passing unit fixture
  // apps/api/tests/unit/routes/desktop-signin.test.ts:173 (`openwhispr://cb` + `openwhispr`).
  const protocol = CHANNEL_SCHEME;
  const callbackURL = `${CHANNEL_SCHEME}://cb`;
  const signinUrl = `${apiBaseURL}/api/desktop-signin/oidc?callbackURL=${encodeURIComponent(
    callbackURL,
  )}&protocol=${encodeURIComponent(protocol)}`;

  // (1) Kick off the flow → 302 to the Keycloak authorize URL.
  const start = await undiciFetch(signinUrl, {
    method: "GET",
    headers: { origin: new URL(apiBaseURL).origin },
    redirect: "manual",
    dispatcher: apiDispatcher,
  });
  if (start.status !== 302) {
    return { status: start.status, errorCode: `desktop-signin returned ${start.status}` };
  }
  const authorizeUrl = start.headers.get("location");
  if (!authorizeUrl) return { status: 500, errorCode: "no authorize redirect" };

  // (2) GET the Keycloak authorize page → login-form HTML.
  const kcDispatcher = dispatcherFor(authorizeUrl);
  const formPage = await undiciFetch(authorizeUrl, {
    method: "GET",
    redirect: "manual",
    dispatcher: kcDispatcher,
  });
  const kcCookies = mergeCookies("", getSetCookie(formPage));
  const html = await formPage.text();
  const action = extractFormAction(html);
  if (!action) return { status: 500, errorCode: "no KC login form action" };

  // (3) POST the credentials to the form action.
  const loginRes = await undiciFetch(action, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: kcCookies,
    },
    body: new URLSearchParams({
      username: user.username,
      password: user.password,
      credentialId: "",
    }).toString(),
    redirect: "manual",
    dispatcher: dispatcherFor(action),
  });
  // Keycloak 302s back to the api desktop-callback on success.
  const callbackUrl = loginRes.headers.get("location");
  if (loginRes.status !== 302 || !callbackUrl) {
    // 200 here means KC re-rendered the form (bad creds) — surface it.
    return {
      status: loginRes.status === 200 ? 401 : loginRes.status,
      errorCode: "KC login not accepted",
    };
  }

  // (4) Follow the api desktop-callback. It either 302s to the deep-link
  //     (success) or returns a 4xx error envelope (mode-6 rejection).
  return followCallback(callbackUrl, apiDispatcher);
}

async function followCallback(
  callbackUrl: string,
  apiDispatcher: Agent | undefined,
): Promise<DesktopLoginResult> {
  const res = await undiciFetch(callbackUrl, {
    method: "GET",
    redirect: "manual",
    dispatcher: dispatcherFor(callbackUrl) ?? apiDispatcher,
  });
  if (res.status === 302) {
    const loc = res.headers.get("location") ?? "";
    const bearer = extractBearer(loc);
    return { status: 302, deepLink: loc, ...(bearer ? { bearer } : {}) };
  }
  // 4xx → error envelope. The JIT rejection (mode-6) surfaces here.
  const body = (await res.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
  const code =
    typeof body.code === "string"
      ? body.code
      : typeof body.error === "string"
        ? body.error
        : undefined;
  return { status: res.status, ...(code ? { errorCode: code } : {}) };
}

/** Extract the `<form action="...">` URL from a Keycloak login page. */
export function extractFormAction(html: string): string | undefined {
  const m = /<form[^>]*\baction="([^"]+)"/i.exec(html);
  if (!m?.[1]) return undefined;
  // KC encodes `&` as `&amp;` in the HTML attribute.
  return m[1].replace(/&amp;/g, "&");
}

/** Extract the bearer token from a `<scheme>://?bearer_token=...` deep-link. */
export function extractBearer(deepLink: string): string | undefined {
  const m = /[?&]bearer_token=([^&]+)/.exec(deepLink);
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

/** Read the authenticated session (tenantId/role/name are additionalFields). */
async function getSession(
  apiBaseURL: string,
  bearer: string,
): Promise<{ tenantId?: string; role?: string; name?: string; email?: string }> {
  const url = `${apiBaseURL}/api/auth/get-session`;
  const res = await undiciFetch(url, {
    headers: { authorization: `Bearer ${bearer}`, origin: new URL(apiBaseURL).origin },
    dispatcher: dispatcherFor(url),
  });
  const body = (await res.json().catch(() => null)) as {
    user?: { tenantId?: string; role?: string; name?: string; email?: string };
  } | null;
  return {
    tenantId: body?.user?.tenantId,
    role: body?.user?.role,
    name: body?.user?.name,
    email: body?.user?.email,
  };
}

/**
 * Assert a JIT structured-log event fired by grepping the api container's
 * captured stderr (`docker compose -p e2e-cjm logs api`). The hooks emit
 * `{"event":"sso.jit.user.created",...}` / `sso.jit.role.updated` /
 * `sso.jit.rejected` — oidc-jit-hooks.ts. No audit-read route exists, so the
 * structured log is the honest e2e proof that the audit path executed.
 */
async function assertJitLogEvent(event: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const logs = await new Promise<string>((resolve) => {
    let out = "";
    const child = spawn(
      "docker",
      ["compose", "-p", "e2e-cjm", "logs", "api", "--no-color", "--tail=400"],
      { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout?.on("data", (b) => {
      out += String(b);
    });
    child.stderr?.on("data", (b) => {
      out += String(b);
    });
    child.on("close", () => resolve(out));
    child.on("error", () => resolve(out));
  });
  expect(logs, `expected JIT log event "${event}" in api logs`).toContain(event);
}

// ===========================================================================
// @cjm-sso-1.1 — First-time JIT user creation from OIDC ID token
// ===========================================================================

Given(
  "Keycloak realm {string} is up and the OIDC env triple is set",
  async ({ tenantId }, realm: string) => {
    // Precondition: the Makefile @sso branch booted Keycloak + seeded realm
    // `acme` + layered keycloak-api-env.yml (OIDC triple + 7 JIT vars). Assert
    // the realm discovery doc is reachable so a wiring break fails HERE with a
    // clear message rather than mid-flow.
    stateFor(tenantId);
    expect(realm).toBe(KC_REALM);
    const disc = `${KC_ADMIN_BASE}/realms/${realm}/.well-known/openid-configuration`;
    const res = await undiciFetch(disc, { dispatcher: dispatcherFor(disc) });
    expect(res.status, `Keycloak realm ${realm} discovery not reachable`).toBe(200);
  },
);

When(
  "a user signs in via OIDC for the first time with tenant claim {string}",
  async ({ apiBaseURL, tenantId }, _claim: string) => {
    const s = stateFor(tenantId);
    const r = await desktopOidcLogin(apiBaseURL, USERS.alice);
    expect(r.status, `alice OIDC login: ${r.errorCode ?? ""}`).toBe(302);
    s.bearer = r.bearer;
    s.deepLink = r.deepLink;
    expect(s.bearer, "no bearer minted for alice").toBeTruthy();
    s.session = await getSession(apiBaseURL, s.bearer as string);
  },
);

Then(
  "a User row is created with tenant {string} and role {string}",
  async ({ tenantId }, tenant: string, role: string) => {
    const s = stateFor(tenantId);
    // tenant "acme" resolves (via the email_domain mapping) to DEFAULT_TENANT_ID
    // — the users table fails OPEN to the default tenant (rule 16), so the
    // persisted + session tenant IS the default. The feature's literal "acme"
    // is the realm/tenant NAME; the wire value is the mapped UUID.
    expect(tenant).toBe("acme");
    expect(s.session?.tenantId).toBe("00000000-0000-0000-0000-000000000000");
    expect(s.session?.role).toBe(role);
    // Req-7: the desktop deep-link echoes the channel scheme + bearer.
    expect(s.deepLink ?? "").toContain(`${CHANNEL_SCHEME}://`);
    expect(s.deepLink ?? "").toContain("bearer_token=");
  },
);

Then("an audit_log row is emitted with action {string}", async ({ tenantId }, action: string) => {
  stateFor(tenantId);
  await assertJitLogEvent(action);
});

// ===========================================================================
// @cjm-sso-1.2 — Returning OIDC user re-synced on second sign-in
// ===========================================================================

Given(
  "a User row already exists for tenant {string} with email {string}",
  async ({ apiBaseURL, tenantId }, _tenant: string, _email: string) => {
    const s = stateFor(tenantId);
    // First login creates alice.
    const r = await desktopOidcLogin(apiBaseURL, USERS.alice);
    expect(r.status, `alice first login: ${r.errorCode ?? ""}`).toBe(302);
    s.bearer = r.bearer;
  },
);

When("the user signs in via OIDC a second time", async ({ apiBaseURL, tenantId }) => {
  const s = stateFor(tenantId);
  const r = await desktopOidcLogin(apiBaseURL, USERS.alice);
  expect(r.status, `alice second login: ${r.errorCode ?? ""}`).toBe(302);
  s.bearer = r.bearer;
  expect(s.bearer, "no bearer on second login").toBeTruthy();
  s.session = await getSession(apiBaseURL, s.bearer as string);
});

Then(
  "the returning session resolves to tenant {string} and role {string}",
  async ({ tenantId }, tenant: string, role: string) => {
    const s = stateFor(tenantId);
    expect(tenant).toBe("acme");
    expect(s.session?.tenantId).toBe("00000000-0000-0000-0000-000000000000");
    expect(s.session?.role).toBe(role);
  },
);

// ===========================================================================
// @cjm-sso-1.3 — Group-to-role downgrade revokes admin on next sign-in
// ===========================================================================

Given(
  "a User row already exists for tenant {string} with role {string}",
  async ({ apiBaseURL, tenantId }, _tenant: string, role: string) => {
    const s = stateFor(tenantId);
    // dave is seeded into openwhispr-admin → first login mints role=admin.
    const r = await desktopOidcLogin(apiBaseURL, USERS.dave);
    expect(r.status, `dave first login: ${r.errorCode ?? ""}`).toBe(302);
    expect(r.bearer).toBeTruthy();
    const session = await getSession(apiBaseURL, r.bearer as string);
    expect(session.role, "dave should start as admin").toBe(role);
    s.bearer = r.bearer;
  },
);

When(
  "the user signs in via OIDC and the admin group has been removed from claims",
  async ({ apiBaseURL, tenantId }) => {
    const s = stateFor(tenantId);
    // Revoke dave's admin group via Admin REST, then re-login → the resolver
    // now sees only openwhispr-engineering (member); update.before downgrades.
    await kcRemoveUserFromGroup(USERS.dave.username, "openwhispr-admin");
    const r = await desktopOidcLogin(apiBaseURL, USERS.dave);
    expect(r.status, `dave second login: ${r.errorCode ?? ""}`).toBe(302);
    s.bearer = r.bearer;
    s.session = await getSession(apiBaseURL, r.bearer as string);
  },
);

Then("the User row's role is rewritten to the configured default role", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  // openwhispr-engineering → member; that IS the configured default (member).
  expect(s.session?.role).toBe("member");
});

// ===========================================================================
// @cjm-sso-1.4 — Tenant assignment derived from email domain claim
// ===========================================================================

Given("the OIDC_TENANT_CLAIM env is set to {string}", async ({ tenantId }, value: string) => {
  // The @sso fixture (keycloak-api-env.yml) sets OIDC_TENANT_CLAIM=email_domain.
  stateFor(tenantId);
  expect(value).toBe("email_domain");
});

Given(
  "OIDC_TENANT_MAPPING includes {string} mapped to tenant {string}",
  async ({ tenantId }, domain: string, tenant: string) => {
    stateFor(tenantId);
    expect(domain).toBe("acme.example");
    expect(tenant).toBe("acme");
  },
);

When(
  "a user with email {string} signs in via OIDC for the first time",
  async ({ apiBaseURL, tenantId }, email: string) => {
    const s = stateFor(tenantId);
    expect(email).toBe(USERS.bob.email);
    const r = await desktopOidcLogin(apiBaseURL, USERS.bob);
    expect(r.status, `bob OIDC login: ${r.errorCode ?? ""}`).toBe(302);
    s.bearer = r.bearer;
    s.session = await getSession(apiBaseURL, r.bearer as string);
  },
);

Then("a User row is created with tenant {string}", async ({ tenantId }, tenant: string) => {
  const s = stateFor(tenantId);
  expect(tenant).toBe("acme");
  // email_domain("bob@acme.example") = "acme.example" → DEFAULT_TENANT_ID.
  expect(s.session?.tenantId).toBe("00000000-0000-0000-0000-000000000000");
});

// ===========================================================================
// @cjm-sso-1.5a — Returning user whose resolved tenant changed → 403
// ===========================================================================

Given(
  "a returning OIDC user {string} was first provisioned under tenant {string}",
  async ({ apiBaseURL, tenantId }, username: string, _tenant: string) => {
    const s = stateFor(tenantId);
    expect(username).toBe(USERS.carol.username);
    // Ensure carol starts at her seeded acme.example email, then first login
    // provisions her under the acme tenant (DEFAULT_TENANT_ID).
    await kcSetUserEmail(USERS.carol.username, USERS.carol.email);
    const r = await desktopOidcLogin(apiBaseURL, USERS.carol);
    expect(r.status, `carol first login: ${r.errorCode ?? ""}`).toBe(302);
    s.bearer = r.bearer;
  },
);

When(
  "the user signs in via OIDC after their email domain now resolves tenant {string}",
  async ({ apiBaseURL, tenantId }, tenant: string) => {
    const s = stateFor(tenantId);
    expect(tenant).toBe("globex");
    // Change carol's email domain to globex.example (mapped to a DIFFERENT
    // tenant id). Her persisted row is still bound to acme/default → the
    // resolver's mode-6 check (resolved tenant ≠ existing tenant) fires.
    await kcSetUserEmail(USERS.carol.username, "carol@globex.example");
    const r = await desktopOidcLogin(apiBaseURL, USERS.carol);
    s.lastLoginStatus = r.status;
    s.lastErrorCode = r.errorCode;
  },
);

Then(
  "sign-in is rejected with a {int} forbidden_tenant_mismatch error",
  async ({ tenantId }, status: number) => {
    const s = stateFor(tenantId);
    expect(s.lastLoginStatus).toBe(status);
    expect(s.lastErrorCode).toBe("forbidden_tenant_mismatch");
  },
);

// Restore carol's email after the scenario so re-runs are idempotent.
After({ tags: "@cjm-sso-1.5a" }, async () => {
  try {
    await kcSetUserEmail(USERS.carol.username, USERS.carol.email);
  } catch {
    /* best-effort cleanup */
  }
});

// ===========================================================================
// @cjm-sso-1.5b — Cross-tenant read in a fail-closed table → 404 not_found
// (clone of rls-cross-tenant.steps.ts; `users` fails open so cannot host this)
// ===========================================================================

Given(
  "a JIT user is provisioned for tenant {string} and a transcription row exists for tenant {string}",
  async ({ apiBaseURL, mailpitApiUrl, tenantId }, _tenantA: string, _tenantB: string) => {
    const s = stateFor(tenantId);
    const a = await provisionTenant(apiBaseURL, mailpitApiUrl, { tenantId: `${tenantId}-A` });
    const b = await provisionTenant(apiBaseURL, mailpitApiUrl, { tenantId: `${tenantId}-B` });
    const { jobId } = await recordTranscribeJob(apiBaseURL, b.cookie);
    s.rls = {
      tenantA: { tenantId: a.tenantId, cookie: a.cookie },
      tenantB: { tenantId: b.tenantId, cookie: b.cookie, jobId },
    };
    expect(jobId, "T_B transcribe job id missing").toBeTruthy();
  },
);

When(
  "the tenant {string} user issues an authenticated read scoped to tenant {string}'s transcription row",
  async ({ apiBaseURL, tenantId }, _tenantA: string, _tenantB: string) => {
    const s = stateFor(tenantId);
    if (!s.rls?.tenantB.jobId) throw new Error("step ordering: no T_B job id");
    const resp = await readTranscribeJob(apiBaseURL, s.rls.tenantA.cookie, s.rls.tenantB.jobId);
    s.rls.response = { status: resp.status, body: resp.body };
  },
);

Then(
  "the read returns {int} not_found and the row's existence is not leaked",
  async ({ tenantId }, status: number) => {
    const s = stateFor(tenantId);
    expect(s.rls?.response?.status).toBe(status);
    const code = (s.rls?.response?.body as { error?: { code?: string } })?.error?.code ?? "";
    // A `forbidden_*` code would leak existence; RLS hides the row as not_found.
    expect(code).toMatch(/^not_found$/);
  },
);

// ===========================================================================
// @cjm-sso-1.6 — Loud-fail on malformed JIT mapping JSON at boot
// (re-scoped per D-69-4 C2; pure boot-config test, no Keycloak)
// ===========================================================================

Given(
  "the api is configured with a malformed OIDC_TENANT_MAPPING JSON value",
  async ({ tenantId }) => {
    const s = stateFor(tenantId);
    // Record the misconfig posture; the actual boot happens in the When step
    // via the compose-harness bootStack({expectExit}) seam (byok precedent).
    s.bootProjectName = `e2e-cjm-sso16-${tenantId.slice(0, 8)}`;
  },
);

When("the api container boots", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  s.bootResult = await bootStack({
    projectName: s.bootProjectName,
    // Slim-core base + embedded-litellm (matches the byok loud-fail precedent).
    composeFiles: ["docker-compose.yml", "compose/docker-compose.embedded-litellm.yml"],
    scenarioId: s.bootProjectName,
    envOverrides: {
      // OIDC_TENANT_CLAIM set so readJitConfig() does NOT early-return null —
      // the malformed mapping must reach validateJitBoot()'s JSON.parse.
      OIDC_TENANT_CLAIM: "email_domain",
      OIDC_TENANT_MAPPING: "{not valid json",
    },
    expectExit: 78,
    skipUserStackStop: true,
    inheritStdio: false,
  });
});

Then(
  "boot fails loudly with stderr containing {string} and exit code {int}",
  async ({ tenantId }, fatal: string, code: number) => {
    const s = stateFor(tenantId);
    // Primary gate: the api crashed loud with the SPEC-mandated EX_CONFIG (78)
    // — JIT is never silently disabled on misconfig (T-69-20).
    expect(s.bootResult?.exitCode).toBe(code);
    // Corroborating: the validateJitBoot() FATAL line names the offending var.
    expect(s.bootResult?.stderr ?? "").toContain(fatal);
  },
);

After({ tags: "@cjm-sso-1.6" }, async ({ tenantId }) => {
  const s = stateFor(tenantId);
  if (s.bootProjectName) {
    await tearStack({
      projectName: s.bootProjectName,
      composeFiles: ["docker-compose.yml", "compose/docker-compose.embedded-litellm.yml"],
      skipUserStackRestart: true,
      inheritStdio: false,
      ...(s.bootResult?.envFilePath ? { envFilePath: s.bootResult.envFilePath } : {}),
    });
  }
});
