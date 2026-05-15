// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 17 / WR-01 (review-fix) — RED→GREEN coverage for the narrowed
// dev-CA path predicate used by Gherkin Scenario 2's last `Then`.
//
// Pre-fix behaviour: the step impl flagged any `*.crt` / `*.pem` in the
// tar listing (excluding `node_modules/`), which throws against every
// realistic prod image because `node:slim` and friends ship hundreds of
// `etc/ssl/certs/*.pem` system-trust certs. The test pins the post-fix
// contract: ONLY exact dev-CA / mkcert filenames are flagged; system
// trust-store paths are vacuously passed.

import { describe, expect, it } from "vitest";

import { DEV_CA_PATTERN, findDevCaArtefacts } from "../tls-cert-paths.js";

describe("findDevCaArtefacts — system trust store is NOT flagged (WR-01)", () => {
  it.each([
    "etc/ssl/certs/ca-certificates.crt",
    "etc/ssl/certs/ACCVRAIZ1.pem",
    "etc/ssl/certs/Mozilla-CA.pem",
    "usr/share/ca-certificates/mozilla/DigiCert_Global_Root_G2.crt",
    "usr/local/share/ca-certificates/extra-corp.crt",
    "etc/pki/tls/certs/ca-bundle.crt",
    "usr/lib/ssl/certs/random.pem",
  ])("does not flag system-trust path %s", (path) => {
    expect(findDevCaArtefacts([path])).toEqual([]);
    expect(DEV_CA_PATTERN.test(path)).toBe(false);
  });
});

describe("findDevCaArtefacts — dev-CA artefacts ARE flagged", () => {
  it.each([
    "compose/traefik/certs/rootCA.pem",
    "tmp/rootCA-key.pem",
    "var/lib/foo/root-ca.crt",
    "var/lib/foo/root-ca.key",
    "var/lib/foo/root-ca.pem",
    "etc/ssl/local.crt",
    "etc/ssl/local.key",
    "etc/ssl/local.pem",
    "compose/traefik/certs/api.localhost.crt",
    "tmp/web.localhost.key",
    "opt/build/auth.localhost.pem",
    "usr/local/bin/mkcert",
    "tmp/mkcert-rootCA-foo.pem",
    "compose/traefik/certs/anything-at-all",
  ])("flags dev-CA path %s", (path) => {
    expect(findDevCaArtefacts([path])).toEqual([path]);
  });
});

describe("findDevCaArtefacts — mixed listing returns only the offending lines", () => {
  it("filters a realistic tar listing keeping only dev-CA artefacts", () => {
    const tarListing = [
      "etc/ssl/certs/ca-certificates.crt",
      "etc/ssl/certs/ACCVRAIZ1.pem",
      "usr/share/ca-certificates/mozilla/DigiCert_Global_Root_G2.crt",
      "app/node_modules/foo/cert.pem",
      "compose/traefik/certs/rootCA.pem",
      "etc/ssl/local.crt",
      "usr/local/bin/mkcert",
    ];
    expect(findDevCaArtefacts(tarListing)).toEqual([
      "compose/traefik/certs/rootCA.pem",
      "etc/ssl/local.crt",
      "usr/local/bin/mkcert",
    ]);
  });

  it("returns [] for a fully-clean realistic prod image listing", () => {
    expect(
      findDevCaArtefacts([
        "etc/ssl/certs/ca-certificates.crt",
        "etc/ssl/certs/ACCVRAIZ1.pem",
        "usr/lib/ssl/cert.pem",
        "usr/share/ca-certificates/mozilla/Foo.crt",
      ]),
    ).toEqual([]);
  });
});
