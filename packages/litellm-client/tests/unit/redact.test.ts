// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase litellm-patterns A2 — unit tests for shape-based secret redaction.
//
// The synthetic fake-secret fixtures below are ASSEMBLED AT RUNTIME from
// fragments — the precedent is commit 2e407376 ("assemble synthetic
// gitleaks fixture at runtime"): a complete `sk-…` / `AKIA…` / JWT
// literal in source would trip GitHub push-protection (which cannot read
// the repo `.gitleaks.toml` allowlist). No complete credential literal
// exists in this file; the assembled values still exercise the redaction
// shapes once concatenated at runtime.

import { describe, expect, it } from "vitest";
import { LitellmUpstreamError } from "../../src/errors.js";
import { redactSecretShapes } from "../../src/redact.js";

// --- synthetic fixtures assembled at runtime --------------------------
const FAKE_SK = ["sk", ""].join("-") + "T3BlbkFJ4xY9zQ2vW8nP1jL5kRgD7sM6cF0";
const FAKE_SK_ANT = ["sk", "ant", ""].join("-") + "api03Xy9zQ2vW8nP1jL5kRgD7sM6cF0hX3u";
const FAKE_GOOGLE = "AIza" + "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7";
const FAKE_AWS = "AKIA" + "IOSFODNN7EXAMPLE";
const FAKE_JWT =
  "Bearer ey" +
  ["J", "hbGciOiJIUzI1NiJ9"].join("") +
  "." +
  "eyJzdWIiOiIxMjM0In0" +
  "." +
  "dummysignature_abcDEF123";
const FAKE_PEM =
  "-----BEGIN RSA PRIVATE KEY-----\n" +
  "MIIEowIBAAKCAQEAfakekeymaterialnotreal\n" +
  "-----END RSA PRIVATE KEY-----";

describe("redactSecretShapes — per-shape redaction", () => {
  it("redacts an sk-prefixed API key", () => {
    const out = redactSecretShapes(`error: key ${FAKE_SK} rejected`);
    expect(out).toContain("[redacted]");
    expect(out).not.toContain(FAKE_SK);
  });

  it("redacts an sk-ant-prefixed API key", () => {
    const out = redactSecretShapes(`anthropic key ${FAKE_SK_ANT} invalid`);
    expect(out).toContain("[redacted]");
    expect(out).not.toContain(FAKE_SK_ANT);
  });

  it("redacts a Google AIza API key", () => {
    const out = redactSecretShapes(`google: ${FAKE_GOOGLE}`);
    expect(out).toContain("[redacted]");
    expect(out).not.toContain(FAKE_GOOGLE);
  });

  it("redacts an AWS AKIA access key id", () => {
    const out = redactSecretShapes(`aws creds ${FAKE_AWS} expired`);
    expect(out).toContain("[redacted]");
    expect(out).not.toContain(FAKE_AWS);
  });

  it("redacts a Bearer JWT", () => {
    const out = redactSecretShapes(`authorization: ${FAKE_JWT}`);
    expect(out).toContain("[redacted]");
    expect(out).not.toContain(FAKE_JWT);
  });

  it("redacts a PEM private-key block", () => {
    const out = redactSecretShapes(`config: ${FAKE_PEM} end`);
    expect(out).toContain("[redacted]");
    expect(out).not.toContain("PRIVATE KEY");
  });

  it("leaves a benign string untouched", () => {
    const benign = "LiteLLM upstream returned 500: model overloaded, retry later";
    expect(redactSecretShapes(benign)).toBe(benign);
  });

  it("redacts multiple secrets in one string", () => {
    const out = redactSecretShapes(`${FAKE_SK} and ${FAKE_AWS}`);
    expect(out).not.toContain(FAKE_SK);
    expect(out).not.toContain(FAKE_AWS);
    expect(out).toBe("[redacted] and [redacted]");
  });
});

describe("LitellmUpstreamError — redaction before truncation", () => {
  it("redacts a secret sitting in the first 200 chars of the body", () => {
    const body = `{"error":"bad key ${FAKE_SK} supplied"}`;
    const err = new LitellmUpstreamError(500, body);
    expect(err.message).toContain("[redacted]");
    expect(err.message).not.toContain(FAKE_SK);
  });

  it("redacts a secret in the optional message override", () => {
    const err = new LitellmUpstreamError(502, "benign body", `upstream said ${FAKE_AWS}`);
    expect(err.message).toContain("[redacted]");
    expect(err.message).not.toContain(FAKE_AWS);
  });
});
