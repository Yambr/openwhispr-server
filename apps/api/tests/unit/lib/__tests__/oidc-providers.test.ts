// SPDX-License-Identifier: Apache-2.0
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
});
