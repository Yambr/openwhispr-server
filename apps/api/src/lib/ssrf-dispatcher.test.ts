// Phase 6 / Plan 06 / SCALE-04 — SSRF dispatcher unit suite (GREEN).
//
// Locked behaviors per D-S1..S6:
//   - Global undici Dispatcher with SSRF interceptor (setGlobalDispatcher
//     at bootstrap — covered by bootstrap.test.ts).
//   - Single-resolve-then-connect-by-IP closes DNS-rebinding TOCTOU (D-S2).
//   - Default-deny block-list per D-S3 (every CIDR enumerated below).
//   - Env-driven allow-list with *.wildcard support (D-S4).
//   - Violation → HTTP 502 + audit_log security.ssrf_blocked + WARN log (D-S5).
//   - OUTBOUND_SSRF_MODE=warn skips 502 but still logs+audits.
//   - OUTBOUND_ALLOW_LOOPBACK=1 + NODE_ENV != 'production' permits loopback (D-S6).
//
// We exercise the dispatcher's `lookup` hook directly via a synthetic
// resolve injection — no need to spin a TCP server for IP-level
// correctness. The undici Agent + connect.lookup contract is verified
// once (live api.openrouter.ai round-trip is exercised by the live e2e
// suite, gated on E2E=1).

import { describe, expect, it, vi } from "vitest";
import {
  BLOCKED_RANGES,
  checkBlocklist,
  hostMatches,
  makeSSRFConnectGuard,
  makeSSRFDispatcher,
  makeSSRFLookup,
  SSRFBlockedError,
} from "./ssrf-dispatcher.js";

/** Build the SSRF lookup function with a fake DNS resolver. */
function buildHarness(args: {
  allowedHosts?: string[];
  privateHostAllowlist?: string[];
  allowLoopback?: boolean;
  mode?: "enforce" | "warn";
  nodeEnv?: string;
  resolves?: Record<string, Array<{ address: string; family: 4 | 6 }>>;
  resolveImpl?: (h: string) => Promise<Array<{ address: string; family: 4 | 6 }>>;
}) {
  const onBlock = vi.fn();
  const map = args.resolves ?? {};
  const resolve =
    args.resolveImpl ??
    (async (h: string) => {
      const entry = map[h];
      if (!entry) throw new Error(`no fake resolve for ${h}`);
      return entry;
    });
  const lookup = makeSSRFLookup({
    allowedHosts: args.allowedHosts ?? [],
    privateHostAllowlist: args.privateHostAllowlist ?? [],
    allowLoopback: args.allowLoopback ?? false,
    mode: args.mode ?? "enforce",
    onBlock,
    resolve,
    ...(args.nodeEnv !== undefined ? { nodeEnv: args.nodeEnv } : {}),
  });
  return { lookup, onBlock, resolve };
}

/** Promisified wrapper around the lookup callback for ergonomic asserts. */
function callLookup(
  lookup: ReturnType<typeof import("./ssrf-dispatcher.js").makeSSRFLookup>,
  hostname: string,
): Promise<{ err: Error | null; address?: string; family?: number }> {
  return new Promise((resolve) => {
    lookup(hostname, {} as never, (err, address, family) => {
      const out: { err: Error | null; address?: string; family?: number } = { err };
      if (typeof address === "string") out.address = address;
      if (typeof family === "number") out.family = family;
      resolve(out);
    });
  });
}

describe("ssrf-dispatcher IPv4 default block-list (D-S3)", () => {
  it("blocks RFC1918 10.0.0.0/8 per D-S3", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["bad.example"],
      resolves: { "bad.example": [{ address: "10.1.2.3", family: 4 }] },
    });
    const { err } = await callLookup(lookup, "bad.example");
    expect(err).toBeInstanceOf(SSRFBlockedError);
    expect((err as SSRFBlockedError).rule).toBe("rfc1918_10");
  });

  it("blocks RFC1918 172.16.0.0/12 per D-S3", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["bad.example"],
      resolves: { "bad.example": [{ address: "172.20.5.10", family: 4 }] },
    });
    const { err } = await callLookup(lookup, "bad.example");
    expect((err as SSRFBlockedError).rule).toBe("rfc1918_172_16");
  });

  it("blocks RFC1918 192.168.0.0/16 per D-S3", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["bad.example"],
      resolves: { "bad.example": [{ address: "192.168.1.1", family: 4 }] },
    });
    const { err } = await callLookup(lookup, "bad.example");
    expect((err as SSRFBlockedError).rule).toBe("rfc1918_192_168");
  });

  it("blocks loopback 127.0.0.0/8 per D-S3", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["bad.example"],
      resolves: { "bad.example": [{ address: "127.0.0.1", family: 4 }] },
    });
    const { err } = await callLookup(lookup, "bad.example");
    expect((err as SSRFBlockedError).rule).toBe("loopback_v4");
  });

  it("blocks link-local 169.254.0.0/16 per D-S3", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["bad.example"],
      resolves: { "bad.example": [{ address: "169.254.1.1", family: 4 }] },
    });
    const { err } = await callLookup(lookup, "bad.example");
    expect((err as SSRFBlockedError).rule).toBe("link_local_v4");
  });

  it("blocks AWS IMDSv1 169.254.169.254 specifically (mandatory for AWS posture)", async () => {
    const { lookup, onBlock } = buildHarness({
      allowedHosts: ["metadata.aws"],
      resolves: { "metadata.aws": [{ address: "169.254.169.254", family: 4 }] },
    });
    const { err } = await callLookup(lookup, "metadata.aws");
    expect(err).toBeInstanceOf(SSRFBlockedError);
    expect((err as SSRFBlockedError).rule).toBe("link_local_v4");
    expect(onBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "metadata.aws",
        ip: "169.254.169.254",
        rule: "link_local_v4",
        mode: "enforce",
      }),
    );
  });

  it("blocks 0.0.0.0/8 per D-S3", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["bad.example"],
      resolves: { "bad.example": [{ address: "0.1.2.3", family: 4 }] },
    });
    const { err } = await callLookup(lookup, "bad.example");
    expect((err as SSRFBlockedError).rule).toBe("reserved_zero");
  });

  it("blocks CGNAT 100.64.0.0/10 per D-S3", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["bad.example"],
      resolves: { "bad.example": [{ address: "100.64.0.5", family: 4 }] },
    });
    const { err } = await callLookup(lookup, "bad.example");
    expect((err as SSRFBlockedError).rule).toBe("cgnat");
  });

  it("blocks multicast 224.0.0.0/4 per D-S3", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["bad.example"],
      resolves: { "bad.example": [{ address: "224.0.0.1", family: 4 }] },
    });
    const { err } = await callLookup(lookup, "bad.example");
    expect((err as SSRFBlockedError).rule).toBe("multicast_v4");
  });
});

describe("ssrf-dispatcher IPv6 default block-list (D-S3)", () => {
  it("blocks loopback ::1/128 per D-S3", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["bad.example"],
      resolves: { "bad.example": [{ address: "::1", family: 6 }] },
    });
    const { err } = await callLookup(lookup, "bad.example");
    expect((err as SSRFBlockedError).rule).toBe("loopback_v6");
  });

  it("blocks ULA fc00::/7 per D-S3", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["bad.example"],
      resolves: { "bad.example": [{ address: "fc00::1", family: 6 }] },
    });
    const { err } = await callLookup(lookup, "bad.example");
    expect((err as SSRFBlockedError).rule).toBe("ula_v6");
  });

  it("blocks link-local fe80::/10 per D-S3", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["bad.example"],
      resolves: { "bad.example": [{ address: "fe80::1", family: 6 }] },
    });
    const { err } = await callLookup(lookup, "bad.example");
    expect((err as SSRFBlockedError).rule).toBe("link_local_v6");
  });

  it("re-checks IPv4-mapped ::ffff:0:0/96 unwrapped (D-S3 — wrapper bypass)", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["bad.example"],
      resolves: { "bad.example": [{ address: "::ffff:10.0.0.1", family: 6 }] },
    });
    const { err } = await callLookup(lookup, "bad.example");
    // Unwrapped IPv4 falls inside 10.0.0.0/8 — rule is `rfc1918_10`,
    // proving the IPv4-mapped IPv6 bypass is closed.
    expect((err as SSRFBlockedError).rule).toBe("rfc1918_10");
  });

  it("blocks AWS IMDS IPv6 fd00:ec2::/32 per D-S3", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["bad.example"],
      resolves: { "bad.example": [{ address: "fd00:ec2::1", family: 6 }] },
    });
    const { err } = await callLookup(lookup, "bad.example");
    expect((err as SSRFBlockedError).rule).toBe("aws_imds_v6");
  });
});

describe("ssrf-dispatcher allow-list (D-S4)", () => {
  it("permits exact hostname match (e.g. openrouter.ai)", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["openrouter.ai"],
      resolves: { "openrouter.ai": [{ address: "104.18.0.1", family: 4 }] },
    });
    const { err, address } = await callLookup(lookup, "openrouter.ai");
    expect(err).toBeNull();
    expect(address).toBe("104.18.0.1");
  });

  it("permits wildcard *.amazonaws.com against s3.amazonaws.com (multi-label)", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["*.amazonaws.com"],
      resolves: {
        "s3.amazonaws.com": [{ address: "52.216.0.5", family: 4 }],
        "bucket.s3.amazonaws.com": [{ address: "52.216.0.6", family: 4 }],
      },
    });
    const r1 = await callLookup(lookup, "s3.amazonaws.com");
    expect(r1.err).toBeNull();
    const r2 = await callLookup(lookup, "bucket.s3.amazonaws.com");
    expect(r2.err).toBeNull();
  });

  it("rejects bare `amazonaws.com` against `*.amazonaws.com` (requires ≥1 left label)", () => {
    expect(hostMatches("amazonaws.com", ["*.amazonaws.com"])).toBe(false);
  });

  it("rejects host not in OUTBOUND_ALLOWED_HOSTS", async () => {
    const { lookup, onBlock } = buildHarness({
      allowedHosts: ["openrouter.ai"],
      resolves: { "evil.example": [{ address: "1.2.3.4", family: 4 }] },
    });
    const { err } = await callLookup(lookup, "evil.example");
    expect(err).toBeInstanceOf(SSRFBlockedError);
    expect((err as SSRFBlockedError).rule).toBe("host_not_allowed");
    expect(onBlock).toHaveBeenCalledWith(
      expect.objectContaining({ rule: "host_not_allowed", host: "evil.example" }),
    );
  });

  it("permits OUTBOUND_PRIVATE_HOST_ALLOWLIST (compose service names) to resolve to RFC1918", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["litellm"],
      privateHostAllowlist: ["litellm"],
      resolves: { litellm: [{ address: "172.18.0.5", family: 4 }] },
    });
    const { err, address } = await callLookup(lookup, "litellm");
    expect(err).toBeNull();
    expect(address).toBe("172.18.0.5");
  });

  it("default-deny: empty allow-list rejects every hostname", () => {
    expect(hostMatches("anything", [])).toBe(false);
  });

  it("trailing-dot FQDN (`evil.example.`) normalises to bare form for matching", () => {
    expect(hostMatches("openrouter.ai.", ["openrouter.ai"])).toBe(true);
  });
});

describe("ssrf-dispatcher single-resolve TOCTOU close (D-S2)", () => {
  it("performs single DNS resolve then connects by resolved IP (no re-resolve)", async () => {
    const resolve = vi.fn(async () => [{ address: "104.18.0.1", family: 4 as const }]);
    const { lookup } = buildHarness({
      allowedHosts: ["openrouter.ai"],
      resolveImpl: resolve,
    });
    await callLookup(lookup, "openrouter.ai");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("openrouter.ai");
  });

  it("when invoked with {all:true} returns the full address array (net.connect contract)", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["openrouter.ai"],
      resolves: {
        "openrouter.ai": [
          { address: "104.18.0.1", family: 4 },
          { address: "104.18.0.2", family: 4 },
        ],
      },
    });
    const result = await new Promise<{
      err: Error | null;
      out?: Array<{ address: string; family: number }>;
    }>((res) => {
      lookup(
        "openrouter.ai",
        { all: true } as unknown as Record<string, unknown>,
        (err: Error | null, addrOrList?: unknown) => {
          res({ err, out: addrOrList as Array<{ address: string; family: number }> });
        },
      );
    });
    expect(result.err).toBeNull();
    expect(result.out).toEqual([
      { address: "104.18.0.1", family: 4 },
      { address: "104.18.0.2", family: 4 },
    ]);
  });

  it("returns the first resolved address — undici connects by IP, preserves Host:/SNI", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["openrouter.ai"],
      resolves: {
        "openrouter.ai": [
          { address: "104.18.0.1", family: 4 },
          { address: "104.18.0.2", family: 4 },
        ],
      },
    });
    const { address, family } = await callLookup(lookup, "openrouter.ai");
    expect(address).toBe("104.18.0.1");
    expect(family).toBe(4);
  });

  it("rejects when ANY resolved IP matches the block-list (multi-A-record DNS rebinding)", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["mixed.example"],
      resolves: {
        // First clean, second blocked — the lookup MUST reject because
        // undici might otherwise round-robin onto the malicious A record.
        "mixed.example": [
          { address: "1.2.3.4", family: 4 },
          { address: "10.0.0.5", family: 4 },
        ],
      },
    });
    const { err } = await callLookup(lookup, "mixed.example");
    expect((err as SSRFBlockedError).rule).toBe("rfc1918_10");
  });

  it("rejects when DNS resolves to zero addresses (defensive)", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["empty.example"],
      resolveImpl: async () => [],
    });
    const { err } = await callLookup(lookup, "empty.example");
    expect((err as SSRFBlockedError).rule).toBe("dns_empty");
  });

  it("propagates a DNS resolution failure to the connect callback", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["err.example"],
      resolveImpl: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    const { err } = await callLookup(lookup, "err.example");
    expect(err).not.toBeNull();
    expect(err?.message).toMatch(/ENOTFOUND/);
  });
});

describe("ssrf-dispatcher modes + violation response (D-S5, D-S6)", () => {
  it("OUTBOUND_SSRF_MODE=enforce: returns SSRFBlockedError on block (caller maps to 502)", async () => {
    const { lookup } = buildHarness({
      mode: "enforce",
      allowedHosts: ["bad.example"],
      resolves: { "bad.example": [{ address: "10.0.0.1", family: 4 }] },
    });
    const { err } = await callLookup(lookup, "bad.example");
    expect(err).toBeInstanceOf(SSRFBlockedError);
  });

  it("OUTBOUND_SSRF_MODE=warn: does NOT reject but emits WARN+audit ctx with mode='warn'", async () => {
    const { lookup, onBlock } = buildHarness({
      mode: "warn",
      allowedHosts: ["bad.example"],
      resolves: { "bad.example": [{ address: "10.0.0.1", family: 4 }] },
    });
    const { err, address } = await callLookup(lookup, "bad.example");
    expect(err).toBeNull();
    expect(address).toBe("10.0.0.1");
    expect(onBlock).toHaveBeenCalledWith(expect.objectContaining({ mode: "warn" }));
  });

  it("emits onBlock with action-shaped payload matching audit_log security.ssrf_blocked (D-A6 #18)", async () => {
    const { lookup, onBlock } = buildHarness({
      allowedHosts: ["bad.example"],
      resolves: { "bad.example": [{ address: "169.254.169.254", family: 4 }] },
    });
    await callLookup(lookup, "bad.example");
    expect(onBlock).toHaveBeenCalledWith({
      host: "bad.example",
      ip: "169.254.169.254",
      rule: "link_local_v4",
      mode: "enforce",
    });
  });

  it("OUTBOUND_ALLOW_LOOPBACK=1 + NODE_ENV != 'production': permits 127.0.0.1 / ::1", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["local.dev"],
      allowLoopback: true,
      nodeEnv: "test",
      resolves: { "local.dev": [{ address: "127.0.0.1", family: 4 }] },
    });
    const { err, address } = await callLookup(lookup, "local.dev");
    expect(err).toBeNull();
    expect(address).toBe("127.0.0.1");
  });

  it("OUTBOUND_ALLOW_LOOPBACK=1 + NODE_ENV='production': STILL blocks 127.0.0.1 (D-S6)", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["local.dev"],
      allowLoopback: true,
      nodeEnv: "production",
      resolves: { "local.dev": [{ address: "127.0.0.1", family: 4 }] },
    });
    const { err } = await callLookup(lookup, "local.dev");
    expect((err as SSRFBlockedError).rule).toBe("loopback_v4");
  });

  it("allowLoopback also permits ::1 when NODE_ENV != 'production'", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["local.dev"],
      allowLoopback: true,
      nodeEnv: "test",
      resolves: { "local.dev": [{ address: "::1", family: 6 }] },
    });
    const { err } = await callLookup(lookup, "local.dev");
    expect(err).toBeNull();
  });

  it("allowLoopback does NOT relax other ranges (10/8 still blocked under loopback opt-in)", async () => {
    const { lookup } = buildHarness({
      allowedHosts: ["leak.example"],
      allowLoopback: true,
      nodeEnv: "test",
      resolves: { "leak.example": [{ address: "10.0.0.1", family: 4 }] },
    });
    const { err } = await callLookup(lookup, "leak.example");
    expect((err as SSRFBlockedError).rule).toBe("rfc1918_10");
  });
});

describe("ssrf-dispatcher edge-case parsing", () => {
  it("unparseable address string is treated as blocked", () => {
    expect(checkBlocklist("not-an-ip", 4, { allowLoopback: false })).toBe("unparseable");
  });

  it("public IPv4 (8.8.8.8) passes the block-list cleanly", () => {
    expect(checkBlocklist("8.8.8.8", 4, { allowLoopback: false })).toBeNull();
  });

  it("public IPv6 (2001:db8::1) passes the block-list cleanly", () => {
    expect(checkBlocklist("2001:db8::1", 6, { allowLoopback: false })).toBeNull();
  });

  it("IPv4-mapped IPv6 over a clean IPv4 (::ffff:8.8.8.8) flags mapped_v4 (bypass attempt)", () => {
    expect(checkBlocklist("::ffff:8.8.8.8", 6, { allowLoopback: false })).toBe("mapped_v4");
  });

  it("IPv4-mapped IPv6 unwrap honors allowLoopback for 127.x", () => {
    expect(checkBlocklist("::ffff:127.0.0.1", 6, { allowLoopback: true, nodeEnv: "test" })).toBe(
      "mapped_v4",
    );
  });

  it("SSRFBlockedError carries rule, host, and optional ip", () => {
    const err = new SSRFBlockedError("rfc1918_10", "bad.example", "10.0.0.1");
    expect(err.code).toBe("SSRF_BLOCKED");
    expect(err.rule).toBe("rfc1918_10");
    expect(err.host).toBe("bad.example");
    expect(err.ip).toBe("10.0.0.1");
    expect(err.name).toBe("SSRFBlockedError");
  });

  it("SSRFBlockedError without ip omits the field", () => {
    const err = new SSRFBlockedError("host_not_allowed", "evil.example");
    expect(err.ip).toBeUndefined();
  });

  it("BLOCKED_RANGES exports exactly 13 entries (8 IPv4 + 5 IPv6) per D-S3", () => {
    expect(BLOCKED_RANGES).toHaveLength(13);
    expect(BLOCKED_RANGES.filter((r) => r.family === 4)).toHaveLength(8);
    expect(BLOCKED_RANGES.filter((r) => r.family === 6)).toHaveLength(5);
  });

  it("audit callback failure does not crash the lookup pipeline", async () => {
    const onBlock = vi.fn().mockImplementation(() => {
      throw new Error("audit-down");
    });
    const lookup = makeSSRFLookup({
      allowedHosts: ["bad.example"],
      privateHostAllowlist: [],
      allowLoopback: false,
      mode: "enforce",
      onBlock,
      resolve: async () => [{ address: "10.0.0.1", family: 4 }],
    });
    const result = await new Promise<{ err: Error | null }>((res) => {
      lookup("bad.example", {}, (err) => res({ err }));
    });
    expect(result.err).toBeInstanceOf(SSRFBlockedError);
    expect(onBlock).toHaveBeenCalled();
  });

  it("audit callback failure during host_not_allowed does not crash the dispatcher", async () => {
    const onBlock = vi.fn().mockImplementation(() => {
      throw new Error("audit-down");
    });
    const lookup = makeSSRFLookup({
      allowedHosts: ["only.allowed"],
      privateHostAllowlist: [],
      allowLoopback: false,
      mode: "enforce",
      onBlock,
      resolve: async () => [],
    });
    const result = await new Promise<{ err: Error | null }>((res) => {
      lookup("evil.example", {}, (err) => res({ err }));
    });
    expect(result.err).toBeInstanceOf(SSRFBlockedError);
    expect((result.err as SSRFBlockedError).rule).toBe("host_not_allowed");
  });

  // Phase 6 / Plan 06-12e — IP-literal bypass guard (D-S3 enforcement
  // gap). Node's `net.connect({ host, lookup })` SKIPS the `lookup`
  // callback entirely when `host` is already an IP literal (verified in
  // Node 24 via direct probe). That bypasses the SSRF dispatcher's
  // lookup-installed allow/block-list and lets `fetch('http://10.0.0.1')`
  // hit RFC1918 unfettered. The fix: a connect-level guard that runs
  // the allow-list + block-list against the literal hostname BEFORE
  // delegating to undici's default connector. The lookup hook still
  // covers hostname resolution; the guard covers the literal path.
  describe("ssrf-dispatcher IP-literal connect guard (D-S3, Plan 06-12e)", () => {
    it("rejects literal RFC1918 10.0.0.1 even though Node's net.connect skips lookup for IP literals", async () => {
      const onBlock = vi.fn();
      const guard = makeSSRFConnectGuard({
        allowedHosts: ["10.0.0.1"], // even with the literal allow-listed,
        privateHostAllowlist: [],
        allowLoopback: false,
        mode: "enforce",
        onBlock,
      });
      const err = guard({ hostname: "10.0.0.1" } as never);
      expect(err).toBeInstanceOf(SSRFBlockedError);
      expect((err as SSRFBlockedError).rule).toBe("rfc1918_10");
      expect(onBlock).toHaveBeenCalled();
    });

    it("rejects literal AWS IMDS 169.254.169.254 via link_local_v4 (the canonical exploit)", async () => {
      const onBlock = vi.fn();
      const guard = makeSSRFConnectGuard({
        allowedHosts: ["169.254.169.254"], // listed by mistake; literal must STILL block
        privateHostAllowlist: [],
        allowLoopback: false,
        mode: "enforce",
        onBlock,
      });
      const err = guard({ hostname: "169.254.169.254" } as never);
      expect(err).toBeInstanceOf(SSRFBlockedError);
      expect((err as SSRFBlockedError).rule).toBe("link_local_v4");
    });

    it("rejects literal IPv6 ULA fd00::1 via ula_v6", async () => {
      const onBlock = vi.fn();
      const guard = makeSSRFConnectGuard({
        allowedHosts: ["fd00::1"],
        privateHostAllowlist: [],
        allowLoopback: false,
        mode: "enforce",
        onBlock,
      });
      const err = guard({ hostname: "fd00::1" } as never);
      expect(err).toBeInstanceOf(SSRFBlockedError);
      expect((err as SSRFBlockedError).rule).toBe("ula_v6");
    });

    it("rejects literal IP when hostname is not in allow-list (host_not_allowed before block-list)", async () => {
      const onBlock = vi.fn();
      const guard = makeSSRFConnectGuard({
        allowedHosts: ["openrouter.ai"],
        privateHostAllowlist: [],
        allowLoopback: false,
        mode: "enforce",
        onBlock,
      });
      const err = guard({ hostname: "10.0.0.1" } as never);
      expect(err).toBeInstanceOf(SSRFBlockedError);
      // host_not_allowed fires first (default-deny); block-list is the
      // fallback when allow-list passes.  Order matches makeSSRFLookup.
      expect((err as SSRFBlockedError).rule).toBe("host_not_allowed");
    });

    it("permits literal IP when host is in privateHostAllowlist (e.g. docker bridge)", async () => {
      const onBlock = vi.fn();
      const guard = makeSSRFConnectGuard({
        allowedHosts: ["10.0.0.5"],
        privateHostAllowlist: ["10.0.0.5"],
        allowLoopback: false,
        mode: "enforce",
        onBlock,
      });
      const err = guard({ hostname: "10.0.0.5" } as never);
      expect(err).toBeNull();
      expect(onBlock).not.toHaveBeenCalled();
    });

    it("passes through non-IP-literal hostnames untouched (lookup handles them)", async () => {
      const guard = makeSSRFConnectGuard({
        allowedHosts: ["openrouter.ai"],
        privateHostAllowlist: [],
        allowLoopback: false,
        mode: "enforce",
        onBlock: vi.fn(),
      });
      // Hostname is not an IP literal — guard MUST return null and
      // defer to the lookup-installed path for the SSRF check.
      const err = guard({ hostname: "openrouter.ai" } as never);
      expect(err).toBeNull();
    });

    it("warn-mode emits onBlock for a literal RFC1918 but does NOT reject", async () => {
      const onBlock = vi.fn();
      const guard = makeSSRFConnectGuard({
        allowedHosts: ["10.0.0.1"],
        privateHostAllowlist: [],
        allowLoopback: false,
        mode: "warn",
        onBlock,
      });
      const err = guard({ hostname: "10.0.0.1" } as never);
      // warn-mode: observed but allowed through (matches lookup posture D-S5).
      expect(err).toBeNull();
      expect(onBlock).toHaveBeenCalled();
      const ctx = onBlock.mock.calls[0]?.[0];
      expect(ctx.rule).toBe("rfc1918_10");
      expect(ctx.mode).toBe("warn");
    });

    it("D-S6 — loopback literal 127.0.0.1 honoured by allowLoopback + non-production NODE_ENV", async () => {
      const onBlock = vi.fn();
      const guard = makeSSRFConnectGuard({
        allowedHosts: ["127.0.0.1"],
        privateHostAllowlist: [],
        allowLoopback: true,
        mode: "enforce",
        nodeEnv: "test",
        onBlock,
      });
      const err = guard({ hostname: "127.0.0.1" } as never);
      expect(err).toBeNull();
    });

    it("D-S6 — loopback literal 127.0.0.1 STILL blocked when NODE_ENV=production even with allowLoopback", async () => {
      const onBlock = vi.fn();
      const guard = makeSSRFConnectGuard({
        allowedHosts: ["127.0.0.1"],
        privateHostAllowlist: [],
        allowLoopback: true,
        mode: "enforce",
        nodeEnv: "production",
        onBlock,
      });
      const err = guard({ hostname: "127.0.0.1" } as never);
      expect(err).toBeInstanceOf(SSRFBlockedError);
      expect((err as SSRFBlockedError).rule).toBe("loopback_v4");
    });
  });

  it("makeSSRFDispatcher returns a Dispatcher with the SSRF lookup installed", () => {
    const d = makeSSRFDispatcher({
      allowedHosts: ["any"],
      privateHostAllowlist: [],
      allowLoopback: false,
      mode: "enforce",
      onBlock: () => {},
      resolve: async () => [],
    });
    // The dispatcher is an undici Agent (concrete instance), enough to
    // confirm composition; behaviors are pinned via makeSSRFLookup above.
    expect(d).toBeDefined();
    expect(typeof (d as { dispatch?: unknown }).dispatch).toBe("function");
  });
});
