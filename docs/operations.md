# Operations

> **Phase 0:** This document is a stub. Full deploy / upgrade / scale / backup / restore / troubleshoot content lands in Phase 8 + Phase 10 (DOCS-03).

## Branch protection (post-fork setup)

After forking the repo, an operator with admin access must apply branch protection to `main`:

```bash
export GITHUB_REPOSITORY="<owner>/openwhispr-server"
export GITHUB_TOKEN="<personal-access-token-with-admin:repo-scope>"
bash scripts/setup-branch-protection.sh
```

This applies the configuration in `scripts/branch-protection.json`:

- Required status checks: lint, lint-english, typecheck, test, mutation-quick, pr-checklist, harness-self-check, gitleaks, trivy-fs, codeql, license-scan
- Required PR reviews: 1 approval
- Required linear history
- Force-pushes and deletions blocked
- `enforce_admins: true`

If the workflow job names ever change, update both:

1. `.github/workflows/ci.yml` and `.github/workflows/security.yml` (the actual job keys)
2. `scripts/branch-protection.json` (`required_status_checks.contexts`)

The `branch-protection-contexts` self-test in `tests/self-tests/` verifies the two stay in sync on every PR.

## Vulnerability reporting

See [SECURITY.md](../SECURITY.md). The operator should configure a real reporting channel before publishing the repo.

## Bootstrap prerequisites

`tools/bootstrap.sh` requires bash >= 4. macOS ships bash 3.2 by default;
install a current bash via `brew install bash` and re-hash before running
the script. Linux distributions and the GHA `ubuntu-24.04` runner ship
bash 5.x natively — no action required there.

The script also needs `openssl` (universal) and, for full backup support,
the `age` binary on PATH (see "Backup and restore" below).

## Backup and restore

Phase 1 ships an `age`-encrypted `pg_dump` round-trip. The two operator
entry points are `make backup` and `make restore BACKUP=path`.

### Identity vs recipient

`age` separates the X25519 keypair into a private **identity** and a
public **recipient**. They have different lifecycles:

| Concept   | Format prefix         | Where it lives                           |
| --------- | --------------------- | ---------------------------------------- |
| Identity  | `AGE-SECRET-KEY-1...` | `BACKUP_AGE_IDENTITY` in `.env` (local); GHA secret `BACKUP_AGE_IDENTITY` in CI; written to `~/.age/key.txt` (chmod 600) at restore time |
| Recipient | `age1...`             | `keys/backup.age.pub` (committed) — used for `age -r` on every backup |

The identity is **separate from `MASTER_KEK`** (which is a symmetric
AES-256 key for column DEK envelope encryption). They use different
crypto primitives (X25519 vs AES-256) and may rotate on different
cadences. Conflating them would couple two unrelated rotation policies.

### One-time setup

1. Run `tools/bootstrap.sh`. If `age-keygen` is on PATH, it generates a
   fresh identity and writes the matching recipient to
   `keys/backup.age.pub`. If `age` is missing, install it first:

   - Debian/Ubuntu: `apt install age`
   - macOS: `brew install age`
   - Windows: `scoop install age`

2. Add `BACKUP_AGE_IDENTITY` from `.env` as a GitHub Actions repository
   secret named `BACKUP_AGE_IDENTITY` (Repository settings -> Secrets and
   variables -> Actions -> New repository secret). The nightly workflow
   needs it to decrypt the round-trip artifact.

3. Commit `keys/backup.age.pub`. The recipient is public and may be
   shared freely.

### Producing a backup

```bash
make backup
```

Internally this runs `scripts/backup/make-backup.sh`, which streams
`pg_dump -Fc` through `age -r <recipient>` and writes the ciphertext to
`backups/<UTC-timestamp>.dump.age`. With `DATABASE_URL_OWNER` exported
the script connects directly; otherwise it shells into the Postgres
container via `docker compose exec`, ensuring the `pg_dump` major
matches the server major.

### Restoring a backup

```bash
make restore BACKUP=backups/2026-05-09T10-00-00.dump.age
```

Set `BACKUP_AGE_IDENTITY_FILE` to override the default identity path
(`~/.age/key.txt`). The script refuses to run if the target Postgres has
**any** non-system tables in the `public` schema — a guard against
accidental clobber. To restore on top of a populated database, drop
and recreate it first:

```bash
docker compose exec -T postgres psql -U openwhispr_owner -c "DROP DATABASE openwhispr"
docker compose exec -T postgres psql -U openwhispr_owner -c "CREATE DATABASE openwhispr OWNER openwhispr_owner"
make restore BACKUP=backups/2026-05-09T10-00-00.dump.age
```

### Version constraint

`pg_dump` and `pg_restore` must match the server major (Postgres 17). The
scripts shell into the `postgres:17-alpine` container by default so an
operator's locally installed Postgres client tools cannot drift. The
nightly CI job pins `postgres:17-alpine` for the same reason.

### Rotation

Rotating the X25519 identity invalidates every previously written
backup. The operational sequence is:

1. Run `age-keygen > keys/new-identity.txt` and update `BACKUP_AGE_IDENTITY`
   in `.env` and the GHA secret.
2. Update `keys/backup.age.pub` from `age-keygen -y < keys/new-identity.txt`
   and commit.
3. Re-encrypt outstanding backups (out-of-band: `age -d -i old | age -r new`).
4. Securely destroy `keys/new-identity.txt` once it has been moved to
   the secret store.

The corresponding `MASTER_KEK` rotation is independent (see Phase 2 ADR
on KEK rotation).

### Storage conventions

Object storage layout is documented in [storage.md](storage.md). The
backup tier is local-disk only in v1; Phase 9 wires off-site replication
to a customer-owned S3 target.

## Auth

Phase 2 lands the auth plane: Better Auth 1.6.9 + email+password + pluggable
OIDC + opaque bearer + cookie + token rotation overlap + channel-scheme echo
on the desktop OAuth flow. Operator-facing reference:

- [auth.md](auth.md) — overview, sign-in flow, dual auth, cookie-host scoping,
  troubleshooting.
- [oidc-operator-config.md](oidc-operator-config.md) — per-IdP env walkthroughs
  (Generic OIDC / Keycloak / Authentik / Google Workspace / Azure AD / Okta).
- [channel-scheme-override.md](channel-scheme-override.md) — channel-scheme
  allow-list rules, OPENWHISPR_PROTOCOL override, deny-list, reject behavior.

### Configuring SMTP

Verification emails (Better Auth's sign-up flow) and admin notifications are
delivered via SMTP (PROVIDER-04). The transport is configured via env:

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587                            # 587 STARTTLS, 465 direct TLS, 25 plain
SMTP_USER=apikey
SMTP_PASSWORD=REPLACE_ME
SMTP_FROM="OpenWhispr <noreply@example.com>"
```

`apps/api/src/email.ts` selects TLS mode automatically based on port. The
`.send()` method **re-throws** on transport error so the calling Better Auth
flow can surface the failure to the user.

**Dev fallback.** With `SMTP_HOST` unset, the email service returns a no-op
stub that logs `event=email.smtp_not_configured` and returns success. This
keeps dev sign-up flows green without requiring an actual SMTP server. To
inspect outbound mail in development, bring up the bundled mailpit service:

```bash
docker compose --profile dev up -d mailpit
# Set SMTP_HOST=mailpit, SMTP_PORT=1025 in .env
# Open http://mailpit.localhost (Traefik routes it via the dev-profile router)
```

mailpit is **profile-gated**; the default `docker compose up` never starts it.

### Rotating BETTER_AUTH_SECRET

`BETTER_AUTH_SECRET` is the HMAC key Better Auth uses to sign opaque bearer
tokens. Rotating it **invalidates every existing session** — every signed-in
user is forced back to the sign-in page on their next request. Plan for the
operator runbook:

1. Communicate the forced-relogin event to users.
2. Generate a fresh secret: `openssl rand -base64 32`.
3. Update `BETTER_AUTH_SECRET` in `.env` (and the equivalent in your secret
   manager / Helm values).
4. `docker compose restart api` (or roll the API deployment in K8s).
5. Confirm: every existing token returns 401; new sign-ins succeed.

There is no "graceful" rotation in v1 — sessions cannot survive a secret
change. Treat the secret as a long-lived credential rotated only on
compromise.

### Default-secrets entrypoint check

The API container refuses to boot if any required env var holds a deny-list
placeholder value (`changeme`, `sk-1234`, etc.). The check runs in
`apps/api/scripts/check-default-secrets.ts` (compiled to `dist/scripts/check-default-secrets.cjs`)
via the container's `ENTRYPOINT`. The deny-list lives at
`tools/bootstrap/default-secrets.txt`.

Operators can override the deny-list path via `DENY_LIST_PATH=/path/to/file`
if running outside the standard container layout. The self-test
`tests/self-tests/api-entrypoint-default-secrets.test.ts` exercises the
contract end-to-end (compose up → fixture .env with `MASTER_KEK=changeme` →
container exit non-zero with the offending key on stderr).

### Troubleshooting common 401 patterns

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| All users receive 401 immediately after deploy | `BETTER_AUTH_SECRET` rotated | Communicate forced relogin (see above) |
| Random users 401 a few hours into a session | Token rotation overlap < 5 min on a slow desktop | Verify `apps/api/src/lib/token-rotation.ts` overlap = 5 min; check API container clock skew vs DB |
| Desktop main process gets 401 but renderer cookie works | Bearer not being rotated by main process | Desktop `tokenStore.js` issue; out of scope for the server |
| Renderer cookie 401 but bearer works | Cookie not reaching API host (split-host) | See [auth.md § Cookie host scoping](auth.md) |
| `/api/desktop-signin/{provider}` returns 503 | OIDC not configured | Set all three of `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` (see [oidc-operator-config.md](oidc-operator-config.md)) |
| `/api/desktop-signin/{provider}` returns 400 `invalid callback scheme` | Channel scheme not on allow-list | See [channel-scheme-override.md](channel-scheme-override.md) |

## Realtime ingress (`:8443`)

> **Phase 4 / Plan 05 + Plan 10.** Source-of-truth wire spec:
> `BACKEND_SPEC.md` `/v1/realtime` section (upstream OpenWhispr repo).

Phase 4 split the Traefik ingress into two TLS entrypoints. WSS realtime
sessions live on a dedicated `:8443` entrypoint (`websecure-realtime`,
`idleTimeout: 3600s`); every other JSON / NDJSON / multipart route stays
on `:443` (`websecure`, Traefik 3 default timeouts: 60s read / 0 write /
180s idle). The split is a **T-04-02 mitigation** — the long-timeout
regime that realtime needs cannot be allowed to hold short-JSON-route
ingress slots open for an hour at a time.

### Topology (after Plan 05)

| Entrypoint | Port | Routes | Timeouts |
|------------|------|--------|----------|
| `websecure` | `:443` | every non-realtime route (auth, agent stream, tokens, transcribe, …) | read 60s / write 0 / idle 180s (Traefik 3 defaults) |
| `websecure-realtime` | `:8443` | `/v1/realtime` (WSS upgrade) only | read 0 / write 0 / idle 3600s |

`docker-compose.yml` publishes both ports on the host (`80, 443, 8443,
8080`). Operators MUST open `:8443` on any firewall / security-group
fronting the host — otherwise the desktop client cannot reach realtime.

### TLS certificate strategy (cert-reuse, not separate ACME)

Both entrypoints reuse the **same** TLS certificate(s) from the shared
`tls.certificates` block in `compose/traefik/dynamic.yml`. Each
entrypoint declares `http: { tls: {} }` (no per-entrypoint cert) so
Traefik picks up the cert from the dynamic-config store regardless of
listener.

This matters in production because **HTTP-01 ACME challenges cannot
validate on `:8443`** — Let's Encrypt only probes ports 80 and 443 via
HTTP-01. Two operator-supported issuance paths:

1. **Cert-reuse (recommended).** Issue / renew the cert via the normal
   `:443` HTTP-01 challenge (or whichever ACME flow your operator
   already runs). Both entrypoints serve the same renewed cert — no
   second ACME flow required.
2. **DNS-01 alternative (TODO, not yet wired).** For environments
   that disable inbound `:443` from the public internet but need
   inbound `:8443` only, switch the Traefik ACME resolver to DNS-01
   (e.g. via the Traefik DNS provider matching your DNS host). Plan
   10 ships the entrypoint topology; the DNS-01 hook lands when an
   operator first asks for it.

In K8s deployments using cert-manager, the same `Secret` is mounted
into both `Listener` resources — cert-manager handles the renewal,
both entrypoints pick up the new material on Traefik's rolling
config refresh.

### Soak validation (nightly)

`.github/workflows/nightly-realtime-soak.yml` runs a 65-minute live
soak against the **real OpenAI Realtime API** every night at 06:00 UTC
and on every `v*` tag push. The soak exercises the FULL production
chain (Traefik `:8443` → Fastify api proxy → LiteLLM `mode:realtime` →
OpenAI Realtime), records every WS close frame, and uploads the
close-frame log as a workflow artifact (`realtime-soak-log`) regardless
of pass/fail. The job's `if:` guard restricts execution to scheduled
events / tag pushes / `workflow_dispatch` — PRs (including from forks)
cannot trigger it, so contributors never accidentally consume OpenAI
budget.

The 5-minute hermetic counterpart (`tests/e2e/realtime-soak-hermetic.test.ts`,
exercised by `make e2e-test`) is the per-PR gate. Both share the same
close-code attribution table (RESEARCH §2.10):

| Close code | Origin | Verdict |
|------------|--------|---------|
| 1000 (normal) | either side | pass — clean close at end of soak |
| 1001 (going away) | Traefik shutdown | **FAIL if before T+3600s** — ingress disconnect |
| 1006 (abnormal) | upstream / network | log; tolerate (community-documented OpenAI flake) |
| 1011 (server error) | Traefik or Fastify | **FAIL** — ingress error |

If a nightly run fails, download the `realtime-soak-log` artifact (JSONL,
one event per line) — the close-frame attribution column tells you
whether the failure was ingress-side or upstream-side.

## Phase 4 — Streaming + Realtime env vars

Phase 4 added three env-keyed token-mint endpoints. Each refuses to
serve (returns `503` with operator-actionable wording) when the
corresponding key is missing, so a deployment without the key does not
silently break the desktop client — operators see the 503 and know to
configure the key. **Missing-key 503 is intentional D-18 behavior; do
NOT diagnose it as a server fault.**

| Env var | Required | Default | Consumed by | Notes |
|---------|----------|---------|-------------|-------|
| `ASSEMBLYAI_API_KEY` | for `/api/streaming-token` | none — route returns 503 if absent | `apps/api/src/routes/tokens/assemblyai.ts` | AssemblyAI v3 streaming token mint (Plan 03; D-14, D-18). |
| `ASSEMBLYAI_TOKEN_TTL` | optional | `60` (seconds) | `apps/api/src/routes/tokens/assemblyai.ts` | Override only if the desktop client's keepalive cadence demands it. |
| `DEEPGRAM_API_KEY` | for `/api/deepgram-streaming-token` | none — route returns 503 if absent | `apps/api/src/routes/tokens/deepgram.ts` | Deepgram Grant Token (Plan 03; D-15, D-18). |
| `DEEPGRAM_TOKEN_TTL` | optional | `30` (seconds) | `apps/api/src/routes/tokens/deepgram.ts` | Same caveat as `ASSEMBLYAI_TOKEN_TTL`. |
| `OPENAI_API_KEY` | for `/api/openai-realtime-token` and `/v1/realtime` | none — route returns 503 if absent | `apps/api/src/routes/tokens/openai-realtime.ts`, LiteLLM realtime upstream | Already documented for the Phase 3 realtime WSS proxy (D-12); Phase 4 adds the parallel-mint route (`streams=2`) via `/v1/realtime/client_secrets` (Plan 04; D-16, D-17). |
| `DEFAULT_AGENT_MODEL` | optional | `qwen/qwen3.6-plus` | `apps/api/src/routes/agent/stream.ts` | Override the default model id for `/api/agent/stream` requests that don't pass `model:` in the body. |

All three token routes share a per-user 30/min rate limit keyed on
`req.user.id` (T-04-04 mitigation: leaked-bearer abuse is bounded
per-user, not per-IP).

### Troubleshooting `/api/agent/stream`

The route emits NDJSON with `Content-Type: application/x-ndjson` AND
the `X-Accel-Buffering: no` header so Traefik does not buffer the
stream. Headers are flushed BEFORE the upstream LLM call so the desktop
client can render `Connecting…` UI within the first-byte budget
(WIRE-07 SC#1: round-trip < 500ms — verified by
`tests/e2e/agent-stream-first-line-latency.test.ts`).

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `200 OK` with a single terminal NDJSON line `{type:"finish", finishReason:"upstream_error", ...}` | LiteLLM upstream unavailable AFTER headers flushed (per BACKEND_SPEC contract — the route cannot retroactively change status once the first byte is on the wire) | Grep api logs for the matching `x-litellm-call-id` header — LiteLLM emits this on every upstream attempt; the value identifies which provider/model failed. |
| Stream hangs > 60s with no chunks | Traefik buffering middleware accidentally re-introduced on the route | Verify `X-Accel-Buffering: no` is present on the response and `compose/traefik/dynamic.yml` has no `buffering` middleware on the `agent-stream` router (Plan 05 Test 5 pins this). |
| `503` immediately on first POST | `OPENAI_API_KEY` (or operator's chosen `DEFAULT_AGENT_MODEL` provider key) absent | Set the key in `.env` and restart the api container. |

Cross-references:
- Wire shapes: `BACKEND_SPEC.md` `/v1/realtime` + `/api/agent/stream`
  + `/api/streaming-token` + `/api/deepgram-streaming-token` +
  `/api/openai-realtime-token` sections.
- Threat model: `.planning/phases/04-streaming-realtime/04-CONTEXT.md`
  T-04-01 (missing-key leakage), T-04-02 (long-timeout DoS),
  T-04-04 (leaked-bearer rate-limit), T-04-COST (CI cost prevention).

## Load Testing

> **Phase 8 deliverable.** This section is the operator-facing runbook for the
> on-demand load-test pipeline. Audience: a self-host operator (single VM or
> small K8s cluster) who needs to (a) reproduce the published SLO numbers on
> their own hardware, (b) re-baseline after an architectural change, (c)
> decide whether a regression is hardware-bound or architecture-bound. The
> nightly-CI cadence originally implied by TEST-LOAD-01 was explicitly
> deferred — see "Cadence and deferrals" below.

### Overview

OpenWhispr ships TWO load-test profiles. Each has a distinct purpose:

| Profile | LLM upstream | Purpose | Hardware ask |
|---|---|---|---|
| `mock` | `compose/mock-litellm` Fastify stub with simulated latency (1500 ms ± 400 transcribe, 300 ms ± 80 chat, ~200 ms ± 50 first stream token) | Measure the **gateway**: auth, DB, PgBouncer, Valkey, ingress, NDJSON / WSS frame plumbing in isolation. Numbers are architecture-bound. | Any dev box. 1000 VU × 30 min plateau passes on a Mac M-series with 32 GB allocated to Docker. |
| `realistic` | Bundled Speaches (Whisper-large-v3 + pyannote) routed through LiteLLM per `docs/litellm-target-spec.md` — plus paid providers (OpenRouter / OpenAI Realtime) on a 10-call smoke gate | Prove the **wiring** is correct against real STT + chat + realtime upstreams. Numbers on a Mac are **advisory only** — Whisper CTranslate2 saturates CPU on Apple Silicon per `08-RESEARCH.md` §Pitfall 2. | Plateau requires H100-class GPU. Mac runs the boot + smoke + short baseline; the operator re-runs the plateau on GPU hardware to substitute production numbers. |

The mock profile is what an operator with a corporate LiteLLM target (per
`docs/litellm-target-spec.md`) should use to size their gateway tier — the
mock numbers are the **gateway p95** with the LLM out of the picture, which
is exactly what corporate LiteLLM ops want.

### How to run

```sh
# Mock baseline — 1000 VU × 30 min on the local docker-compose stack
make load-test PROFILE=mock

# Realistic profile — boot + 60s smoke; plateau deferred to GPU operator
make load-test PROFILE=realistic

# Paid-provider proof-of-wiring (10 calls, ~$0.02 cost) — realistic profile only
bash tools/load-test/scripts/smoke-paid.sh
```

All three commands assume `make up` has brought the canonical docker-compose
stack online and `.env` carries the provider keys documented in
`.env.example` (HF_TOKEN, OPENROUTER_API_KEY, OPENAI_API_KEY for the
realistic profile; none required for mock).

Raw k6 JSON output and human-readable summary are written under
`.planning/phases/08-load-test-tuning-slo-publication/runs/<UTC>-{mock,realistic}-*.json`.
The latest mock baseline (Run 5, commit `a5e5920`, 2026-05-13) is the source
of the SLO tables below.

### Cadence and deferrals

**Manual, on-demand.** Re-run after any architectural change to the request
path, the data layer, or the bundled LiteLLM target. Nightly CI cadence and
the matching regression-gate are deferred per the Phase 8 amendment to
TEST-LOAD-01 (see `.planning/REQUIREMENTS.md` for the v2 ambition). Phase 8
ships the manual baseline and the operator runbook; future automation
re-opens TEST-LOAD-01 in a post-v1 phase.

### Mix ratios (v1 assumed)

| Endpoint | Weight |
|---|---:|
| POST `/api/transcribe` | 50% |
| POST `/api/reason` | 25% |
| POST `/api/agent/stream` | 15% |
| WSS `/v1/realtime` | 10% |

These are **assumed** ratios derived from the desktop client's expected
workload. Revisit after the first round of operator feedback.

### Published SLO budgets — mock profile (gateway p95, LLM excluded)

Baseline from `runs/2026-05-12T22-47-48Z-mock-summary.json` (Run 5, commit
`a5e5920`). SLO budget = measured p95 × 1.20 (the D-SLO-1 +20% headroom).
Numbers are SOURCED — not extrapolated.

| Endpoint | Observed p95 (ms) | SLO p95 (ms) | Notes |
|---|---:|---:|---|
| transcribe | **2521** | **3025** | Mock injects 1500 ms ± 400 ms STT latency; remainder is gateway + multipart + auth |
| reason | **1209** | **1451** | Mock injects 300 ms ± 80 ms chat latency; remainder is gateway + JSON parse + auth |
| agent-stream TTFB | **610** | **732** | Time-to-first-byte (per `08-RESEARCH.md` §Pitfall 6 — first byte, not total) |
| agent-stream total | **1127** | **1352** | Headers flushed before upstream call; full NDJSON stream completion |
| realtime-ws roundtrip | **41** | **49** | Mock echo handler is zero-latency; on H100 with real Speaches / OpenAI Realtime upstream this will fill the [50, 1000] ms plausibility window — see `OPERATOR_RERUN_ON_GPU` note below |

Stack health under the same run: error rate **0.106%** (6/6 k6 thresholds
PASS), 1000 VU × 30 min sustained, 944,988 HTTP requests @ 510.7 rps, **0**
container restarts, **0** prepared-statement errors, **0** rate-limit hits.

> **`OPERATOR_RERUN_ON_GPU` — realtime-ws p95 41 ms.** This is the mock-floor
> (the echo handler responds within a single event-loop tick). On H100 with
> the real Speaches `/v1/realtime` (or OpenAI Realtime upstream), the
> measured p95 will fall in the [50, 1000] ms plausibility window from
> RESEARCH §Pitfall 6. Substitute the GPU number when published — the
> wiring is the deliverable, the floor number is not a production target.

### Published SLO budgets — realistic profile (end-to-end, Mac CPU inference)

The realistic profile plateau was **DEFERRED** on the developer Mac per
Plan 08.5 (the `08-RESEARCH.md` §Pitfall 2 hardware-bound condition: Apple
Silicon Docker has no GPU passthrough, and Speaches Whisper-large-v3 CPU
inference is roughly 1× realtime per process — 1000 VU would saturate the
single inference worker and produce hardware-bound numbers).

What DID run on Mac: a 10-call paid-provider smoke (commit `11d21f3`)
proving all 5 production endpoints LIVE through the canonical
`speaches-audio.md` wiring:

1. `/api/reason` → LiteLLM → OpenRouter
2. `/api/agent/stream` SSE → OpenRouter
3. `/api/transcribe` → Speaches Whisper-large-v3 local (returned real text "Thanks for watching!" on the sample WAV)
4. WSS `:8443/v1/realtime` → Speaches local (session.created with input_audio_transcription model = Systran/faster-distil-whisper-large-v3)
5. Sign-up via Better Auth

| Endpoint | Mac p95 (ms) | SLO p95 (ms) | Notes |
|---|---|---|---|
| transcribe | **DEFERRED** | **OPERATOR_RERUN_ON_GPU** | Mac CPU saturates Whisper; numbers advisory only until H100 re-run |
| reason | **DEFERRED** | **OPERATOR_RERUN_ON_GPU** | Chat path identical to mock; mock SLO applies until measured separately |
| agent-stream TTFB | **DEFERRED** | **OPERATOR_RERUN_ON_GPU** | — |
| agent-stream total | **DEFERRED** | **OPERATOR_RERUN_ON_GPU** | — |
| realtime-ws roundtrip | **DEFERRED** | **OPERATOR_RERUN_ON_GPU** | — |

See `.planning/phases/08-load-test-tuning-slo-publication/08-05-SUMMARY.md`
and `.planning/phases/08.5-realistic-profile-boot-and-baseline/08.5-03-STATUS.md`
for the operator H100 re-run recipe (next subsection).

### Sizing matrix

| Topology | CPU | RAM | Max concurrent | PgBouncer pool | Observed transcribe p95 |
|---|---:|---:|---:|---|---:|
| compose single-host (Mac M-series, 32 GB allocated to Docker) | 16 vCPU | 32 GB | 1000 VU sustained 30 min | 4 instances × 100 server pool = 400 backend | 2521 ms (mock); realistic DEFERRED |
| Helm small (Phase 9) | TBD | TBD | TBD | TBD | TBD |
| Helm large with GPU pool (Phase 9) | TBD | TBD | TBD | TBD | TBD |

The Helm rows are intentionally `TBD` — they ship with Phase 9 (Helm chart +
cloud deploy + GPU node-selector). Phase 8 publishes the compose row only,
sourced from the on-Mac live run.

### PgBouncer tuning rationale

- **4 instances × 100 server pool = 400 backend connections.** The compose
  load-test profile scales `pgbouncer` to 4 replicas behind a single
  service hostname.
- Postgres `max_connections = 500` (≥ pool + small admin headroom for
  `psql` interactive sessions during incident response).
- **Transaction mode** + `MAX_PREPARED_STATEMENTS=200` — preserves Drizzle
  compatibility per `08-RESEARCH.md` §Pitfall 3. Older pinned PgBouncer
  versions (< 1.23) cannot run prepared statements in transaction mode;
  the compose pin is `pgbouncer:1.23+`.
- **Verified under load (Run 5):** `cl_waiting / cl_active < 5%` across the
  20-min sustained block. `SHOW POOLS` returned rows under the
  `pgbouncer_admin` SCRAM credential (closed by Plan 08.1 — see
  `compose/pgbouncer/bootstrap.sh`). No `wait_time` accumulation.
- **No backpressure spikes** at 510.7 rps sustained.

### File-descriptor probe contract (D-TUNE-2)

- `apps/api` and `traefik` containers **require** `ulimit -n ≥ 65535`.
- ENTRYPOINT probe at `apps/api/scripts/fd-probe.sh` (api side) and
  `/usr/local/bin/fd-probe.sh` (traefik side) refuses to start if
  `ulimit -n < 65535` — the container exits non-zero with a clear stderr
  message rather than silently regressing to the OS default of 1024.
- Under the load-test profiles, `docker-compose.load-test.yml` explicitly
  sets `ulimits: nofile: { soft: 65535, hard: 65535 }` on both services.
- Default Docker on Linux already lifts the limit; the probe exists for
  Mac / Windows / older Docker Desktop installations where the host
  defaults can leak into the container.

### Limitations — architecture-bound vs hardware-bound

A reader on H100 hardware needs to know which numbers to trust as-is and
which to re-measure. The categorization:

- **Architecture-bound (trust as-is, mock profile):** Every mock-profile
  SLO above. The LiteLLM upstream is a deterministic Fastify stub with
  controlled latency; everything else in the chain (auth, ingress, DB,
  PgBouncer, Valkey, k6 client, multipart parser, NDJSON / WSS frame
  plumbing) is the actual code. Numbers move only when the code does.
- **Hardware-bound (re-measure on production hardware, realistic profile):**
  Every realistic-profile cell. Apple Silicon Docker has no GPU
  passthrough; Whisper-large-v3 on CPU runs at roughly 1× realtime per
  process. The realistic profile on Mac proves the **wiring** (compose
  topology, LiteLLM config per `docs/litellm-target-spec.md`,
  speaches-audio.md routing); the **numbers** require an H100 re-run.
- **Floor metrics (mock-bound, will fill window on real upstream):** The
  realtime-ws roundtrip 41 ms is the echo-handler floor (zero-latency
  same-process echo). Real Speaches `/v1/realtime` or OpenAI Realtime
  upstream will fill the [50, 1000] ms plausibility window from
  RESEARCH §Pitfall 6.
- **v1 mix-ratio assumption:** 50/25/15/10 reflects the assumed desktop
  workload. Revisit after operator feedback.
- **No regression CI gate (yet):** Phase 8 publishes baselines; future
  automation (post-v1 TEST-LOAD-01 amendment) wires regression checks.
- **`OPENWHISPR_DISABLE_RATE_LIMIT`:** Load-test profiles ONLY. MUST NOT
  be set in production — the api logs a `WARN` at boot if it sees this
  env var outside a load-test profile.
- **Cloud GPU tuning:** Out of scope for Phase 8. Phase 9 (Helm) ships the
  GPU node-selector + HPA-on-GPU-utilization wiring for the Speaches
  worker tier.

### Operator H100 re-run recipe

After provisioning a GPU node (single H100 or L40S is sufficient for the
plateau) and pointing `DATABASE_URL` / `LITELLM_BASE_URL` at the cluster
endpoints, the same Makefile target reproduces the plateau with production
numbers — no re-engineering required, the realistic profile wiring is the
deliverable:

```sh
# On the GPU host with .env carrying real provider keys
make up                                  # bring the realistic-profile compose stack online
make load-test PROFILE=realistic         # 1000 VU × 30 min plateau (substitute production p95s)
# Commit the resulting runs/<UTC>-realistic-summary.json
# Update the realistic SLO table above by replacing DEFERRED with measured × 1.20
```

The Mac smoke (commit `11d21f3`) proves every endpoint in the chain is
correctly wired — Speaches local STT, OpenRouter chat, OpenAI Realtime WSS,
Better Auth sign-up, multipart upload. The GPU re-run substitutes the
**numbers**, not the **integration**.

Reference: `.planning/phases/08.5-realistic-profile-boot-and-baseline/08.5-03-STATUS.md`.

### Re-running after a suspected regression

1. Make the architectural change on a branch.
2. `make load-test PROFILE=mock` and inspect against the mock SLO table above.
3. If any new p95 > the published SLO (baseline × 1.20), either reject the
   change or justify + republish baselines (commit fresh
   `runs/<UTC>-mock-summary.json` and update this table in the same PR).
4. Realistic-profile re-run is optional but recommended for changes
   touching the audio / STT path, the LiteLLM config, or the Speaches
   container topology. On Mac it is the smoke gate only; on GPU it is the
   plateau.

## Helm chart (Kubernetes)

The `charts/openwhispr/` Helm chart wraps the full 18-service compose stack
into a single release for Kubernetes operators. The chart targets a vanilla
Kubernetes 1.28+ cluster with three operator-installed prerequisites
(CloudNativePG, Traefik 3, cert-manager) and an optional fourth prereq
(External Secrets Operator) when running in `secrets.mode=eso`.

### Prerequisites

| Prerequisite               | Version    | Purpose                                       | Install command (greenfield)                   |
| -------------------------- | ---------- | --------------------------------------------- | ---------------------------------------------- |
| CloudNativePG operator     | 1.29.x     | Postgres 17 HA Cluster + Pooler CRDs          | `bash charts/openwhispr/examples/cnpg-install.sh` |
| Traefik 3                  | 32.x chart | Ingress + dual entrypoints `:443` and `:8443` | `helm install traefik traefik/traefik -f charts/openwhispr/examples/traefik-values.yaml` |
| cert-manager               | v1.16+     | TLS issuance via ClusterIssuer                | `helm install cert-manager jetstack/cert-manager --set crds.enabled=true` |
| External Secrets Operator  | v0.10+     | OPTIONAL — only when `secrets.mode=eso`       | `helm install external-secrets external-secrets/external-secrets` |
| LGTM stack (Grafana/Tempo/Loki/Mimir) | latest | OPTIONAL observability backend     | `bash charts/openwhispr/examples/lgtm-install.sh` |
| NVIDIA device plugin       | latest     | OPTIONAL — only when `bundledAi.enabled=true` | `kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.16.2/deployments/static/nvidia-device-plugin.yml` |

The Traefik install MUST declare both `websecure` (:443) and
`websecure-realtime` (:8443) entrypoints. The chart ships a
`traefik-preflight` initContainer that refuses to start the api pod if the
second entrypoint is missing — see `charts/openwhispr/examples/traefik-values.yaml`
for the exact `--entrypoints.websecure-realtime.address=:8443` overlay.

### Install

```bash
# 1. Generate or supply 8 secrets (≥ 32 chars each) — see secrets posture below.
cp charts/openwhispr/examples/values-oss-quickstart.yaml my-values.yaml
# Edit my-values.yaml with your hostnames, secrets, postgres sizing, etc.

# 2. Build sub-chart dependencies (Bitnami Valkey + MinIO).
helm dependency build charts/openwhispr

# 3. Install — uses pre-install/pre-upgrade Helm-hook Job to run drizzle migrations.
helm install ow charts/openwhispr -f my-values.yaml \
  --namespace openwhispr --create-namespace \
  --wait --timeout 10m

# 4. Run the first-launch SLO probe (DEPLOY-05). Exits 0 if a fresh user can
#    sign-up and POST /api/transcribe in under 5 minutes end-to-end.
helm test ow --namespace openwhispr --timeout 5m
```

The chart's `helm test` hook runs the
`ghcr.io/openwhispr/openwhispr-test-probe:<appVersion>` image which
performs the full sign-up → bearer → transcribe round-trip and asserts
elapsedMs ≤ `testProbe.sloDeadlineMs` (default 300000 ms). The probe is
defined in `charts/openwhispr/templates/tests/first-launch-slo.yaml` and
its TARGET defaults to `https://{{ .Values.host.api }}`.

### Upgrade

```bash
git pull
helm dependency build charts/openwhispr
helm upgrade ow charts/openwhispr -f my-values.yaml \
  --namespace openwhispr \
  --wait --timeout 10m
helm test ow --namespace openwhispr --timeout 5m
```

The migrate Job is annotated `helm.sh/hook: pre-install,pre-upgrade` so it
runs BEFORE the rolling api/web/worker rollout. Each rollout is also
gated by:

  - readiness probes on `/api/health` (api), `/healthz` (web), and a TCP
    probe on the worker port — the rollout pauses if any pod fails.
  - the `traefik-preflight` initContainer described above (api only).
  - the `secret-presence-probe` initContainer in `secrets.mode=eso` mode
    (api + worker) — fails fast if the ESO sync hasn't materialized the
    Secret yet.

### Safe rollback (within one minor version)

```bash
# List release history
helm history ow --namespace openwhispr

# Roll back to revision N (must be within the same minor — schema rolls
# forward-compatible per the expand/contract migration discipline).
helm rollback ow N --namespace openwhispr --wait --timeout 10m
```

**Migration expand/contract dance.** Drizzle migrations are written
backwards-compatible across one minor version:

  1. Expand (release v0.N.0): add new column NULL-defaulting; write code
     to BOTH columns; reads still tolerate the old column.
  2. Backfill (release v0.N.1 or operator-driven): online backfill of the
     new column from the old one.
  3. Contract (release v0.N+1.0): drop the old column; reads switch to
     the new column.

Rolling back across an expand-contract boundary (e.g. v0.N+1.0 → v0.N.0)
is NOT safe; treat such boundaries as one-way doors. The
`tools/lint-migrations.ts` squawk gate blocks migrations that violate
expand/contract patterns (e.g. dropping a column in the same release
that added its replacement).

### Secrets posture

The chart supports two modes via `secrets.mode`:

#### helm-values mode (default — OSS quickstart)

Operator supplies all 8 secrets via `--set-string secrets.<key>=…` or a
sealed values file. The chart renders an inline `Secret` resource with
`helm.sh/resource-policy: keep` so `helm uninstall` does not delete it.

Required keys (chart enforces ≥ 32 chars and rejects `CHANGE_ME` /
`changeme` placeholders at render time):

  - `secrets.litellmMasterKey`
  - `secrets.openrouterApiKey`
  - `secrets.openaiApiKey`
  - `secrets.pyannoteApiKey`
  - `secrets.hfToken`
  - `secrets.postgresOwnerPassword`
  - `secrets.pgbouncerAdminPassword`
  - `secrets.betterAuthSecret`

#### eso mode (corporate)

```yaml
secrets:
  mode: eso
  external:
    storeRef: vault-clusterstore
    storeKind: ClusterSecretStore
    path: openwhispr
    refreshInterval: 1h
```

The chart renders an `ExternalSecret` referencing the named
`ClusterSecretStore` (or `SecretStore`) instead of inline values. The
operator pre-creates the SecretStore pointing at Vault / AWS Secrets
Manager / GCP Secret Manager and populates the `path` with the same 8
keys. The `secret-presence-probe` initContainer on every app pod fails
fast (exit 1, restart) if ESO hasn't materialized the target Secret yet,
giving the rollout visibility into the sync race rather than a silent
500 cascade.

### Backup and restore

The CNPG Cluster CR (`templates/postgres-cluster.yaml`) ships with a
`barmanObjectStore` block writing WAL + base backups to MinIO (or the
configured `postgres.backup.objectStore` S3 bucket) every
`postgres.backup.scheduleCron` (default `@daily`). Point-in-time recovery
via `kubectl cnpg pitr` (CNPG plugin) reconstructs the cluster to any
WAL timestamp within retention. Retention defaults to 14 days; tune via
`postgres.backup.retentionPolicy`.

### Troubleshooting

| Symptom                                                          | Diagnosis                                                                                                                          | Fix                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `helm install` fails with `values.secrets.litellmMasterKey is empty` | The render-time `fail` gate caught a missing or placeholder secret. | Generate 32+ char random strings: `openssl rand -base64 32 \| tr -d '\n=' \| cut -c1-40`. Supply all 8 keys, or switch to `secrets.mode=eso` and create the SecretStore out-of-band.                                                                                          |
| api pod CrashLoopBackOff, init container `traefik-preflight` failing | Traefik install is missing the `:8443 websecure-realtime` entrypoint. | Add `--entrypoints.websecure-realtime.address=:8443` to the Traefik install or follow `charts/openwhispr/examples/traefik-values.yaml` exactly.                                                                                                                              |
| api pod CrashLoopBackOff, init container `secret-presence-probe` failing (eso mode) | ESO hasn't synced the Secret yet, or the SecretStore is misconfigured. | `kubectl -n openwhispr describe externalsecret openwhispr-secrets` and `kubectl get secretstore -A` — check the `Status.Conditions` for the underlying error.                                                                                                                |
| migrate Job stuck in Init/Pending                                  | CNPG cluster not yet ready; init container `pg_isready` is looping against the `-rw` service. | `kubectl -n openwhispr get cluster ow-openwhispr-pg` — confirm `Status.Phase: Cluster in healthy state`. Bump `postgres.replicas` only after replicas are joined.                                                                                                             |
| Postgres pod exits with `could not load library pg_partman_bgw`    | `postgres.imageName` not pointing at the custom `cnpg-postgres-17-pgpartman` image, OR `postgres.shared_preload_libraries` missing `pg_partman_bgw`. | Confirm `postgres.imageName: ghcr.io/openwhispr/openwhispr-cnpg-postgres-17-pgpartman:17.6-<chart-version>`; values.schema.json enforces `:17.*` via regex.                                                                                                                  |
| Bundled-AI Speaches pod Pending with `0/3 nodes available: no nodes match nvidia.com/gpu.present` | GPU node label missing or NVIDIA device plugin not installed.            | `kubectl get nodes -L nvidia.com/gpu.present`. Install the NVIDIA device plugin (see Prerequisites) and label your GPU node(s) `nvidia.com/gpu.present=true`. Or disable bundled AI: `--set bundledAi.enabled=false`.                                                       |
| cert-manager Certificate stuck `Issuing`                          | ClusterIssuer misconfigured or DNS-01 / HTTP-01 challenge failing.    | `kubectl describe certificate openwhispr-api-tls -n openwhispr`; `kubectl describe clusterissuer letsencrypt-prod`. For air-gapped clusters use the internal CA ClusterIssuer template at `charts/openwhispr/examples/cert-manager-clusterissuer-internal-ca.yaml`.           |
| `helm test` fails with `transcribe-non-200`                       | LiteLLM upstream unreachable, or transcribe SLO budget exceeded.       | `kubectl -n openwhispr logs deploy/ow-openwhispr-litellm` for the embedded LiteLLM (or check `LITELLM_BASE_URL` connectivity in external mode); `kubectl logs <test-pod>` for the probe's structured JSON `step` field.                                                       |
| Upgrade-matrix CI fails on integrity-check                        | Migration dropped or mutated `transcriptions` columns the seed depends on. | Inspect `tools/seed-test-data.js` — if a column was renamed legitimately, update SEED_ROWS + integrity-check to match the new schema. If unintended, the upgrade-matrix has caught a regression — revert.                                                                    |

## Upgrade runbook

OpenWhispr Server follows semver across the chart, the api image, and
the worker image. Minor and patch releases are upgrade-in-place;
major releases ship a migration guide alongside the release notes.

### Helm chart upgrade (Kubernetes)

```bash
# 1. Inspect the diff between the deployed values and the new chart defaults.
helm get values ow -n openwhispr > /tmp/current-values.yaml
helm show values openwhispr/openwhispr --version <new-version> > /tmp/new-defaults.yaml
diff -u /tmp/current-values.yaml /tmp/new-defaults.yaml | less

# 2. Run the upgrade with --atomic so a failed rollout auto-rolls-back.
helm upgrade ow openwhispr/openwhispr \
  --version <new-version> \
  -n openwhispr \
  -f /tmp/current-values.yaml \
  --atomic \
  --timeout 10m

# 3. The chart's pre-upgrade hook runs the `migrate` Job. The Job uses
#    `openwhispr_migrate` role (NOT `openwhispr_app`) and runs
#    `drizzle-kit migrate` against the `-rw` CNPG service. The api
#    Deployment is held back until the Job reports Succeeded.

# 4. Verify rollout health.
kubectl -n openwhispr rollout status deploy/ow-openwhispr-api
kubectl -n openwhispr rollout status deploy/ow-openwhispr-worker
kubectl -n openwhispr exec -it deploy/ow-openwhispr-api -- curl -s http://localhost:3000/api/health
```

### Rollback (Helm)

```bash
helm history ow -n openwhispr           # find the previous revision
helm rollback ow <revision> -n openwhispr --wait --timeout 10m
```

**Critical:** Helm rollback does NOT roll back the database migration.
If the new release added a column or table, the old release will
either ignore it (additive change — safe) or fail to start (breaking
change — fix forward, do not roll back). Phase 9 enforces additive-only
migrations via the `lint-migrations` CI gate, so rollback is always
safe within the OpenWhispr release stream.

### docker-compose upgrade (single-VM)

```bash
# 1. Snapshot the database BEFORE pulling the new images.
make backup

# 2. Pull the new images.
docker compose pull api worker web litellm

# 3. Run migrations in a one-shot container.
docker compose run --rm --entrypoint "node dist/scripts/migrate.js" api

# 4. Restart api + worker + web.
docker compose up -d api worker web
```

A pre-flight check is in `tools/preflight-upgrade.sh`: it verifies the
target image's `LABEL openwhispr.compose.compatible=>=N` matches the
running `docker-compose.yml` schema before pulling.

---

## Scale runbook

OpenWhispr Server is built to scale horizontally on three axes: api
replicas, worker replicas, and CloudNativePG read-replicas.

### api replicas (HPA on CPU + p95 latency)

The Helm chart ships a `HorizontalPodAutoscaler` for the api
Deployment. Defaults:

```yaml
api:
  hpa:
    enabled: true
    minReplicas: 2
    maxReplicas: 20
    targetCPUUtilizationPercentage: 70
    targetP95LatencyMillis: 800       # Prometheus adapter metric
```

The `targetP95LatencyMillis` knob requires the `prometheus-adapter`
chart installed and pointed at Mimir / Prometheus. Without it, the
HPA falls back to CPU-only.

To scale manually past the HPA ceiling:

```bash
kubectl -n openwhispr scale deploy/ow-openwhispr-api --replicas=30
# then bump the HPA ceiling so the manual scale isn't immediately scaled down
kubectl -n openwhispr patch hpa ow-openwhispr-api \
  --type='json' -p='[{"op":"replace","path":"/spec/maxReplicas","value":30}]'
```

### worker replicas (HPA on BullMQ queue depth)

The worker HPA scales on the `bullmq_queue_depth` Prometheus metric
exposed by `prometheus-redis-exporter`. Defaults:

```yaml
worker:
  hpa:
    enabled: true
    minReplicas: 1
    maxReplicas: 10
    queues:
      emailDelivery:
        scaleTargetDepth: 200          # +1 replica per 200 queued jobs
      auditArchive:
        scaleTargetDepth: 50
```

Per-queue concurrency is set via `WORKER_CONCURRENCY_<QUEUE>` env
vars on the worker container (see `apps/worker/src/queues.ts` for the
defaults). Scaling worker replicas is preferred over bumping
concurrency past 10 per replica because BullMQ's locking semantics
keep getting better with more independent workers.

### CloudNativePG read-replicas

```bash
# Add a read-replica.
kubectl -n openwhispr patch cluster ow-openwhispr-pg \
  --type='merge' -p '{"spec":{"instances":3}}'
```

CNPG bumps `instances` from 3 to N and joins the new replica via
streaming replication. The api / worker app pools point at the `-rw`
service for primary writes and `-ro` for read traffic; Drizzle does
not auto-split read vs write, so an explicit `withReadReplica()`
helper is the v2 deliverable. In v1 all traffic hits `-rw`; replicas
are warm standbys for failover and ad-hoc analytics.

---

## Restore drill

The full restore from a CNPG `barmanObjectStore` backup is a
production-critical operation. Practice it quarterly.

### RTO/RPO targets (Phase 8 SLO publication)

| Metric | Target                                    |
| ------ | ----------------------------------------- |
| RPO    | 15 minutes (WAL archive frequency)        |
| RTO    | 30 minutes (Helm install + WAL replay)    |

### Restore procedure (CNPG point-in-time)

```bash
# 1. Identify the target timestamp.
TARGET_TS=2026-05-13T12:00:00Z

# 2. Install the kubectl-cnpg plugin if missing.
kubectl krew install cnpg

# 3. Trigger the PITR clone. The new cluster boots from the latest base
#    backup at or before TARGET_TS, then replays WAL up to that timestamp.
kubectl cnpg pitr restore \
  --cluster ow-openwhispr-pg \
  --target-time "$TARGET_TS" \
  --new-cluster-name ow-openwhispr-pg-restore \
  -n openwhispr

# 4. Wait for the restore cluster to come up.
kubectl -n openwhispr get cluster ow-openwhispr-pg-restore -w

# 5. Repoint the api + worker at the restore cluster.
helm upgrade ow openwhispr/openwhispr \
  -n openwhispr \
  --reuse-values \
  --set postgres.existingClusterName=ow-openwhispr-pg-restore

# 6. Smoke-test.
curl -fsS https://api.example.com/api/health | jq .
```

### Verification checklist

- [ ] PITR cluster reaches `Status.Phase: Cluster in healthy state`.
- [ ] api `/api/health` returns 200.
- [ ] worker logs show `event=worker.boot.queues_attached` for all 9 queues.
- [ ] `SELECT max(created_at) FROM audit_log` is at or near `$TARGET_TS`.
- [ ] At least one cross-tenant RLS sanity probe (run
      `apps/api/scripts/post-restore-rls-probe.ts`).

### Restoring on docker-compose

```bash
make restore BACKUP=/path/to/age-encrypted-pg_dump.age
```

This decrypts the backup with the configured `age` identity, drops
and re-creates the database, and replays the dump. Downtime is the
length of the dump replay (typically 5-15 minutes on a 50 GB
database).

---

## i18n volume runbook (LOCALES_DIR override)

OpenWhispr Server bundles two runtime locales (`en` + `ru`). Operators
can override or extend the bundled translations at runtime via the
`LOCALES_DIR` env var. See [`i18n.md`](./i18n.md) for the full
operator guide; this section is the operations runbook.

### docker-compose override

`docker-compose.yml` already binds `./locales:/app/locales:ro` and
sets `LOCALES_DIR=/app/locales` on the api and worker services. To
activate an override on a running install:

```bash
# 1. Mirror the bundled structure into ./locales/.
mkdir -p locales/en locales/ru
# Override only the namespaces you want to replace. Files NOT in the
# override dir fall back to the bundled dist/i18n/locales.
cp /path/to/custom/en/errors.json locales/en/errors.json

# 2. Restart api + worker.
docker compose restart api worker

# 3. Verify the override took effect.
docker compose logs api | grep i18n.locales_dir
# expect: event=i18n.locales_dir, dir=/app/locales, locales=[en,ru]
```

### Kubernetes (Helm) override

```bash
# 1. Create the ConfigMap from a directory tree.
kubectl create configmap openwhispr-locales-override \
  --from-file=locales/ \
  -n openwhispr

# 2. Enable the override in values.
helm upgrade ow openwhispr/openwhispr \
  -n openwhispr \
  --reuse-values \
  --set i18n.overrides.enabled=true \
  --set i18n.overrides.configMapName=openwhispr-locales-override

# 3. Verify.
kubectl -n openwhispr logs deploy/ow-openwhispr-api | grep i18n.locales_dir
```

### Operator validation steps

1. Confirm `LOCALES_DIR` is set on the api and worker (env-var
   inspection: `docker compose config | grep LOCALES_DIR` or
   `kubectl -n openwhispr exec deploy/ow-openwhispr-api -- env | grep LOCALES_DIR`).
2. Confirm the mounted directory is readable (`docker compose exec
   api ls -la $LOCALES_DIR` or the equivalent `kubectl exec`).
3. Confirm the JSON parses (the api emits
   `event=i18n.locales_dir_invalid, reason=...` on parse failure and
   refuses to serve traffic; readiness probe fails).
4. Confirm at least one localized error envelope renders the override
   text:

   ```bash
   curl -fsS https://api.example.com/api/health \
     -H "Accept-Language: ru" \
     -H "X-Force-Error-For-Operator-Check: validation_failed" \
     | jq .
   ```

   (The `X-Force-Error-For-Operator-Check` header is a debug-only
   knob; enable it via `OPENWHISPR_DEBUG_HEADERS=1` and disable in
   production.)

### Troubleshooting

| Symptom                                                      | Diagnosis                                                              | Fix                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| api logs `event=i18n.locales_dir_invalid`                    | JSON parse failure in override file.                                   | `jq . locales/<lng>/<ns>.json` finds the offending file; fix the syntax and `docker compose restart api`. |
| Verification email still in English after `users.locale='ru'`| The user's locale was null when Better Auth fired `sendVerificationEmail`. | Update `users.locale` first, then trigger a re-send via the user settings page or `pnpm bulk-update-locale`. |
| Override file present but bundled text still shows           | `LOCALES_DIR` not set or pointing at the wrong path.                   | Check the boot log: api emits `event=i18n.locales_dir_fallback, reason=env_unset` if `LOCALES_DIR` is empty. |
| Russian email body shows `[missing translation: ...]`        | Override directory has the `en` bundle but not `ru`.                   | Add the matching `ru/` files. Falling back to `en` is the default; the placeholder appears only with `returnNull: false` configured in i18next. |

---

## Future phases

- **Phase 10 (this document):** full operator handbook (deploy / upgrade
  / scale / backup / restore / troubleshoot / i18n) — completed by
  Plan 10-03.
