# ADR-0006: Byte-for-byte wire compatibility with upstream BACKEND_SPEC.md

**Status:** accepted

**Date:** 2026-05-13

**Phase:** 10 — i18n, Docs & OSS Housekeeping (records a constitutional decision in force since Phase 1)

## Context

OpenWhispr Server is the open-source backend for the upstream OpenWhispr Electron
desktop client. The client is the canonical artifact: it ships in user hands,
upgrades on the user's cadence, and assumes a specific HTTP/WSS surface. The
authoritative wire surface is documented across three upstream documents in the
client repo:

- `SELF_HOSTING.md` — operator-facing self-host contract.
- `BACKEND_SPEC.md` — endpoint reference (1556 lines), error envelope, status
  code map, NDJSON streaming framing, multipart layout, channel-scheme echo,
  `set-auth-token` rotation semantics.
- `OAUTH_SPEC.md` — OIDC provider flow specifically for the desktop client.

Any drift from these specs breaks real installs in the wild. The desktop client
cannot be re-flashed on demand. We therefore need a contract-level commitment.

## Decision

OpenWhispr Server implements the upstream wire surface **byte-for-byte**:

- Every endpoint path, HTTP method, status code, header name, header value
  shape, and JSON body schema matches `BACKEND_SPEC.md` verbatim.
- The error envelope (`{error: {code, message, details?}}`) is the canonical
  shape for every 4xx/5xx response. The localized `message` is the only
  field that varies by `Accept-Language`; `code` is stable English ASCII.
- NDJSON streaming responses preserve newline framing exactly per spec; no
  intermediate buffering layer reformats the byte stream.
- Multipart upload bodies are pass-through to the LiteLLM proxy without
  re-encoding (the LiteLLM v1.83.7-stable multipart-passthrough fix is what
  unlocked this — see ADR-0008).
- The `set-auth-token` rotation header is emitted with the exact casing and
  TTL semantics the desktop client expects.
- The channel-scheme echo (request → response correlation header) round-trips
  unchanged.

V2-deferred endpoints (Stripe billing, referrals) **return a stable 404 with
the canonical error envelope** rather than 501 or a custom shape; this is a
CONTRACT-01 invariant tested by `packages/contract-tests`.

## Consequences

- **Easier:** the desktop client installs against a self-hosted server with no
  client-side feature flag, no version negotiation, no compatibility shim. This
  is the entire reason the project exists.
- **Easier (contract tests):** `packages/contract-tests` boots the server and
  runs every BACKEND_SPEC.md scenario on every PR; drift fails CI before merge.
- **Harder:** we cannot "improve" the wire surface unilaterally. Any change
  must be coordinated with the upstream client team via a versioned bump
  (`/v2/*`) and a desktop client release.
- **Risk:** upstream client bugs that depend on server-side quirks must be
  preserved until the client is updated. Logged as compatibility shims with
  a TODO and a tracking issue.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| **Diverge to a cleaner v1 surface** | Breaks every desktop client install in the wild. Non-starter. |
| **Implement only a subset, return 501 elsewhere** | The desktop client's error-handling code paths are tuned for 404 on deferred endpoints, not 501. Spec compliance is binary. |
| **Best-effort with a compatibility shim layer** | Adds a translation layer that drifts silently; contract tests against the canonical spec are the simpler, stronger guarantee. |
| **Reverse-engineer a "compatible-ish" surface from client traces** | Loses the explicit-spec discipline; contributors would not know which behaviors are load-bearing vs accidental. |

## References

- Upstream `SELF_HOSTING.md`, `BACKEND_SPEC.md`, `OAUTH_SPEC.md` (canonical wire surface)
- `docs/wire-contract.md` — local restatement and v2-deferred rationale
- `packages/contract-tests` — automated spec verification
- ADR-0008 (LiteLLM pass-through preserves multipart byte stream)
- ADR-0009 (Better Auth implements the OAUTH_SPEC.md flow)
