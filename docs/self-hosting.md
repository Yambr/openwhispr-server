# Self-Hosting Guide

> Pairs with the [OpenWhispr desktop client](https://github.com/Yambr/openwhispr) — install signed builds from [releases](https://github.com/Yambr/openwhispr/releases), then follow the pairing walkthrough in [`client.md`](./client.md).
>
> This document covers self-hosting the *server* (variant matrix, realtime ingress, env disclosures). Deploy / upgrade / scale runbooks live in [`operations.md`](./operations.md).

## Variant A — Embedded LiteLLM (default OSS quickstart)

Plan 11-01 promoted the embedded-LiteLLM compose + chart bundle to the
canonical OSS entrypoint. Fresh operators should start there:

- **Compose:** `compose/docker-compose.embedded-litellm.yml`
- **Chart values:** `charts/openwhispr/examples/values-embedded-litellm.yaml`
- **Env scaffold:** `.env.embedded.example`
- **Variant matrix + quickstart commands:** [`examples/README.md`](../examples/README.md)

Variant A does NOT require `HF_TOKEN`. The chart's
`openwhispr.requiredSecretKeys` helper only appends that key when
`bundledAi.enabled=true` (Variant C — local Speaches with gated pyannote
weights). The relocated `HF_TOKEN` block in `.env.example` lives under a
`# Variant C only` banner; ignore it for Variant A.

## Realtime ingress (`:8443`)

Phase 4 (Plan 05) split the Traefik ingress into two TLS entrypoints
because realtime WSS sessions need a 3600s `idleTimeout` ceiling that
must NOT apply to short-JSON routes (T-04-02 mitigation — long-timeout
regimes hold ingress-pool slots open and a single misbehaving client
should not be able to starve every other tenant).

| Entrypoint | Port | Routes | Timeout regime |
|------------|------|--------|----------------|
| `websecure` | `:443` | every non-realtime route | Traefik 3 defaults (60s read / 0 write / 180s idle) |
| `websecure-realtime` | `:8443` | `/v1/realtime` only (WSS upgrade) | read 0 / write 0 / idle 3600s |

**Operator action when self-hosting:**

1. Open `:8443` on the host firewall / cloud security group, alongside
   the existing `:443`. The desktop client's realtime path will not
   work without it.
2. Use the **same TLS certificate** on both entrypoints (cert-reuse).
   `compose/traefik/dynamic.yml` declares the cert in a single shared
   `tls.certificates` block; both entrypoints serve it via
   `http: { tls: {} }`. **No second ACME flow required.**

**Why cert-reuse is mandatory.** Let's Encrypt's HTTP-01 challenge
only validates ports 80 and 443 — it cannot probe `:8443`. Issue /
renew the cert via the normal `:443` flow your operator already runs;
both entrypoints serve the renewed material on Traefik's rolling
refresh.

**DNS-01 alternative (TODO, not yet wired).** For environments that
disable inbound `:443` from the public internet but need inbound
`:8443` only, switch the Traefik ACME resolver to DNS-01 via the DNS
provider matching your DNS host. Plan 10 ships the entrypoint
topology; the DNS-01 hook lands when an operator first asks for it.

**Soak validation.** `.github/workflows/nightly-realtime-soak.yml`
runs a 65-min live OpenAI Realtime soak nightly + on every `v*` tag,
proving the topology survives a real-provider session through the
full chain (Traefik `:8443` → Fastify proxy → LiteLLM → real OpenAI).
The 5-min hermetic counterpart (`tests/e2e/realtime-soak-hermetic.test.ts`,
exercised by `make e2e-test`) is the per-PR gate.

See [`operations.md` § Realtime ingress](./operations.md#realtime-ingress-8443)
for the full topology table, close-code attribution, and ACME details.

## Phase 4 env vars (token-mint + realtime)

Phase 4 added three env-keyed token-mint endpoints. Each refuses to
serve (returns `503` with operator-actionable wording) when the
corresponding key is absent — **missing-key 503 is the intentional
D-18 behavior so operators see the failure immediately rather than
the desktop client silently breaking**.

| Env var | Required | Default | Consumed by | Notes |
|---------|----------|---------|-------------|-------|
| `ASSEMBLYAI_API_KEY` | for `/api/streaming-token` | none — route returns 503 if absent | `apps/api/src/routes/tokens/assemblyai.ts` | AssemblyAI v3 streaming-token mint (Plan 03; D-14, D-18). Provision via the AssemblyAI dashboard. |
| `ASSEMBLYAI_TOKEN_TTL` | optional | `60` (seconds) | `apps/api/src/routes/tokens/assemblyai.ts` | Override only if the desktop client's keepalive cadence demands it; the default matches the AssemblyAI v3 reference contract. |
| `DEEPGRAM_API_KEY` | for `/api/deepgram-streaming-token` | none — route returns 503 if absent | `apps/api/src/routes/tokens/deepgram.ts` | Deepgram Grant Token (Plan 03; D-15, D-18). Provision via the Deepgram dashboard. |
| `DEEPGRAM_TOKEN_TTL` | optional | `30` (seconds) | `apps/api/src/routes/tokens/deepgram.ts` | Same caveat as `ASSEMBLYAI_TOKEN_TTL`. |
| `OPENAI_API_KEY` | for `/api/openai-realtime-token` and `/v1/realtime` | none — route returns 503 if absent | `apps/api/src/routes/tokens/openai-realtime.ts` + LiteLLM realtime upstream | Already documented for the Phase 3 realtime WSS proxy (D-12); Phase 4 adds the parallel-mint route (`streams=2`) via OpenAI's `/v1/realtime/client_secrets`. |
| `DEFAULT_AGENT_MODEL` | optional | first `model_name` in `compose/litellm/litellm_config.yaml` (bundled default: `qwen3.6-plus`) | `apps/api/src/routes/agent/stream.ts` | Override the default model id for `/api/agent/stream` requests that do not pass `model:` in the body. When unset, the route reads `model_list[0].model_name` from the bundled LiteLLM yaml so the route default and the proxy alias cannot drift. The model id MUST be present in the live `compose/litellm/litellm_config.yaml` — operators substituting an internal model also update LiteLLM's config. |

All three token routes share a per-user 30/min rate limit keyed on
`req.user.id` (T-04-04 mitigation: leaked-bearer abuse is bounded
per-user, not per-IP).

### Where to set the env vars

Single-host self-host (docker-compose):

1. Edit `.env` (created by `tools/bootstrap.sh`); add the keys above.
2. `docker compose up -d` — the api container picks them up via the
   `env_file` declaration in `docker-compose.yml`.
3. The api container's entrypoint default-secrets check
   ([`operations.md` § Default-secrets entrypoint check](./operations.md#default-secrets-entrypoint-check))
   refuses to boot if any key holds a deny-list placeholder
   (`changeme`, `sk-1234`, …) — set real keys, not placeholders.

K8s / Helm (Phase 9 +, not yet wired):

- Wire the keys via your secret manager of choice (Vault / sealed
  secrets / external-secrets) into the `api` `Deployment`'s `envFrom`.

## Production .env checklist

The api enforces boot-time guards on three configs. Missing or invalid
values cause `process.exit(78)` (`EX_CONFIG`) with a `FATAL` line on
stderr. The guards are bypassed in `NODE_ENV=development` / `test` so
the dev-tools overlay can short-circuit them.

| Env var | Required (prod) | Boot guard |
|---|---|---|
| `BETTER_AUTH_SECRET` | yes, ≥32 chars | `apps/api/src/config/auth.ts` (`validateAuthBoot`) |
| `AUTH_URL` | yes, must start with `https://` | `validateAuthBoot` |
| `MASTER_KEK` | yes, base64-encoded ≥32 bytes | `packages/data/src/encryption/envelope.ts` (`validateEncryptionBoot`) |
| `LITELLM_MASTER_KEY` | yes, ≠ `sk-dev-master-key-do-not-use-in-prod` | `apps/api/src/config/litellm.ts` (`validateLitellmBoot`) |

The `LITELLM_MASTER_KEY` anti-footgun check refuses the well-known
dev-tools overlay value so an operator who copy-pastes the dev `.env`
into production can't silently end up running a routable LLM proxy
with a published master key. Generate a real value:

```bash
openssl rand -base64 48
```

For SSRF allow-lists in compose deployments, set:

```bash
OUTBOUND_ALLOWED_HOSTS=litellm,mailpit,valkey,postgres,…your-real-upstreams…
OUTBOUND_PRIVATE_HOST_ALLOWLIST=litellm,mailpit,valkey,postgres,…
```

Without these the `/readyz` dep-check probes are rejected by the
SSRF dispatcher (`host_not_allowed`), the api never goes ready,
and kubelet / load balancers won't route traffic to the pod. The
dev-tools overlay (`compose/docker-compose.dev-tools.yml`) seeds
sane defaults for local development; production `.env` must list
the real internal hostnames explicitly.

### Verification-email link origin (`INGRESS_BASE_URL`)

Better Auth builds the **email verification link** from
`INGRESS_BASE_URL` (falling back to `AUTH_URL`):
`<INGRESS_BASE_URL>/api/auth/verify-email?token=...`. That URL must be
reachable from **where the user reads their mail** — a normal browser,
outside the Docker network.

A frequent slim-core mistake is leaving `INGRESS_BASE_URL` at the
internal Traefik hostname `https://api.localhost`. `api.localhost`
resolves only inside the compose network, so the emailed link is dead
for any real user — sign-up appears to succeed but the user can never
verify and is stuck at `EMAIL_NOT_VERIFIED` on sign-in.

Set `INGRESS_BASE_URL` (and `AUTH_URL` / `OPENWHISPR_API_URL`, which
feed Better Auth's CSRF/Origin allow-list) to the **externally
reachable** origin:

- **No-Traefik single-host slim deploy** — the api is published on host
  port 4000 (compose `4000:3000`), so use `http://localhost:4000`.
- **Behind a reverse proxy / public deploy** — your public origin,
  e.g. `https://openwhispr.example.com` (production also requires
  `https://` per the `validateAuthBoot` guard above).

All three vars must agree. The slim test `.env` (and
`.env.slim.example`) ship pinned to `http://localhost:4000`.

## Cross-references

- Wire shapes (byte-for-byte authoritative): `BACKEND_SPEC.md`
  `/v1/realtime`, `/api/agent/stream`, `/api/streaming-token`,
  `/api/deepgram-streaming-token`, `/api/openai-realtime-token`
  sections.
- Threat model: `.planning/phases/04-streaming-realtime/04-CONTEXT.md`
  T-04-01 (missing-key leakage), T-04-02 (long-timeout DoS),
  T-04-04 (leaked-bearer rate-limit), T-04-COST (CI cost prevention).
- Full operations runbook: [`operations.md`](./operations.md).
- Auth wiring (Better Auth + dual-auth): [`auth.md`](./auth.md).
