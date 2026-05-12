// Phase 08 / Plan 02 — Task 2 RED: HTTP utility constants.
//
// The k6 flow files (Wave 2) consume these constants; pinning them here
// prevents accidental drift (e.g., someone hardcoding "http://localhost:3000"
// inside a flow).
import { describe, expect, it } from "vitest";

import { BASE_URL, DEFAULT_HEADERS, INSECURE_SKIP_TLS_VERIFY } from "./http.js";

describe("utils/http", () => {
  it("BASE_URL points at the Traefik surface from Phase 07.1", () => {
    expect(BASE_URL).toBe("https://api.localhost");
  });

  it("DEFAULT_HEADERS sets JSON content-type and a k6 User-Agent", () => {
    expect(DEFAULT_HEADERS["content-type"]).toBe("application/json");
    expect(DEFAULT_HEADERS["user-agent"]).toMatch(/k6/i);
    expect(DEFAULT_HEADERS["user-agent"]).toMatch(/openwhispr/i);
  });

  it("INSECURE_SKIP_TLS_VERIFY defaults to true so the self-signed Traefik cert works", () => {
    // The single-host self-host quickstart uses ACME against localhost,
    // which yields a self-signed cert k6 cannot validate by default.
    expect(INSECURE_SKIP_TLS_VERIFY).toBe(true);
  });
});
