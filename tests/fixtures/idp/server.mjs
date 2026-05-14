// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 06 — Fixture OIDC IdP for the contract-test profile.
//
// Minimal OIDC-shaped HTTP server (~70 lines) used ONLY by the
// `contract-test` docker-compose profile. NEVER instantiated in
// production.
//
// Endpoints:
//   GET  /.well-known/openid-configuration  — discovery doc pointing to
//                                              this server's authorize/
//                                              token/userinfo paths.
//   GET  /authorize                         — 302's straight to the
//                                              caller-supplied
//                                              redirect_uri (which is
//                                              the backend's
//                                              /api/auth/callback/oidc)
//                                              with code=fixture and
//                                              the state echoed back.
//   POST /token                              — returns a static
//                                              fixture access_token +
//                                              id_token (unsigned JWT
//                                              shape).
//   GET  /userinfo                           — returns a static
//                                              fixture@conformance.test
//                                              profile.
//
// Implementation note: we use Node's built-in `http` module rather than
// an Express/Fastify dep — keeps the fixture image tiny.
import { createServer } from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT ?? 9000);
const ISSUER = process.env.ISSUER ?? `http://fixture-idp:${PORT}`;

const FIXTURE_USER = {
  sub: "fixture-idp-subject",
  email: "fixture@conformance.test",
  email_verified: true,
  name: "Fixture User",
};

function json(res, body, status = 200) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === "/.well-known/openid-configuration") {
    return json(res, {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      userinfo_endpoint: `${ISSUER}/userinfo`,
      jwks_uri: `${ISSUER}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256", "none"],
      scopes_supported: ["openid", "email", "profile"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
      code_challenge_methods_supported: ["S256"],
    });
  }

  if (path === "/authorize") {
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state") ?? "";
    if (!redirectUri) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "missing redirect_uri" }));
    }
    const target = new URL(redirectUri);
    target.searchParams.set("code", "fixture");
    target.searchParams.set("state", state);
    res.writeHead(302, { location: target.toString() });
    return res.end();
  }

  if (path === "/token" && req.method === "POST") {
    return json(res, {
      access_token: "fixture-access-token",
      token_type: "Bearer",
      expires_in: 3600,
      id_token:
        "eyJhbGciOiJub25lIn0." +
        Buffer.from(
          JSON.stringify({
            iss: ISSUER,
            sub: FIXTURE_USER.sub,
            aud: "fixture-client",
            email: FIXTURE_USER.email,
            email_verified: true,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        ).toString("base64url") +
        ".",
      scope: "openid email profile",
    });
  }

  if (path === "/userinfo") {
    return json(res, FIXTURE_USER);
  }

  if (path === "/jwks") {
    return json(res, { keys: [] });
  }

  if (path === "/livez" || path === "/healthz") {
    return json(res, { ok: true });
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`fixture-idp listening on :${PORT} issuer=${ISSUER}`);
});
