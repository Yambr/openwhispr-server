// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-09 per 06-VALIDATION.md.
//
// Production module (not yet created): apps/api/src/lib/ssrf-dispatcher.ts
//
// Behaviors locked by D-S1..D-S6:
//   - Global undici Dispatcher with SSRF interceptor (setGlobalDispatcher at bootstrap)
//   - Single-resolve-then-connect-by-IP closes DNS-rebinding TOCTOU (D-S2)
//   - Default-deny block-list per D-S3 (every CIDR enumerated below)
//   - Env-driven allow-list with *.wildcard support (D-S4)
//   - Violation -> HTTP 502 + audit_log security.ssrf_blocked + WARN log (D-S5)
//   - OUTBOUND_SSRF_MODE=warn skips 502 but still logs+audits
//   - OUTBOUND_ALLOW_LOOPBACK=1 + NODE_ENV!=production permits loopback (D-S6)
import { describe, it } from "vitest";

const NOT_YET =
  "not yet implemented — Plan 06-09 implements apps/api/src/lib/ssrf-dispatcher.ts (D-S1..S6)";

describe("ssrf-dispatcher IPv4 default block-list (D-S3)", () => {
  it("blocks RFC1918 10.0.0.0/8 per D-S3", () => {
    throw new Error(NOT_YET);
  });

  it("blocks RFC1918 172.16.0.0/12 per D-S3", () => {
    throw new Error(NOT_YET);
  });

  it("blocks RFC1918 192.168.0.0/16 per D-S3", () => {
    throw new Error(NOT_YET);
  });

  it("blocks loopback 127.0.0.0/8 per D-S3", () => {
    throw new Error(NOT_YET);
  });

  it("blocks link-local 169.254.0.0/16 per D-S3", () => {
    throw new Error(NOT_YET);
  });

  it("blocks AWS IMDSv1 169.254.169.254 specifically (mandatory for AWS posture)", () => {
    throw new Error(NOT_YET);
  });

  it("blocks 0.0.0.0/8 per D-S3", () => {
    throw new Error(NOT_YET);
  });

  it("blocks CGNAT 100.64.0.0/10 per D-S3", () => {
    throw new Error(NOT_YET);
  });

  it("blocks multicast 224.0.0.0/4 per D-S3", () => {
    throw new Error(NOT_YET);
  });
});

describe("ssrf-dispatcher IPv6 default block-list (D-S3)", () => {
  it("blocks loopback ::1/128 per D-S3", () => {
    throw new Error(NOT_YET);
  });

  it("blocks ULA fc00::/7 per D-S3", () => {
    throw new Error(NOT_YET);
  });

  it("blocks link-local fe80::/10 per D-S3", () => {
    throw new Error(NOT_YET);
  });

  it("re-checks IPv4-mapped ::ffff:0:0/96 unwrapped (D-S3 — wrapper bypass)", () => {
    throw new Error(NOT_YET);
  });

  it("blocks AWS IMDS IPv6 fd00:ec2::/32 per D-S3", () => {
    throw new Error(NOT_YET);
  });
});

describe("ssrf-dispatcher allow-list (D-S4)", () => {
  it("permits exact hostname match (e.g. openrouter.ai)", () => {
    throw new Error(NOT_YET);
  });

  it("permits wildcard *.amazonaws.com against s3.amazonaws.com", () => {
    throw new Error(NOT_YET);
  });

  it("rejects host not in OUTBOUND_ALLOWED_HOSTS", () => {
    throw new Error(NOT_YET);
  });

  it("permits OUTBOUND_PRIVATE_HOST_ALLOWLIST (docker-compose service names) to resolve to RFC1918", () => {
    throw new Error(NOT_YET);
  });
});

describe("ssrf-dispatcher single-resolve TOCTOU close (D-S2)", () => {
  it("performs single DNS resolve then connects by resolved IP (no re-resolve)", () => {
    throw new Error(NOT_YET);
  });

  it("preserves original Host header for TLS SNI + virtual hosting", () => {
    throw new Error(NOT_YET);
  });

  it("rejects when ANY resolved IP matches the block-list", () => {
    throw new Error(NOT_YET);
  });
});

describe("ssrf-dispatcher modes + violation response (D-S5, D-S6)", () => {
  it("OUTBOUND_SSRF_MODE=enforce: returns HTTP 502 envelope on block", () => {
    throw new Error(NOT_YET);
  });

  it("OUTBOUND_SSRF_MODE=warn: does NOT 502 but emits WARN log + audit row", () => {
    throw new Error(NOT_YET);
  });

  it("emits audit_log row with action=security.ssrf_blocked (matches D-A6 #18)", () => {
    throw new Error(NOT_YET);
  });

  it("OUTBOUND_ALLOW_LOOPBACK=1 + NODE_ENV!=production: permits 127.0.0.1 / ::1", () => {
    throw new Error(NOT_YET);
  });
});
