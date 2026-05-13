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

## Future phases

- **Phase 9:** Helm chart deploy + upgrade-matrix discipline; Helm small / large rows in the sizing matrix above
- **Phase 10:** full operator handbook (deploy / upgrade / scale / backup / restore / troubleshoot) — re-uses this document
