// Phase 6 / Plan 06 / SCALE-04 — process-wide SSRF dispatcher (D-S1..S6).
//
// Wraps undici's Agent with a `connect.lookup` hook that:
//   1. Gates hostname against OUTBOUND_ALLOWED_HOSTS (default-deny).
//   2. Performs a SINGLE dns.lookup({all:true}) — closes the DNS-rebinding
//      TOCTOU window because undici connects by the IP we hand back, NOT
//      by re-resolving the hostname.
//   3. Validates every resolved IP against the 13-entry default block-list
//      (8 IPv4 + 5 IPv6) per D-S3 — RFC1918 + loopback + link-local
//      (including AWS IMDSv1 169.254.169.254) + IPv6 ULA + AWS IMDS v6.
//   4. Honors OUTBOUND_PRIVATE_HOST_ALLOWLIST (docker-compose service
//      names allowed to resolve to RFC1918) and OUTBOUND_ALLOW_LOOPBACK
//      (gated on NODE_ENV != 'production', D-S6).
//   5. On block: enforce ⇒ rejects connect with SSRFBlockedError (caught
//      by global error handler → 502 envelope). warn ⇒ logs + audits but
//      proceeds (payload.mode='warn', D-S5).
//   6. Preserves TLS SNI + virtual hosting via undici's native
//      `servername` derivation from the URL (we only override the lookup,
//      not the host header).
//
// Reference for the CIDR list: D-S3 of 06-CONTEXT.md (re-derived from
// `request-filtering-agent`'s canonical list).

import { lookup as dnsLookupCb, type LookupAddress } from "node:dns";
import { promisify } from "node:util";
import ipaddr from "ipaddr.js";
import { Agent, type Dispatcher } from "undici";

const dnsLookup = promisify(dnsLookupCb);

/** Result emitted to the onBlock callback (D-S5 audit payload). */
export interface SSRFBlockContext {
  host: string;
  ip: string | null;
  rule: string;
  mode: "enforce" | "warn";
}

export interface SSRFOptions {
  /** OUTBOUND_ALLOWED_HOSTS (default-deny). */
  allowedHosts: string[];
  /** OUTBOUND_PRIVATE_HOST_ALLOWLIST — bypass block-list for these hosts. */
  privateHostAllowlist: string[];
  /** OUTBOUND_ALLOW_LOOPBACK — gated on NODE_ENV != 'production'. */
  allowLoopback: boolean;
  /** OUTBOUND_SSRF_MODE — enforce blocks, warn logs+audits but proceeds. */
  mode: "enforce" | "warn";
  /** Audit hook invoked for every block (enforce + warn). */
  onBlock: (ctx: SSRFBlockContext) => void;
  /**
   * Injected for tests — overrides node:dns lookup. Defaults to
   * `node:dns.lookup` promisified. Production code does NOT pass this.
   */
  resolve?: (hostname: string) => Promise<LookupAddress[]>;
  /**
   * Injected for tests — overrides the NODE_ENV check used by D-S6.
   * Defaults to `process.env.NODE_ENV`.
   */
  nodeEnv?: string;
}

/** Thrown into undici's connect callback when a request is blocked. */
export class SSRFBlockedError extends Error {
  public readonly code = "SSRF_BLOCKED";
  public readonly rule: string;
  public readonly host: string;
  public readonly ip?: string;
  constructor(rule: string, host: string, ip?: string) {
    super(`Outbound blocked by SSRF policy (${rule}; host=${host}${ip ? `; ip=${ip}` : ""})`);
    this.name = "SSRFBlockedError";
    this.rule = rule;
    this.host = host;
    if (ip !== undefined) this.ip = ip;
  }
}

interface BlockRule {
  name: string;
  cidr: string;
  family: 4 | 6;
}

/**
 * D-S3 canonical block-list — 13 entries (8 IPv4 + 5 IPv6). DO NOT
 * reorder; the test matrix in ssrf-dispatcher.test.ts asserts per-rule
 * coverage by `rule` name.
 */
export const BLOCKED_RANGES: readonly BlockRule[] = [
  // IPv4
  { name: "rfc1918_10", cidr: "10.0.0.0/8", family: 4 },
  { name: "rfc1918_172_16", cidr: "172.16.0.0/12", family: 4 },
  { name: "rfc1918_192_168", cidr: "192.168.0.0/16", family: 4 },
  { name: "loopback_v4", cidr: "127.0.0.0/8", family: 4 },
  { name: "link_local_v4", cidr: "169.254.0.0/16", family: 4 }, // incl. AWS IMDS 169.254.169.254
  { name: "reserved_zero", cidr: "0.0.0.0/8", family: 4 },
  { name: "cgnat", cidr: "100.64.0.0/10", family: 4 },
  { name: "multicast_v4", cidr: "224.0.0.0/4", family: 4 },
  // IPv6 — order matters: more-specific CIDRs first (aws_imds_v6 is a
  // subset of ula_v6 fc00::/7, so it must match first to be reported).
  { name: "loopback_v6", cidr: "::1/128", family: 6 },
  { name: "aws_imds_v6", cidr: "fd00:ec2::/32", family: 6 },
  { name: "ula_v6", cidr: "fc00::/7", family: 6 },
  { name: "link_local_v6", cidr: "fe80::/10", family: 6 },
  { name: "mapped_v4", cidr: "::ffff:0:0/96", family: 6 }, // re-check unwrapped IPv4
] as const;

/** Pre-parsed CIDRs (parsed once at module load). */
const PARSED_RANGES: ReadonlyArray<{
  name: string;
  range: [ipaddr.IPv4 | ipaddr.IPv6, number];
  family: 4 | 6;
}> = BLOCKED_RANGES.map((r) => ({
  name: r.name,
  range: ipaddr.parseCIDR(r.cidr) as [ipaddr.IPv4 | ipaddr.IPv6, number],
  family: r.family,
}));

/**
 * Test whether `hostname` matches `allowList`. Bare entries are
 * case-insensitive exact matches; `*.foo.bar` requires ONE OR MORE left
 * labels (per D-S4 — bare `foo.bar` does NOT match the wildcard pattern).
 *
 * Empty allow-list ⇒ matches nothing (default-deny posture, D-S3).
 */
export function hostMatches(hostname: string, allowList: readonly string[]): boolean {
  if (allowList.length === 0) return false;
  // Strip trailing dot (canonical FQDN form) before comparison.
  const h = hostname.replace(/\.$/, "").toLowerCase();
  for (const raw of allowList) {
    const entry = raw.replace(/\.$/, "").toLowerCase();
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(2); // e.g. "amazonaws.com"
      // Must end in ".suffix" — one OR MORE left labels (rejects bare `suffix`).
      if (h.length > suffix.length + 1 && h.endsWith(`.${suffix}`)) {
        return true;
      }
    } else if (entry === h) {
      return true;
    }
  }
  return false;
}

/**
 * Test whether `ip` (string form) falls inside any blocked CIDR. Returns
 * the rule name on match, or `null` if clean.
 *
 * Edge cases handled:
 *   - IPv4-mapped IPv6 (`::ffff:N.N.N.N`) ⇒ unwrap to IPv4 and re-check.
 *   - Decimal/hex/octal IPv4 representations ⇒ ipaddr.js parses them.
 *   - opts.allowLoopback + NODE_ENV != 'production' ⇒ skip
 *     `loopback_v4` and `loopback_v6` ONLY (other ranges still apply).
 */
export function checkBlocklist(
  ip: string,
  // family is part of the API surface (matches LookupAddress's shape) but
  // we re-derive it from the parsed address — kept for caller ergonomics.
  _family: 4 | 6,
  opts: { allowLoopback: boolean; nodeEnv?: string },
): string | null {
  const env = opts.nodeEnv ?? process.env.NODE_ENV;
  const loopbackPermitted = opts.allowLoopback && env !== "production";

  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(ip);
  } catch {
    // Unparseable address — treat as blocked rather than allow through.
    return "unparseable";
  }

  // IPv4-mapped IPv6 unwrap (D-S3 mapped_v4 rule, re-checked as IPv4).
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    const v4 = (parsed as ipaddr.IPv6).toIPv4Address();
    // Re-run against IPv4 ranges (skip IPv6 ranges).
    for (const r of PARSED_RANGES) {
      if (r.family !== 4) continue;
      if (loopbackPermitted && r.name === "loopback_v4") continue;
      if (v4.match(r.range as [ipaddr.IPv4, number])) {
        return r.name === "loopback_v4" ? "loopback_v4" : r.name;
      }
    }
    // No IPv4 range hit — still flag mapped_v4 so operators see the bypass attempt.
    return "mapped_v4";
  }

  const effectiveFamily: 4 | 6 = parsed.kind() === "ipv4" ? 4 : 6;
  for (const r of PARSED_RANGES) {
    if (r.family !== effectiveFamily) continue;
    if (loopbackPermitted && (r.name === "loopback_v4" || r.name === "loopback_v6")) continue;
    // ipaddr.js's match() throws on family mismatch; we already filtered above.
    if (parsed.match(r.range as never)) return r.name;
  }
  return null;
}

/**
 * The `lookup` callback signature net.connect passes us is variable:
 *   - when called with `{all: false}` (legacy default) it expects
 *     `cb(err, address: string, family: number)`.
 *   - when called with `{all: true}` (undici v7 net.connect path) it
 *     expects `cb(err, addresses: Array<{address, family}>)`.
 * We honour both shapes by inspecting `options.all`.
 */
type LookupOptions = { all?: boolean } & Record<string, unknown>;
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  addressOrList?: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

/**
 * Build the SSRF lookup function that gets installed into undici's
 * `connect.lookup` option. Exported separately so the unit test can
 * drive it directly without poking undici's private options surface.
 */
export function makeSSRFLookup(
  opts: SSRFOptions,
): (hostname: string, options: LookupOptions, cb: LookupCallback) => void {
  const resolve = opts.resolve ?? ((h: string) => dnsLookup(h, { all: true }));
  const privateSet = new Set(opts.privateHostAllowlist.map((s) => s.toLowerCase()));
  return (hostname, options, cb): void => {
    const normalised = hostname.replace(/\.$/, "").toLowerCase();
    // 1. Allow-list gate (default-deny).
    if (!hostMatches(normalised, opts.allowedHosts)) {
      const ctx: SSRFBlockContext = {
        host: hostname,
        ip: null,
        rule: "host_not_allowed",
        mode: opts.mode,
      };
      try {
        opts.onBlock(ctx);
      } catch {
        /* never let audit hook crash the dispatcher */
      }
      if (opts.mode === "enforce") {
        cb(new SSRFBlockedError("host_not_allowed", hostname));
        return;
      }
      // warn-mode: even though the host isn't allow-listed, we still
      // proceed — this is the explicit observability tradeoff (D-S5).
    }

    const isPrivateAllowlisted = privateSet.has(normalised);

    // 2. Single DNS resolve, all addresses.
    resolve(hostname).then(
      (addrs) => {
        if (!addrs || addrs.length === 0) {
          cb(new SSRFBlockedError("dns_empty", hostname));
          return;
        }

        // 3. Per-IP block-list (skipped for privateHostAllowlist hosts).
        if (!isPrivateAllowlisted) {
          for (const a of addrs) {
            const rule = checkBlocklist(a.address, a.family as 4 | 6, {
              allowLoopback: opts.allowLoopback,
              ...(opts.nodeEnv !== undefined ? { nodeEnv: opts.nodeEnv } : {}),
            });
            if (rule) {
              const ctx: SSRFBlockContext = {
                host: hostname,
                ip: a.address,
                rule,
                mode: opts.mode,
              };
              try {
                opts.onBlock(ctx);
              } catch {
                /* swallow */
              }
              if (opts.mode === "enforce") {
                cb(new SSRFBlockedError(rule, hostname, a.address));
                return;
              }
            }
          }
        }

        // 4. Hand back the first resolved address. undici connects by
        //    IP; TLS SNI is preserved because undici derives the
        //    servername from the original URL, not from the lookup
        //    result.
        const first = addrs[0];
        /* v8 ignore next 4 -- defensive: length-check above already guards this branch */
        if (!first) {
          cb(new SSRFBlockedError("dns_empty", hostname));
          return;
        }
        // Match the callback shape requested by net.connect (D-S2): when
        // `options.all` is true, hand back the full array (we already
        // validated every entry); otherwise hand back the legacy
        // (address, family) single-address shape.
        if (options?.all === true) {
          cb(
            null,
            addrs.map((a) => ({ address: a.address, family: a.family as number })),
          );
        } else {
          cb(null, first.address, first.family);
        }
      },
      (err: NodeJS.ErrnoException) => {
        cb(err);
      },
    );
  };
}

/**
 * Build a process-wide undici Dispatcher (Agent) with the SSRF lookup
 * hook installed. Caller invokes `setGlobalDispatcher(makeSSRFDispatcher(opts))`
 * during boot (apps/api/src/bootstrap.ts), BEFORE any route registration.
 */
export function makeSSRFDispatcher(opts: SSRFOptions): Dispatcher {
  return new Agent({
    connect: {
      // undici's lookup signature: (hostname, options, cb) — cb expects
      // (err | null, address, family). We perform a single resolve and
      // hand the resolved IP back so undici connects by IP (not by
      // hostname) — that closes the TOCTOU window. undici preserves the
      // original URL hostname for TLS SNI and the Host: header.
      // undici's LookupFunction type narrows the variadic cb shape; ours
      // is a strict superset (handles both legacy single-address and
      // `{all:true}` array shapes). Cast is safe — Node's net.connect
      // invokes us as documented in the source.
      lookup: makeSSRFLookup(opts) as never,
    },
  });
}
