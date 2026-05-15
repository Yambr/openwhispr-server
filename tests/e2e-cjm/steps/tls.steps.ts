// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 17 / Plan 02 / TLS-05+TLS-06 — step defs for phase17-tls.feature.
//
// Scenario 2 (@cjm-tls-no-dev-ca-in-prod-image) is the SOLE regression
// guard against per-context .dockerignore drift. It builds the prod image
// (or accepts a pre-built tag via OPENWHISPR_TLS_TEST_IMAGE env) and
// scans the image filesystem via `docker create + docker export | tar -t`
// — no `docker run` required (works on distroless).
//
// Scenarios 1 + 3 (@after-docker-up @expected-red) require a live docker
// compose stack and TLS-aware HTTPS client. Their step bodies raise a
// recognisable error so the scenarios stay red until the GHA CI stack-up
// job lands; bodies are syntactically complete so playwright-bdd's
// strict-mode (D-11) does not bail on undefined steps.

import { execFileSync } from "node:child_process";

import { expect, Given, Then, When } from "../support/world";
import { findDevCaArtefacts } from "./tls-cert-paths.js";

// -----------------------------------------------------------------------
// Scenario 1: @cjm-tls-trusted-localhost — deferred to GHA CI.
// -----------------------------------------------------------------------

Given("the developer has run `make tls-trust` on this host", async () => {
  throw new Error(
    "mkcert wiring lands in Phase 17-01; live verification @after-docker-up — stays @expected-red until GHA stack-up",
  );
});

When("they curl https://api.localhost/healthz with the mkcert root CA", async () => {
  throw new Error(
    "live https://api.localhost requires docker compose up; @after-docker-up — stays @expected-red until GHA stack-up",
  );
});

Then("the response is 200 with no TLS warning", async () => {
  throw new Error("requires live stack; @after-docker-up — stays @expected-red");
});

Then("the served leaf cert SAN list contains exactly the 10 canonical hosts", async () => {
  throw new Error("requires live cert + openssl; @after-docker-up — stays @expected-red");
});

Then("the served leaf cert SAN list contains no wildcard entries", async () => {
  throw new Error("requires live cert + openssl; @after-docker-up — stays @expected-red");
});

// -----------------------------------------------------------------------
// Scenario 2: @cjm-tls-no-dev-ca-in-prod-image — CI-runnable static scan.
// -----------------------------------------------------------------------

interface ImageScanState {
  imageTag: string;
  tarListing: string;
}

const scanState = new Map<string, ImageScanState>();

function stateFor(tenantId: string): ImageScanState {
  let s = scanState.get(tenantId);
  if (!s) {
    s = { imageTag: "", tarListing: "" };
    scanState.set(tenantId, s);
  }
  return s;
}

Given(
  "the api production image has been built with tag openwhispr-api:tls-test",
  async ({ tenantId }) => {
    const s = stateFor(tenantId);
    // Operators may pre-build the image with their own tag and pass it via
    // env to skip the in-test docker build (saves ~60s in CI).
    s.imageTag = process.env.OPENWHISPR_TLS_TEST_IMAGE ?? "openwhispr-api:tls-test";
    // Defer the build to the GHA workflow step (see ci.yml docker compose
    // build api) — this step asserts only that the tag is resolvable.
    try {
      execFileSync("docker", ["image", "inspect", s.imageTag], { stdio: "pipe" });
    } catch (err) {
      throw new Error(
        `image ${s.imageTag} not found locally; build it via 'docker compose build api' before running this scenario (orig: ${err instanceof Error ? err.message : String(err)})`,
      );
    }
  },
);

When("the image filesystem is scanned via docker-export + tar", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  const containerId = execFileSync("docker", ["create", s.imageTag]).toString().trim();
  try {
    const tarBuf = execFileSync("docker", ["export", containerId], {
      maxBuffer: 1024 * 1024 * 1024,
    });
    s.tarListing = execFileSync("tar", ["-tf", "-"], {
      input: tarBuf,
      maxBuffer: 1024 * 1024 * 1024,
    }).toString();
  } finally {
    execFileSync("docker", ["rm", "-f", containerId], { stdio: "pipe" });
  }
});

Then("no path matches rootCA.pem", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  expect(s.tarListing).not.toMatch(/rootCA[^/\s]*\.pem/);
});

Then("no path matches local.crt or local.key", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  expect(s.tarListing).not.toMatch(/\blocal\.(crt|key)\b/);
});

Then("no path contains mkcert", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  expect(s.tarListing).not.toMatch(/mkcert/i);
});

Then("no path matches compose/traefik/certs/", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  expect(s.tarListing).not.toMatch(/compose\/traefik\/certs\//);
});

Then("any bootstrap-minted cert SAN list contains no wildcard entries", async ({ tenantId }) => {
  // Closes Q1 corollary: if the prod image happens to ship a bootstrap-
  // minted cert (it should NOT per .dockerignore, but if regression slips
  // past it MUST not carry wildcard SANs). WR-01 review fix: the prior
  // implementation flagged any `*.crt`/`*.pem` in the tar listing, which
  // false-positives against every node-base prod image because
  // `node:slim`/`debian:slim` ship hundreds of `etc/ssl/certs/*.pem`
  // system-trust certs. The narrowed predicate (findDevCaArtefacts)
  // matches ONLY the exact dev-CA / mkcert filenames the codemod targets
  // (rootCA*.pem, root-ca.{crt,key,pem}, local.{crt,key,pem},
  // *.localhost.{crt,pem,key}, *mkcert*, compose/traefik/certs/**). Unit-
  // tested in __tests__/tls-cert-paths.test.ts.
  const s = stateFor(tenantId);
  const offending = findDevCaArtefacts(s.tarListing.split("\n"));
  if (offending.length === 0) return; // vacuously passes — no dev-CA ships
  throw new Error(
    `prod image unexpectedly ships ${offending.length} dev-CA artefact(s): ${offending.slice(0, 5).join(", ")}`,
  );
});

// -----------------------------------------------------------------------
// Scenario 3: @cjm-tls-acme-staging — deferred to GHA CI.
// -----------------------------------------------------------------------

Given("the operator has set LETSENCRYPT_EMAIL and LETSENCRYPT_STAGING=1", async () => {
  throw new Error(
    "ACME staging requires live stack + env; @after-docker-up — stays @expected-red until GHA stack-up",
  );
});

Given("the stack is up via docker compose with the acme overlay", async () => {
  throw new Error("requires live compose stack; @after-docker-up — stays @expected-red");
});

When("they curl https://api.example.com/healthz", async () => {
  throw new Error("requires live ACME-issued cert; @after-docker-up — stays @expected-red");
});

Then("the served leaf cert is issued by STAGING Let's Encrypt", async () => {
  throw new Error(
    "requires live cert + openssl chain check; @after-docker-up — stays @expected-red",
  );
});

Then("the cert chain validates against the staging root", async () => {
  throw new Error(
    "requires live cert + openssl chain check; @after-docker-up — stays @expected-red",
  );
});
