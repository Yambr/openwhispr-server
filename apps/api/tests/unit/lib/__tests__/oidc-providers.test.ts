// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-02 / Task 1 — unit tests for the shared OIDC
// provider helper. Pure function on `env`; no I/O, no DB.
//
// Verifies BOTH exports:
//   * listConfiguredOidcProviders(env)        — public shape (no secrets)
//   * readOidcProvidersForRegistration(env)   — Better Auth shape
// across an env-permutation table covering OIDC / Google / GitHub.

import { describe, expect, it } from "vitest";
import {
  listConfiguredOidcProviders,
  localLoginEnabled,
  readOidcProvidersForRegistration,
} from "../../../../src/lib/oidc-providers.js";

type Env = NodeJS.ProcessEnv;

function envOf(partial: Record<string, string | undefined>): Env {
  return partial as unknown as Env;
}

describe("listConfiguredOidcProviders — public shape (no secrets)", () => {
  it("returns [] when ZERO providers are configured", () => {
    expect(listConfiguredOidcProviders(envOf({}))).toEqual([]);
  });

  it("returns [] when OIDC_ISSUER_URL is set but OIDC_CLIENT_ID missing (partial config is no config)", () => {
    const env = envOf({
      OIDC_ISSUER_URL: "https://issuer.example.com",
      OIDC_CLIENT_SECRET: "secret",
    });
    expect(listConfiguredOidcProviders(env)).toEqual([]);
  });

  it("returns [] when OIDC_ISSUER_URL + OIDC_CLIENT_ID set but OIDC_CLIENT_SECRET missing", () => {
    const env = envOf({
      OIDC_ISSUER_URL: "https://issuer.example.com",
      OIDC_CLIENT_ID: "cid",
    });
    expect(listConfiguredOidcProviders(env)).toEqual([]);
  });

  it("returns [{id:'oidc',name:'OIDC',enabled:true}] when all three OIDC envs are set", () => {
    const env = envOf({
      OIDC_ISSUER_URL: "https://issuer.example.com",
      OIDC_CLIENT_ID: "cid",
      OIDC_CLIENT_SECRET: "secret",
    });
    expect(listConfiguredOidcProviders(env)).toEqual([{ id: "oidc", name: "OIDC", enabled: true }]);
  });

  it("returns [{id:'google',...}] when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set", () => {
    const env = envOf({
      GOOGLE_CLIENT_ID: "g-cid",
      GOOGLE_CLIENT_SECRET: "g-secret",
    });
    expect(listConfiguredOidcProviders(env)).toEqual([
      { id: "google", name: "Google", enabled: true },
    ]);
  });

  it("returns [] when GOOGLE_CLIENT_ID set but secret missing", () => {
    const env = envOf({ GOOGLE_CLIENT_ID: "g-cid" });
    expect(listConfiguredOidcProviders(env)).toEqual([]);
  });

  it("returns [{id:'github',...}] when GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET are set", () => {
    const env = envOf({
      GITHUB_CLIENT_ID: "gh-cid",
      GITHUB_CLIENT_SECRET: "gh-secret",
    });
    expect(listConfiguredOidcProviders(env)).toEqual([
      { id: "github", name: "GitHub", enabled: true },
    ]);
  });

  it("returns ids ordered exactly ['google','github','oidc'] when all three are configured", () => {
    const env = envOf({
      OIDC_ISSUER_URL: "https://issuer.example.com",
      OIDC_CLIENT_ID: "cid",
      OIDC_CLIENT_SECRET: "secret",
      GOOGLE_CLIENT_ID: "g-cid",
      GOOGLE_CLIENT_SECRET: "g-secret",
      GITHUB_CLIENT_ID: "gh-cid",
      GITHUB_CLIENT_SECRET: "gh-secret",
    });
    const ids = listConfiguredOidcProviders(env).map((p) => p.id);
    expect(ids).toEqual(["google", "github", "oidc"]);
  });

  it("public shape NEVER contains client_secret / discoveryUrl / issuer_url fields", () => {
    const env = envOf({
      OIDC_ISSUER_URL: "https://issuer.example.com",
      OIDC_CLIENT_ID: "cid",
      OIDC_CLIENT_SECRET: "secret",
      GOOGLE_CLIENT_ID: "g-cid",
      GOOGLE_CLIENT_SECRET: "g-secret",
    });
    const list = listConfiguredOidcProviders(env);
    for (const p of list) {
      expect(Object.keys(p).sort()).toEqual(["enabled", "id", "name"]);
      const s = JSON.stringify(p);
      expect(s).not.toMatch(/secret/i);
      expect(s).not.toMatch(/discoveryUrl/i);
      expect(s).not.toMatch(/issuer/i);
    }
  });

  it("defaults to process.env when called with no argument", () => {
    // smoke check — no env mutation; default path returns Array
    expect(Array.isArray(listConfiguredOidcProviders())).toBe(true);
  });

  // -------------------------------------------------------------------------
  // OIDC_PROVIDER_NAME — operator-configurable display label (peer 3bc6n4wj).
  //
  // The `id` is a FROZEN round-trip contract with the desktop client
  // (`oidc` → POST /api/desktop-signin/oidc) and MUST NOT change. Only the
  // human-facing `name` is configurable, so an operator wiring Keycloak /
  // Authentik / Okta can render "Continue with <Company SSO>" instead of
  // the generic "OIDC" button. Unset → defaults to "OIDC" (backward compat).
  // See memory project_provider_id_roundtrip_contract.
  // -------------------------------------------------------------------------
  describe("OIDC_PROVIDER_NAME — operator-configurable display label", () => {
    it("uses OIDC_PROVIDER_NAME as the oidc provider's display name when set", () => {
      const env = envOf({
        OIDC_ISSUER_URL: "https://keycloak.example.com/realms/acme",
        OIDC_CLIENT_ID: "cid",
        OIDC_CLIENT_SECRET: "secret",
        OIDC_PROVIDER_NAME: "Acme SSO",
      });
      expect(listConfiguredOidcProviders(env)).toEqual([
        { id: "oidc", name: "Acme SSO", enabled: true },
      ]);
    });

    it("keeps the FROZEN id 'oidc' even when the display name is overridden", () => {
      const env = envOf({
        OIDC_ISSUER_URL: "https://keycloak.example.com/realms/acme",
        OIDC_CLIENT_ID: "cid",
        OIDC_CLIENT_SECRET: "secret",
        OIDC_PROVIDER_NAME: "Keycloak",
      });
      const [oidc] = listConfiguredOidcProviders(env);
      expect(oidc?.id).toBe("oidc");
    });

    it("defaults to 'OIDC' when OIDC_PROVIDER_NAME is unset (backward compat)", () => {
      const env = envOf({
        OIDC_ISSUER_URL: "https://issuer.example.com",
        OIDC_CLIENT_ID: "cid",
        OIDC_CLIENT_SECRET: "secret",
      });
      expect(listConfiguredOidcProviders(env)).toEqual([
        { id: "oidc", name: "OIDC", enabled: true },
      ]);
    });

    it("defaults to 'OIDC' when OIDC_PROVIDER_NAME is set but empty/whitespace-only", () => {
      const env = envOf({
        OIDC_ISSUER_URL: "https://issuer.example.com",
        OIDC_CLIENT_ID: "cid",
        OIDC_CLIENT_SECRET: "secret",
        OIDC_PROVIDER_NAME: "   ",
      });
      expect(listConfiguredOidcProviders(env)).toEqual([
        { id: "oidc", name: "OIDC", enabled: true },
      ]);
    });

    it("trims surrounding whitespace from OIDC_PROVIDER_NAME", () => {
      const env = envOf({
        OIDC_ISSUER_URL: "https://issuer.example.com",
        OIDC_CLIENT_ID: "cid",
        OIDC_CLIENT_SECRET: "secret",
        OIDC_PROVIDER_NAME: "  Company SSO  ",
      });
      const [oidc] = listConfiguredOidcProviders(env);
      expect(oidc?.name).toBe("Company SSO");
    });

    it("does NOT affect google / github display names", () => {
      const env = envOf({
        GOOGLE_CLIENT_ID: "g-cid",
        GOOGLE_CLIENT_SECRET: "g-secret",
        GITHUB_CLIENT_ID: "gh-cid",
        GITHUB_CLIENT_SECRET: "gh-secret",
        OIDC_PROVIDER_NAME: "Should Not Apply",
      });
      const names = Object.fromEntries(listConfiguredOidcProviders(env).map((p) => [p.id, p.name]));
      expect(names.google).toBe("Google");
      expect(names.github).toBe("GitHub");
    });
  });
});

describe("readOidcProvidersForRegistration — Better Auth shape (full config)", () => {
  it("returns [] when OIDC envs are partial / missing", () => {
    expect(readOidcProvidersForRegistration(envOf({}))).toEqual([]);
    expect(readOidcProvidersForRegistration(envOf({ OIDC_ISSUER_URL: "https://x" }))).toEqual([]);
  });

  it("returns OIDC registration entry with clientSecret + derived discoveryUrl when all three envs are set", () => {
    const env = envOf({
      OIDC_ISSUER_URL: "https://issuer.example.com",
      OIDC_CLIENT_ID: "cid",
      OIDC_CLIENT_SECRET: "secret",
    });
    const out = readOidcProvidersForRegistration(env);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      providerId: "oidc",
      clientId: "cid",
      clientSecret: "secret",
      discoveryUrl: "https://issuer.example.com/.well-known/openid-configuration",
    });
  });

  it("trims trailing slashes from OIDC_ISSUER_URL when building discoveryUrl", () => {
    const env = envOf({
      OIDC_ISSUER_URL: "https://issuer.example.com///",
      OIDC_CLIENT_ID: "cid",
      OIDC_CLIENT_SECRET: "secret",
    });
    const out = readOidcProvidersForRegistration(env);
    expect(out[0]?.discoveryUrl).toBe(
      "https://issuer.example.com/.well-known/openid-configuration",
    );
  });

  it("defaults to process.env when called with no argument", () => {
    expect(Array.isArray(readOidcProvidersForRegistration())).toBe(true);
  });

  // -------------------------------------------------------------------------
  // scopes — upstream #6 (peer gr0flvsr): the web SSO button drives Better
  // Auth's genericOAuth, which only sets the IdP `scope=` param when the
  // registration's `scopes` array is non-empty. Without `openid` the IdP (Dex)
  // never returns an id_token → web sign-in cannot complete. This block pins
  // the resolved scopes, mirroring the desktop flow (routes/desktop-signin.ts:
  // `openid email profile` + the group scope when JIT is enabled).
  // -------------------------------------------------------------------------
  describe("scopes — genericOAuth authorize-URL scope= (upstream #6)", () => {
    const baseEnv = {
      OIDC_ISSUER_URL: "https://issuer.example.com",
      OIDC_CLIENT_ID: "cid",
      OIDC_CLIENT_SECRET: "secret",
    } as const;

    function scopesOf(extra: Record<string, string | undefined>): string[] {
      const out = readOidcProvidersForRegistration(envOf({ ...baseEnv, ...extra }));
      return [...(out[0]?.scopes ?? [])];
    }

    it("(1) default (no OIDC_SCOPES, no JIT) → [openid, email, profile]", () => {
      expect(scopesOf({})).toEqual(["openid", "email", "profile"]);
    });

    it("(2) JIT on, no OIDC_GROUP_CLAIM → appends 'groups'", () => {
      expect(scopesOf({ OIDC_TENANT_CLAIM: "email_domain" })).toEqual([
        "openid",
        "email",
        "profile",
        "groups",
      ]);
    });

    it("(3) JIT on + OIDC_GROUP_CLAIM='role_groups' → appends 'role_groups'", () => {
      expect(
        scopesOf({ OIDC_TENANT_CLAIM: "email_domain", OIDC_GROUP_CLAIM: "role_groups" }),
      ).toEqual(["openid", "email", "profile", "role_groups"]);
    });

    it("(4) OIDC_SCOPES='openid,email' override → exactly [openid, email]", () => {
      expect(scopesOf({ OIDC_SCOPES: "openid,email" })).toEqual(["openid", "email"]);
    });

    it("(5) OIDC_SCOPES='email,profile' (operator forgot openid) → openid prepended", () => {
      expect(scopesOf({ OIDC_SCOPES: "email,profile" })).toEqual(["openid", "email", "profile"]);
    });

    it("(6) OIDC_SCOPES override + JIT on → group appended + deduped", () => {
      expect(scopesOf({ OIDC_SCOPES: "openid,email", OIDC_TENANT_CLAIM: "email_domain" })).toEqual([
        "openid",
        "email",
        "groups",
      ]);
    });

    it("(7) OIDC_SCOPES='openid,email,groups' + JIT (group=groups) → 'groups' once", () => {
      expect(
        scopesOf({ OIDC_SCOPES: "openid,email,groups", OIDC_TENANT_CLAIM: "email_domain" }),
      ).toEqual(["openid", "email", "groups"]);
    });

    it("(8) registration entry carries a non-empty scopes array containing 'openid'", () => {
      const out = readOidcProvidersForRegistration(envOf({ ...baseEnv }));
      expect(out[0]?.scopes).toBeDefined();
      expect((out[0]?.scopes ?? []).length).toBeGreaterThan(0);
      expect(out[0]?.scopes).toContain("openid");
    });

    it("(9) OIDC_SCOPES empty / whitespace-only → falls back to default", () => {
      expect(scopesOf({ OIDC_SCOPES: "" })).toEqual(["openid", "email", "profile"]);
      expect(scopesOf({ OIDC_SCOPES: "   " })).toEqual(["openid", "email", "profile"]);
      expect(scopesOf({ OIDC_SCOPES: " , , " })).toEqual(["openid", "email", "profile"]);
    });

    it("(10) OIDC_SCOPES with intra-override duplicates → deduped", () => {
      expect(scopesOf({ OIDC_SCOPES: "openid,openid,email" })).toEqual(["openid", "email"]);
    });

    it("trims whitespace around each CSV scope token", () => {
      expect(scopesOf({ OIDC_SCOPES: " openid , email , profile " })).toEqual([
        "openid",
        "email",
        "profile",
      ]);
    });
  });
});

describe("localLoginEnabled — disable-local-login posture (upstream #9)", () => {
  it("is enabled by default (env unset)", () => {
    expect(localLoginEnabled(envOf({}))).toBe(true);
  });

  it("is disabled ONLY when OPENWHISPR_DISABLE_LOCAL_LOGIN is exactly '1'", () => {
    expect(localLoginEnabled(envOf({ OPENWHISPR_DISABLE_LOCAL_LOGIN: "1" }))).toBe(false);
  });

  it("stays enabled for any other value (0 / true / yes / empty)", () => {
    for (const v of ["0", "true", "yes", "", " 1 "]) {
      expect(localLoginEnabled(envOf({ OPENWHISPR_DISABLE_LOCAL_LOGIN: v })), `value=${v}`).toBe(
        true,
      );
    }
  });

  it("is NOT coupled to OIDC presence (configuring OIDC keeps local login on)", () => {
    expect(
      localLoginEnabled(
        envOf({
          OIDC_ISSUER_URL: "https://issuer.example.com",
          OIDC_CLIENT_ID: "cid",
          OIDC_CLIENT_SECRET: "secret",
        }),
      ),
    ).toBe(true);
  });
});
