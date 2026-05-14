// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 01 / Task 1 — RED tests for the channel-scheme allow-list.
// Source of truth: 02-RESEARCH-AUTH.md § Channel-Scheme Allow-List.
//
// Why uppercase is rejected: every legitimate channel scheme we ship is
// all-lowercase; rejecting uppercase is stricter than RFC 3986 § 3.1
// (which is case-insensitive) without losing any real caller.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildProtocolRedirect, validateScheme } from "../../../src/lib/scheme-allowlist.js";

describe("validateScheme — rejection paths", () => {
  const original = process.env.OPENWHISPR_PROTOCOL;
  beforeEach(() => {
    process.env.OPENWHISPR_PROTOCOL = undefined;
    delete process.env.OPENWHISPR_PROTOCOL;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.OPENWHISPR_PROTOCOL;
    else process.env.OPENWHISPR_PROTOCOL = original;
  });

  it("rejects empty string", () => {
    const r = validateScheme("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty/);
  });

  it("rejects undefined", () => {
    const r = validateScheme(undefined);
    expect(r.ok).toBe(false);
  });

  it("rejects null", () => {
    const r = validateScheme(null);
    expect(r.ok).toBe(false);
  });

  it("rejects scheme exceeding 32 chars", () => {
    const r = validateScheme("a".repeat(33));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/32/);
  });

  it("accepts scheme exactly at the 32-char boundary if otherwise legal (with override)", () => {
    process.env.OPENWHISPR_PROTOCOL = "a".repeat(32);
    const r = validateScheme("a".repeat(32));
    expect(r.ok).toBe(true);
  });

  it("rejects control characters (newline)", () => {
    const r = validateScheme("openwhispr\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/control/);
  });

  it("rejects control characters (tab)", () => {
    const r = validateScheme("open\twhispr");
    expect(r.ok).toBe(false);
  });

  it("rejects DEL (0x7f)", () => {
    const r = validateScheme(`openwhispr${String.fromCharCode(0x7f)}`);
    expect(r.ok).toBe(false);
  });

  it("rejects scheme with non-RFC-3986 characters (underscore)", () => {
    const r = validateScheme("open_whispr");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/RFC 3986/);
  });

  it("rejects scheme starting with a digit", () => {
    const r = validateScheme("1openwhispr");
    expect(r.ok).toBe(false);
  });

  it.each([
    "javascript",
    "data",
    "file",
    "vbscript",
    "about",
    "chrome",
    "chrome-extension",
  ])("rejects dangerous scheme: %s", (s) => {
    const r = validateScheme(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/deny-list/);
  });

  it("rejects ms- prefixed schemes (ms-appx)", () => {
    const r = validateScheme("ms-appx");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/ms-/);
  });

  it("rejects ms- prefixed schemes (ms-windows-store)", () => {
    const r = validateScheme("ms-windows-store");
    expect(r.ok).toBe(false);
  });

  it("rejects uppercase scheme even though RFC 3986 permits it", () => {
    const r = validateScheme("Openwhispr");
    expect(r.ok).toBe(false);
  });

  it("rejects fully-uppercase JavaScript bypass attempt", () => {
    const r = validateScheme("JAVASCRIPT");
    expect(r.ok).toBe(false);
  });

  it("rejects custom scheme without env override", () => {
    const r = validateScheme("mycorp-whispr");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/allow-list/);
  });
});

describe("validateScheme — accept paths", () => {
  const original = process.env.OPENWHISPR_PROTOCOL;
  beforeEach(() => {
    delete process.env.OPENWHISPR_PROTOCOL;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.OPENWHISPR_PROTOCOL;
    else process.env.OPENWHISPR_PROTOCOL = original;
  });

  it.each([
    "openwhispr",
    "openwhispr-dev",
    "openwhispr-staging",
  ])("accepts builtin scheme: %s", (s) => {
    const r = validateScheme(s);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scheme).toBe(s);
  });

  it("accepts a custom scheme via OPENWHISPR_PROTOCOL override", () => {
    process.env.OPENWHISPR_PROTOCOL = "mycorp-whispr";
    const r = validateScheme("mycorp-whispr");
    expect(r.ok).toBe(true);
  });

  it("trims whitespace in the env override before adding to allow-list", () => {
    process.env.OPENWHISPR_PROTOCOL = "  acme-app  ";
    const r = validateScheme("acme-app");
    expect(r.ok).toBe(true);
  });

  it("does not add an empty/whitespace-only override to the allow-list", () => {
    process.env.OPENWHISPR_PROTOCOL = "   ";
    const r = validateScheme("openwhispr-staging");
    // Builtin still works
    expect(r.ok).toBe(true);
    // But arbitrary custom does not
    expect(validateScheme("anything").ok).toBe(false);
  });

  // Phase 02.17 / D-01 + D-03 — OPENWHISPR_PROTOCOL accepts comma-list
  it("accepts comma-separated list of custom schemes (D-01)", () => {
    process.env.OPENWHISPR_PROTOCOL = "foo-scheme,bar-scheme";
    expect(validateScheme("foo-scheme").ok).toBe(true);
    expect(validateScheme("bar-scheme").ok).toBe(true);
    // Unrelated custom still rejected
    expect(validateScheme("baz-scheme").ok).toBe(false);
  });

  it("trims whitespace around each entry in comma-list", () => {
    process.env.OPENWHISPR_PROTOCOL = "  foo-scheme , bar-scheme  ";
    expect(validateScheme("foo-scheme").ok).toBe(true);
    expect(validateScheme("bar-scheme").ok).toBe(true);
  });

  it("ignores empty segments in comma-list (e.g. trailing comma)", () => {
    process.env.OPENWHISPR_PROTOCOL = "foo-scheme,,";
    expect(validateScheme("foo-scheme").ok).toBe(true);
    // Builtin still works alongside comma-list
    expect(validateScheme("openwhispr").ok).toBe(true);
  });

  it("comma-list coexists with builtin schemes", () => {
    process.env.OPENWHISPR_PROTOCOL = "mycorp-whispr,acme-app";
    expect(validateScheme("openwhispr").ok).toBe(true);
    expect(validateScheme("openwhispr-dev").ok).toBe(true);
    expect(validateScheme("mycorp-whispr").ok).toBe(true);
    expect(validateScheme("acme-app").ok).toBe(true);
  });
});

describe("buildProtocolRedirect", () => {
  it("encodes the bearer token via encodeURIComponent (handles + / =)", () => {
    expect(buildProtocolRedirect("openwhispr", "abc+/=")).toBe(
      "openwhispr://?bearer_token=abc%2B%2F%3D",
    );
  });

  it("preserves the scheme verbatim", () => {
    expect(buildProtocolRedirect("openwhispr-dev", "tk")).toBe("openwhispr-dev://?bearer_token=tk");
  });

  it("encodes ASCII-safe tokens as-is", () => {
    expect(buildProtocolRedirect("openwhispr", "abc-_123")).toBe(
      "openwhispr://?bearer_token=abc-_123",
    );
  });
});
