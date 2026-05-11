---
phase: 06-observability-ops-hardening-workers
plan: 06
subsystem: security / outbound HTTP gating
tags: [ssrf, undici, dispatcher, scale-04, threat-mitigation]
requires: [05-ssrf-context, 06-03-otel-bootstrap]
provides:
  - "Process-wide SSRF dispatcher (apps/api/src/lib/ssrf-dispatcher.ts)"
  - "setGlobalDispatcher wired in apps/api/src/bootstrap.ts (after otel-bootstrap, before buildApp)"
  - "Default-deny allow-list with *.wildcard support"
  - "13-entry CIDR block-list (8 IPv4 + 5 IPv6) including AWS IMDS v4+v6"
  - "Single-resolve-then-connect-by-IP TOCTOU close (D-S2)"
  - "enforce|warn mode (D-S5) + loopback opt-in for dev/test (D-S6)"
  - "SSRFBlockedError → 502 envelope wired into global error handler"
  - "Integration test (tests/integration/ssrf-cidr-matrix.test.ts) drives real fetch() through the gate"
affects:
  - "Every outbound fetch() in the API process (Better Auth OIDC, LiteLLM, Tavily/Yandex, pyannote.ai, future user-URL fetching)"
  - ".env.example operator-facing documentation"
tech-stack:
  added:
    - "ipaddr.js@^2.2.0 (apps/api dep) — CIDR membership tests + IPv4-mapped IPv6 unwrap"
    - "undici@7.25.0 (root devDep) — integration test exercises real fetch()"
  patterns:
    - "Undici Agent with connect.lookup override (single-resolve-then-connect-by-IP)"
    - "Variadic lookup callback (legacy single-address vs net.connect's `{all:true}` array shape)"
    - "Audit-hook decoupling — onBlock callback never throws (errors swallowed) to keep dispatcher resilient"
key-files:
  created:
    - apps/api/src/lib/ssrf-dispatcher.ts
    - apps/api/src/config/ssrf.ts
    - apps/api/src/config/ssrf.test.ts
    - apps/api/src/bootstrap.ts
    - apps/api/src/bootstrap.test.ts
    - tests/integration/ssrf-cidr-matrix.test.ts
  modified:
    - apps/api/src/lib/ssrf-dispatcher.test.ts (RED → GREEN, 44 unit tests)
    - apps/api/src/index.ts (installGlobalSSRF() wired after otel-bootstrap, before buildApp)
    - apps/api/src/error-handler.ts (SSRFBlockedError → 502 envelope branch)
    - apps/api/package.json (+ipaddr.js dependency)
    - .env.example (+ OUTBOUND_ALLOWED_HOSTS, OUTBOUND_PRIVATE_HOST_ALLOWLIST, OUTBOUND_ALLOW_LOOPBACK, OUTBOUND_SSRF_MODE)
    - package.json (root devDep + alphabetised by sibling biome run)
decisions:
  - "Two distinct lookup callback shapes: `{all:true}` (net.connect default in undici v7) returns the full address array; legacy `{all:false}` returns single address+family. The dispatcher inspects options.all and returns the requested shape — discovered empirically during integration test."
  - "Block-list rule ordering matters for IPv6: aws_imds_v6 (fd00:ec2::/32) is a subset of ula_v6 (fc00::/7); aws_imds_v6 listed FIRST so the more-specific rule wins on match."
  - "checkBlocklist's `family` parameter is part of the API surface (matches LookupAddress) but unused internally — re-derived from ipaddr.parse() for correctness. Renamed to _family to suppress lint while preserving signature compat."
  - "`unparseable` rule introduced for defensive failure mode — ipaddr.parse() failure ⇒ block rather than allow through. Not in the canonical D-S3 13-entry list but operationally required."
  - "Trailing-dot FQDN normalisation in hostMatches() — `openrouter.ai.` is canonicalised to `openrouter.ai` before allow-list matching."
  - "Audit-hook errors are swallowed (try/catch around opts.onBlock) — the dispatcher MUST NOT crash because an audit row failed to write."
metrics:
  duration: 45m
  completed: "2026-05-11"
  tasks: 1
  files_changed: 12
  unit_tests_added: 58
  integration_tests_added: 4
  commits: 1
---

# Phase 06 Plan 06: SSRF Dispatcher Summary

Process-wide undici dispatcher gates every outbound HTTP/HTTPS request from the API with single-resolve-then-connect-by-IP (closes DNS-rebinding TOCTOU) and a 13-entry CIDR block-list (RFC1918 + loopback + link-local incl. AWS IMDS 169.254.169.254 + IPv6 ULA + AWS IMDS v6); env-driven allow-list with `*.wildcard` support enforces default-deny; SSRFBlockedError surfaces as 502 envelope through the global error handler; warn-mode preserves observability without blocking.

## What landed

**Production modules:**
- `apps/api/src/lib/ssrf-dispatcher.ts` — `makeSSRFDispatcher(opts)` returns an undici `Agent` with `connect.lookup` override. Exports `makeSSRFLookup` (the bare lookup function — unit-testable without poking the agent's private surface), `hostMatches`, `checkBlocklist`, `BLOCKED_RANGES`, `SSRFBlockedError`.
- `apps/api/src/config/ssrf.ts` — `loadSSRFConfig(env)` parses the 4 env vars via Zod (default-deny when allow-list is empty).
- `apps/api/src/bootstrap.ts` — `installGlobalSSRF()` calls `setGlobalDispatcher(makeSSRFDispatcher(...))`. Default `onBlock` emits a structured JSON warn line to stdout (pino unavailable at boot time).

**Wiring:**
- `apps/api/src/index.ts` — `import "./bootstrap.js"; installGlobalSSRF();` lands AFTER `import "./otel-bootstrap.js"` (so OTel undici-instrumentation sees the SSRF agent as the upstream) and BEFORE the first route/`buildApp` import resolves.
- `apps/api/src/error-handler.ts` — `SSRFBlockedError` branch returns 502 `{error: "Upstream blocked by SSRF policy"}`.

**Operator surface:**
- `.env.example` documents the 4 vars verbatim from D-S4 with sensible defaults (allow-list pre-populated for OSS providers + compose service names; loopback denied; mode=enforce).

## Edge cases covered (unit tests, 58 total)

| # | Edge case | Test |
|---|---|---|
| 1 | RFC1918 10.0.0.0/8 | `rfc1918_10` |
| 2 | RFC1918 172.16.0.0/12 | `rfc1918_172_16` |
| 3 | RFC1918 192.168.0.0/16 | `rfc1918_192_168` |
| 4 | Loopback 127.0.0.0/8 | `loopback_v4` |
| 5 | Link-local 169.254.0.0/16 | `link_local_v4` |
| 6 | **AWS IMDSv1 169.254.169.254** | dedicated assertion + ip surfaced in audit ctx |
| 7 | Reserved 0.0.0.0/8 | `reserved_zero` |
| 8 | CGNAT 100.64.0.0/10 | `cgnat` |
| 9 | Multicast 224.0.0.0/4 | `multicast_v4` |
| 10 | IPv6 loopback ::1/128 | `loopback_v6` |
| 11 | IPv6 ULA fc00::/7 | `ula_v6` |
| 12 | IPv6 link-local fe80::/10 | `link_local_v6` |
| 13 | **AWS IMDS v6 fd00:ec2::/32** | `aws_imds_v6` (listed BEFORE ula_v6 so the more-specific rule wins) |
| 14 | **IPv4-mapped IPv6 ::ffff:10.0.0.1** | unwrapped → `rfc1918_10` (bypass closed) |
| 15 | Trailing-dot FQDN normalisation | `openrouter.ai.` ↔ `openrouter.ai` |
| 16 | Wildcard `*.amazonaws.com` requires ≥1 left label | bare `amazonaws.com` rejected |
| 17 | Empty allow-list = deny everything | default-deny posture |
| 18 | Multi-A-record DNS rebinding | ANY blocked IP in the resolution set rejects |
| 19 | Empty DNS resolution (defensive) | `dns_empty` rule |
| 20 | DNS resolution failure | propagates ENOTFOUND to caller |
| 21 | Loopback opt-in dev/test only | NODE_ENV='production' overrides allowLoopback |
| 22 | Loopback opt-in does NOT relax 10/8 | scoped only to loopback ranges |
| 23 | Warn mode lets request proceed + still audits | onBlock fires with `mode:'warn'` |
| 24 | `unparseable` IP defensive block | non-IP string blocks rather than allowing |
| 25 | Audit-hook crash does not break dispatcher | try/catch around `opts.onBlock` |
| 26 | `{all:true}` callback shape | returns full LookupAddress array |
| 27 | Public IPv4 (8.8.8.8) passes cleanly | sanity baseline |
| 28 | Public IPv6 (2001:db8::1) passes cleanly | sanity baseline |
| 29 | privateHostAllowlist permits RFC1918 for compose service names | `litellm` → 172.x permitted |
| 30 | BLOCKED_RANGES export shape | exactly 13 entries (8 v4 + 5 v6) |

## Integration tests (4 total, `tests/integration/ssrf-cidr-matrix.test.ts`)

Boots a real loopback fixture server, registers the SSRF dispatcher via `setGlobalDispatcher`, then drives `globalThis.fetch()`:

1. **`OUTBOUND_ALLOW_LOOPBACK=1` + `NODE_ENV='test'` + host in allow-list** → outbound `fetch()` reaches the fixture, returns 200.
2. **`OUTBOUND_ALLOW_LOOPBACK=0`** → same fetch fails with `SSRFBlockedError(rule='loopback_v4')` in the error cause chain.
3. **AWS IMDS** → resolve pinned to 169.254.169.254 → blocked with `rule='link_local_v4'` and ip='169.254.169.254' on the error.
4. **`mode='warn'`** → fetch SUCCEEDS to the fixture; onBlock callback STILL fires with `{rule:'loopback_v4', mode:'warn'}` per D-S5 contract.

## Coverage

`apps/api/src/lib/ssrf-dispatcher.ts`: **L=100 / B=95.23 / F=91.66 / S=98.78** — meets 90/90/90/90.
`apps/api/src/config/ssrf.ts`: **100/100/100/100**.
`apps/api/src/bootstrap.ts`: **100/100/100/100**.

(All four axes ≥90% on every touched file. The 3 uncovered branches in the dispatcher are defensive-only paths: the `addrs[0]` guard after a length check, the `unparseable` re-check after a successful parse, and the family-fallback at the top of `checkBlocklist`.)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] undici `connect.lookup` requires `{all:true}` array-shape callback**
- **Found during:** integration test
- **Issue:** undici v7's `net.connect` invokes lookup with `{all: true, hints: ...}` and expects `cb(err, addresses[])` (array form). Original implementation returned legacy single-address `cb(err, address, family)` triggering `ERR_INVALID_IP_ADDRESS` from `node:net` validation.
- **Fix:** Lookup function now inspects `options.all` and returns the requested shape — array when `true`, single-address when `false`/absent. Both paths run the full block-list validation; only the callback shape differs.
- **Files modified:** `apps/api/src/lib/ssrf-dispatcher.ts`
- **Commit:** `1e7263f`

**2. [Rule 3 - Blocker] IPv6 rule ordering (aws_imds_v6 ⊂ ula_v6)**
- **Issue:** `fd00:ec2::/32` is a subset of `fc00::/7`. With the original D-S3 order, AWS IMDS v6 IPs were reported as `ula_v6` instead of the more-specific `aws_imds_v6` rule.
- **Fix:** Reordered IPv6 entries in `BLOCKED_RANGES` so `aws_imds_v6` is checked BEFORE `ula_v6`. Documented inline.
- **Commit:** `1e7263f`

**3. [Rule 2 - Critical functionality] Audit-hook resilience**
- **Issue:** Plan did not specify what happens when `onBlock` throws. A failed audit write must not crash the dispatcher (otherwise an audit-DB outage would cascade into a request-routing outage).
- **Fix:** Both call sites wrap `opts.onBlock(ctx)` in try/catch and swallow errors. Pinned by `audit callback failure does not crash the lookup pipeline` test.
- **Commit:** `1e7263f`

**4. [Rule 3 - Blocker] Root devDep on undici for the integration test**
- **Issue:** `tests/integration/ssrf-cidr-matrix.test.ts` runs from root cwd where `undici` isn't resolvable (it's an `apps/api` dep). Other root integration tests don't depend on undici.
- **Fix:** Added `undici@7.25.0` to root devDependencies (pinned to the same version `apps/api` uses to avoid drift). Documented in plan log.
- **Commit:** `1e7263f`

### Acceptance Criteria

All 9 acceptance criteria from the plan are met:

- [x] `apps/api/src/lib/ssrf-dispatcher.ts` exists and `BLOCKED_RANGES` contains all 13 D-S3 entries (8 IPv4 + 5 IPv6).
- [x] `grep -c "169.254.0.0/16" apps/api/src/lib/ssrf-dispatcher.ts` ≥ 1 (returns 1).
- [x] `grep -c "fd00:ec2::" apps/api/src/lib/ssrf-dispatcher.ts` ≥ 1 (returns 1).
- [x] `grep -c "setGlobalDispatcher" apps/api/src/bootstrap.ts` ≥ 1 (returns 3 — comment + type-import + invocation).
- [x] `apps/api/src/index.ts` head lines load otel-bootstrap → bootstrap.installGlobalSSRF → buildApp.
- [x] `.env.example` contains `OUTBOUND_ALLOWED_HOSTS=` line.
- [x] `apps/api/src/lib/ssrf-dispatcher.test.ts` stub flipped — no `not yet implemented` throws.
- [x] **Unit suite: 44 tests in ssrf-dispatcher.test.ts** (13 CIDR + 7 allow-list/edge + 6 single-resolve + 9 mode/loopback + 9 edge-case parsing). Plus 8 bootstrap.test.ts + 8 config/ssrf.test.ts → **58 unit tests total**.
- [x] Coverage ≥90/90/90/90 on `apps/api/src/lib/ssrf-dispatcher.ts` and `apps/api/src/config/ssrf.ts`.

The "live integration test: outbound HTTPS to `https://api.openrouter.ai` STILL succeeds" criterion is exercised by Plan 06-12 e2e suite (gated on `E2E=1`); not run in this plan's commit because it requires real network egress + an actual API key. The single-resolve / TLS-SNI preservation is structurally pinned by the unit suite (resolve called once, connect-by-IP semantics asserted).

## Atomic commit log

| Hash | Message | Files |
|------|---------|-------|
| `1e7263f` | `feat(06-06): add process-wide ssrf dispatcher` | 13 files (6 created + 7 modified, including .env.example + pnpm-lock.yaml) |

## Known Stubs

None. Every test in this plan asserts behavior against real production code paths; the only injection points (`resolve`, `nodeEnv`) are documented test-only overrides used by both unit + integration suites.

## Self-Check: PASSED

- [x] `apps/api/src/lib/ssrf-dispatcher.ts` — FOUND
- [x] `apps/api/src/config/ssrf.ts` — FOUND
- [x] `apps/api/src/bootstrap.ts` — FOUND
- [x] `apps/api/src/bootstrap.test.ts` — FOUND
- [x] `apps/api/src/config/ssrf.test.ts` — FOUND
- [x] `tests/integration/ssrf-cidr-matrix.test.ts` — FOUND
- [x] Commit `1e7263f` — FOUND in `git log`
- [x] All 58 unit tests + 4 integration tests pass against the production module
