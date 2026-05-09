# Channel-scheme override

How OpenWhispr handles desktop URL schemes on the OAuth callback path, the
built-in allow-list, the `OPENWHISPR_PROTOCOL` operator override, and the
deny-list / rejection behavior.

## Why channel scheme matters

The OpenWhispr desktop client is an Electron application that registers a
custom URL protocol handler with the operating system. When the OAuth final
redirect is delivered to a custom scheme (`openwhispr://?bearer_token=...`),
the OS routes the URL to the desktop client which captures the bearer token.

Different desktop builds use different schemes so that dev / staging / prod
installations can coexist on a developer's machine without colliding on
the OS-level protocol registration:

| Build channel | Scheme |
|---------------|--------|
| Production | `openwhispr` |
| Development | `openwhispr-dev` |
| Staging | `openwhispr-staging` |

A corporate operator may also distribute a relabelled OpenWhispr build with
a custom scheme (`mycorp-whispr`, etc.) — see "Operator override" below.

## Built-in allow-list

The server hard-codes three schemes that are accepted without any operator
configuration. The desktop's `protocol=` query parameter on
`/api/desktop-signin/{provider}` is matched case-sensitively against this list:

- `openwhispr`
- `openwhispr-dev`
- `openwhispr-staging`

Match → the server persists the scheme on the `oauth_state` row, completes
the IdP handshake, and emits `<scheme>://?bearer_token=<token>` on the final
302.

No match → see "Reject behavior" below.

## Operator override (`OPENWHISPR_PROTOCOL`)

Operators distributing a relabelled desktop build set **one** additional
scheme via env:

```bash
OPENWHISPR_PROTOCOL=mycorp-whispr
```

This adds `mycorp-whispr` to the allow-list at server startup. The three
built-in schemes remain accepted. To add multiple custom schemes, they
must currently be applied at build time (the env var only widens by one
scheme in v1).

## Allow-list rules

A scheme is accepted only when it satisfies **all** of:

1. **RFC 3986 § 3.1 grammar.** First character lowercase ASCII letter
   (`a–z`); subsequent characters lowercase letters, digits, `+`, `-`, `.`.
   The validator rejects uppercase explicitly — see the case-bypass rule
   below.
2. **Length cap: 32 characters.** Exceeds → reject. (No URL scheme registered
   with IANA exceeds 32 characters.)
3. **Lowercase only.** RFC 3986 says schemes are case-insensitive when
   compared, but our allow-list compares case-**sensitively**. The desktop
   client always presents lowercase; presenting uppercase is a sign of an
   attacker probing for case-bypass on a deny-list and is rejected on sight.
4. **Not on the deny-list** (next section).
5. **Member of the allow-list** (built-in three + optional `OPENWHISPR_PROTOCOL`).

Implementation: `apps/api/src/lib/scheme-allowlist.ts` (`validateScheme`).

## Deny-list

Even if a scheme passes the grammar rules and length cap, the following
schemes are **always** rejected because navigating to them would constitute
a known security-relevant exfiltration or local-file-access path:

- `javascript`
- `data`
- `file`
- `vbscript`
- `about`
- `chrome`
- `chrome-extension`
- Any scheme matching the prefix `ms-` (Microsoft built-in protocols)

The deny-list is consulted **before** the allow-list. A scheme that appears
on both lists is rejected. The deny-list is also consulted on the case-folded
form (`JavaScript`, `DATA`, etc. are still rejected) — but rule 3 above
already rejects any uppercase letter, so the deny-list folds are belt-and-
braces.

## Reject behavior

When a request to `/api/desktop-signin/{provider}` presents a `protocol=`
that fails any of the above checks, the server returns:

- **HTTP status: 400** (NOT 302).
- **Content-Type: application/json; charset=utf-8**.
- **Body: `{"error":"invalid callback scheme"}` exactly.**

The server **never** emits a 302 redirect to a rejected scheme. This is
deliberate: emitting a 302 to a scheme that the OS will hand off to a
local handler turns the server into an open-redirect against arbitrary
URI schemes (a phishing primitive).

The reject path is exercised in the conformance suite at
`packages/contract-tests/src/oauth-redirect.test.ts` against both lowercase
deny-list values and uppercase allow-list members (the case-bypass test).

## Examples

### Valid: corporate override

Operator config:
```bash
OPENWHISPR_PROTOCOL=mycorp-whispr
```

Desktop calls:
```
GET ${AUTH_URL}/api/desktop-signin/oidc?protocol=mycorp-whispr
```

Server: 302 to IdP → eventual 302 to `mycorp-whispr://?bearer_token=...`.

### Valid: built-in dev scheme

Desktop calls:
```
GET ${AUTH_URL}/api/desktop-signin/oidc?protocol=openwhispr-dev
```

Server: 302 to IdP → eventual 302 to `openwhispr-dev://?bearer_token=...`.

### Invalid: uppercase

Desktop calls:
```
GET ${AUTH_URL}/api/desktop-signin/oidc?protocol=OpenWhispr
```

Server: HTTP 400 `{"error":"invalid callback scheme"}`. Reason: rule 3
(lowercase only). Even though `openwhispr` is on the built-in allow-list,
the case-sensitive comparison fails and the request is rejected.

### Invalid: deny-listed

Desktop calls:
```
GET ${AUTH_URL}/api/desktop-signin/oidc?protocol=javascript
```

Server: HTTP 400 `{"error":"invalid callback scheme"}`. Reason:
deny-list match.

### Invalid: missing protocol

Desktop calls:
```
GET ${AUTH_URL}/api/desktop-signin/oidc
```

Server: HTTP 400 `{"error":"invalid callback scheme"}`. Reason: rule 5
(not a member of the allow-list — the empty/missing value is not
`openwhispr`, `openwhispr-dev`, `openwhispr-staging`, nor the optional
override).

### Invalid: too long

Desktop calls (33-char scheme):
```
GET ${AUTH_URL}/api/desktop-signin/oidc?protocol=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab
```

Server: HTTP 400 `{"error":"invalid callback scheme"}`. Reason: rule 2
(length cap 32).

## Operator checklist

Before distributing a custom-scheme build:

- [ ] The desktop build registers exactly one custom protocol handler
      with the OS at install time.
- [ ] The custom scheme is on the IANA "provisional" registry or otherwise
      unlikely to collide with a future standard scheme.
- [ ] The scheme matches the RFC 3986 grammar (lowercase + `+-.`).
- [ ] The scheme is ≤ 32 characters.
- [ ] `OPENWHISPR_PROTOCOL=<scheme>` is set in the API container's `.env`
      (or compose `env_file:`).
- [ ] The conformance suite passes against the deployed backend with
      `OPENWHISPR_PROTOCOL=<scheme>` exported in the test runner's env —
      `packages/contract-tests/src/oauth-redirect.test.ts` includes the
      override scheme in its 4-scheme matrix.

## Related

- [auth.md § Sign-in flow (desktop)](auth.md) — the four-hop OAuth dance
  that consumes the channel scheme.
- `apps/api/src/lib/scheme-allowlist.ts` — `validateScheme` +
  `buildProtocolRedirect` implementations.
- `apps/api/src/lib/scheme-allowlist.test.ts` — 14 unit tests covering
  the rules and the case-bypass / deny-list / length-cap edges.
