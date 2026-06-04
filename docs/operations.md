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

## Local development test prerequisites

The api-package integration test suite (`apps/api/tests/unit/routes/**/*.integration.test.ts`)
boots a real Postgres 17.5 + pg_partman testcontainer via the shared
`getSharedRoutePool()` fixture (Phase 18.1.2 / Plan 05). To run the full
test suite locally:

1. **Docker daemon.** Docker Desktop, OrbStack, or `dockerd` on Linux must
   be running and reachable. Verify with `docker version && docker info`
   before launching tests; the testcontainers library otherwise hangs for
   180 s before failing.

2. **mkcert.** Run `make tls-trust` once per machine to install the local
   mkcert root CA. Required for any test that talks to the compose stack
   over HTTPS (e2e suite + Phase-6 e2e-quick). See "Air-gap mkcert
   installation" below for offline operator instructions.

3. **`ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1` image.** The shared-pg fixture
   pins to the published GHCR image (`compose/postgres/Dockerfile` —
   Postgres 17.5 with pg_partman 5.2.4 in the `partman` schema; migration
   `packages/data/migrations/0014_audit_log_partition.sql` fails without
   it). The standard `postgres:17-alpine` upstream image does NOT ship
   pg_partman. Pull on first use:

   ```sh
   # Canonical recipe (image published by .github/workflows/release.yml):
   docker pull ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1
   # OR build locally from source (offline / dev iteration):
   docker build ./compose/postgres -t ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1
   # OR if the image is mirrored to your internal registry:
   docker pull <internal-registry>/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1
   ```

   The CI `test` job pulls from GHCR via testcontainers; CI's `lint-rls`
   + `test-migration` jobs build locally with tag `:ci` for in-job
   self-containment. Local devs pull once and let the testcontainers
   reuse daemon keep the image warm thereafter.

   **Background:** Phase 18.1.2 / Plan 05 introduced the shared-pg
   fixture and surfaced the missing-image symptom on fresh clones via
   `.planning/phases/08-client-server-audit/SERVER-ERRORS.md` Entry 3
   ("test-suite fails on first run without an out-of-band image build").
   The production migration is canonical (no migration code fix is
   needed — pg_partman is the documented extension dependency); Entry 3
   is a documentation deliverable, not a code defect. This subsection
   is its closing artifact (Phase 19 / Plan 01 / SR-19.5, D-15).

4. **pnpm workspace bootstrap.** Run `pnpm install --frozen-lockfile`
   before the FIRST test run, and after every `pnpm-lock.yaml` change.
   `pnpm test` will fail with module-resolution errors on a fresh clone
   without this step.

5. **Optional: disable Ryuk for stable local runs.** When iterating on
   integration tests, set `TESTCONTAINERS_RYUK_DISABLED=true` in your
   shell so the shared Postgres container survives between vitest
   invocations. The container is labeled `org.testcontainers.reuse=true`
   and `getSharedPostgres()` will reattach instead of booting a fresh
   instance. Tear down manually with:

   ```sh
   docker ps -a --filter "label=org.testcontainers=true" --format '{{.ID}}' \
     | xargs -r docker rm -f
   docker volume prune -f
   ```

   The CI `test` job mirrors this discipline (see
   `.github/workflows/ci.yml::test` — `TESTCONTAINERS_RYUK_DISABLED=true`
   + `if: always()` sweep step) for parity between local and CI runs.

6. **Per-package `--project=<name>` filter.** `pnpm --filter @openwhispr/api test`
   et al. inherit the root config's `projects:` array via mergeConfig,
   which would otherwise pull `tests/integration`, `tests/self-tests`,
   `tools`, and other workspace projects into the run. Package
   `package.json` test scripts pin the filter:

   ```bash
   pnpm --filter @openwhispr/api    test   # 147 files / 1299 tests, ~98s
   pnpm --filter @openwhispr/worker test   # ~20s
   pnpm --filter @openwhispr/web    test   # 65 files / 963 tests, ~15s
   pnpm --filter @openwhispr/data   test   # testcontainers, ~minutes
   ```

   If a contributor adds a new workspace package with its own
   `vitest.config.ts` that uses `mergeConfig(rootConfig, …)`, they
   MUST add `name: "<pkg>"` + update the `test` script to
   `vitest run --project=<pkg>` so the same isolation applies.

7. **Self-tests skip cleanly with the dev stack up.** Three
   docker-compose-touching self-tests in `tests/self-tests/`
   (`migrate-gates-api`, `api-container-healthy`, `traefik-https-only`)
   auto-skip via `devStackUp()` precheck (`tests/_shared/dev-stack-guard.ts`)
   when an `openwhispr-*` container is running. They need exclusive
   ownership of host ports 5432 / 4000 / 80 / 443. Stop the dev
   stack first if you need them to actually run:

   ```bash
   make down                                         # tears down the dev stack
   pnpm vitest run tests/self-tests/migrate-gates-api.test.ts
   make up-with-dev-tools                            # bring the stack back
   ```

   **Historical note (BUG-53-37 / BUG-53-39):** before the precheck
   landed, three different test files ran `docker compose down -v`
   against the default `openwhispr` project without `-p`, silently
   tearing down every dev container mid-test-run. The fix
   (commits cd5f669, 5e83094, bf95b65) isolates the self-test and
   obs-smoke compose projects under distinct names
   (`openwhispr-self-test`, `openwhispr-obs-smoke`) and gates each
   on `devStackUp()`. If you're on a clone older than May 2026 and
   `pnpm test` removed your dev containers, update to current main.

## Air-gap mkcert installation

Operators without internet access cannot pull mkcert from upstream
automatically. The `make tls-trust` target (Phase 17 / Plan 17-01) fails
loud with a platform install hint when mkcert is absent from `PATH`; this
section documents the manual binary-mirror + checksum + trust-store
install path for air-gapped environments. PITFALLS §13 applies — mkcert
is the dev-only convenience layer; CI cert generation continues to use
`tools/bootstrap.sh`'s openssl self-signed path.

### 1. macOS binary mirror

Upstream release index (mirror via your internal artifact registry):

    https://github.com/FiloSottile/mkcert/releases/latest

Choose the asset matching your CPU:

- `mkcert-vX.Y.Z-darwin-amd64` — Intel Macs
- `mkcert-vX.Y.Z-darwin-arm64` — Apple Silicon

### 2. Linux binary mirror

Same upstream; pick the matching Linux asset:

- `mkcert-vX.Y.Z-linux-amd64`
- `mkcert-vX.Y.Z-linux-arm64`

### 3. Checksum verification

Always verify against the upstream `*.sha256` companion file (or an
operator-supplied checksum from your internal sign-off chain):

    sha256sum -c mkcert-vX.Y.Z-linux-amd64.sha256

Refuse the binary if the checksum does not match.

### 4. PATH installation

Linux:

    chmod +x mkcert-vX.Y.Z-linux-amd64
    sudo mv mkcert-vX.Y.Z-linux-amd64 /usr/local/bin/mkcert

macOS:

    chmod +x mkcert-vX.Y.Z-darwin-arm64
    mv mkcert-vX.Y.Z-darwin-arm64 ~/.local/bin/mkcert
    # or /usr/local/bin/mkcert if you prefer system-wide

After install, `make tls-trust` from the repo root discovers the
binary and continues normally.

### 5. `mkcert -install` air-gap caveat

Without internet, the `mkcert -install` step may still fail to write to
the system trust store on some platforms (it shells out to platform tools
that occasionally require network reachability for CRL checks). Manual
fallbacks:

- **macOS:**

      security add-trusted-cert -d -r trustRoot \
        -k /Library/Keychains/System.keychain \
        "$(mkcert -CAROOT)/rootCA.pem"

- **Linux (Debian/Ubuntu):**

      sudo cp "$(mkcert -CAROOT)/rootCA.pem" \
        /usr/local/share/ca-certificates/mkcert-rootCA.crt
      sudo update-ca-certificates

- **Firefox / NSS-based browsers:**
  Firefox uses its own NSS store. On Linux, install `libnss3-tools` and
  rerun `mkcert -install` so it can register the CA with NSS:

      sudo apt install libnss3-tools
      mkcert -install

## BYOK Environment Matrix

The slim-core base ships without `minio`, `traefik`, `otel-collector`,
`pgbouncer`, or `mailpit`. When you do NOT enable an overlay AND the
corresponding BYOK env var is unset, the api refuses to start with a
Pino fatal record (see `apps/api/src/lib/byok-guard.ts`). The fatal
record carries a stable `code:` field for alerting and an inline
`hint:` line that names the offending env + the overlay file the
operator can enable instead.

The matrix below is the single source of truth for that contract.
Each row maps one overlay to (a) the BYOK env(s) the api requires
when the overlay is OFF, (b) the loud-fail code emitted on missing
env, (c) the compose overlay file to add via `-f` to opt in, and
(d) the Helm chart toggle for the K8s path.

| Overlay | BYOK env(s) when OFF | Loud-fail code | Compose overlay file | Helm toggle |
|---|---|---|---|---|
| storage | `S3_ENDPOINT` (plus `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` when `S3_ENDPOINT` is set) | `BYOK_STORAGE_REQUIRED` | `compose/docker-compose.storage.yml` | `storage.enabled` |
| observability | `OTEL_EXPORTER_OTLP_ENDPOINT` (sentinel value `disabled` is the explicit opt-out — anything else is treated as a real endpoint URL) | `BYOK_OBSERVABILITY_REQUIRED` | `compose/docker-compose.observability.yml` | `observability.enabled` |
| ingress | `INGRESS_BASE_URL` | `BYOK_INGRESS_REQUIRED` | `compose/docker-compose.ingress.yml` | `tls.enabled` |
| pgbouncer | `DATABASE_URL` (already required for every profile; the row exists for documentation symmetry, not a new gate) | `BYOK_DATABASE_REQUIRED` | `compose/docker-compose.pgbouncer.yml` | `pooler.enabled` |
| dev-tools | `SMTP_HOST` (`NODE_ENV=production` only — matches the `createEmailSender` precedent in `packages/email/src/EmailSender.ts`) | `BYOK_SMTP_REQUIRED` | `compose/docker-compose.dev-tools.yml` | `mailpit.enabled` |

### Reading the loud-fail record

When `apps/api/src/lib/byok-guard.ts` trips, you get a single Pino
JSON line on stderr before `process.exit(1)`:

```json
{
  "level": 60,
  "event": "byok.required",
  "code": "BYOK_STORAGE_REQUIRED",
  "overlay": "storage",
  "missing": ["S3_ENDPOINT"],
  "hint": "Set S3_ENDPOINT or enable the storage overlay (docker compose -f docker-compose.yml -f compose/docker-compose.storage.yml up)",
  "msg": "BYOK env missing for disabled overlay; refusing to start"
}
```

Grep your alerting on the `code:` field (stable enum), not on `msg:`.
Credential-bearing strings are passed through `redact-url` before
landing in the record; see `apps/api/src/lib/redact-url.ts`.

### Upgrade path from `.env.example`

Existing operators with a hand-tuned `.env` built from the legacy
90-key template can migrate to the slim contract incrementally:

```bash
cp .env.slim.example .env.new
diff .env .env.new                # review which keys you actually need
# Copy your operator-set values across into .env.new. Keep
# PLACEHOLDER_BOOTSTRAP_WILL_REPLACE on every secret you want
# tools/bootstrap.sh to (re)generate.
mv .env.new .env
./tools/bootstrap.sh              # auto-fills placeholders
```

Operators who prefer to stay on the full 90-key template can keep
their existing `.env` and pin the bootstrap template explicitly:

```bash
BOOTSTRAP_ENV_TEMPLATE=$PWD/.env.full.example ./tools/bootstrap.sh
```

For each overlay you previously had implicitly enabled by the
monolithic `.env`, add the matching `-f compose/docker-compose.<overlay>.yml`
flag to your `docker compose` command and uncomment the section of
`.env.slim.example` that lists its BYOK envs.

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

### Branded sender via Resend SMTP (production)

OpenWhispr Server sends mail via SMTP (nodemailer). The default
`SMTP_FROM=onboarding@resend.dev` reflects Resend's free SMTP relay
as the OSS quickstart provider — it works without DNS setup but has
two limitations:

1. **Branding** — emails look like they come from `onboarding@resend.dev`,
   not your operator domain.
2. **Plus-addressing rejection** — Resend testing-mode rejects
   plus-addressed recipients (e.g. `user+test@example.com`). This
   blocks QA workflows that rely on plus-addressing for fan-out test
   accounts on a single inbox.

To switch to a branded sender (`no-reply@your-domain.tld`) while
still using Resend SMTP:

> Operators on AWS SES, Postfix, Mailgun, or other SMTP providers skip
> this section — only the SMTP_HOST / SMTP_PORT / SMTP_USER /
> SMTP_PASSWORD / SMTP_FROM env vars matter, and the verification steps
> are provider-specific.

**1. Verify the domain in Resend.** In the Resend dashboard, add your
   sending domain and obtain the DKIM + SPF + MX records Resend generates
   per-domain.

**2. Publish DNS records.** Add the records to your DNS provider
   (Cloudflare, Route53, etc.). Wait for DNS propagation (typically
   1–15 minutes; up to 24h for some providers).

**3. Confirm verification in Resend.** The dashboard shows green
   checkmarks on DKIM/SPF when records resolve correctly. Until all
   three are green, sending from the new domain returns
   `403 The domain is not verified` and the worker logs
   `event=email.failed status=403`.

**4. Flip `SMTP_FROM`.** Update operator values:

   ```yaml
   # values.yaml (or .env)
   SMTP_FROM: "OpenWhispr <no-reply@your-domain.tld>"
   ```

   Restart the worker (`docker compose restart worker` / roll the
   Deployment in K8s).

**5. Verify end-to-end.** Trigger a real sign-up; confirm the
   verification email arrives with the new FROM and that
   plus-addressing flows now work without 403s.

Until step 5 passes, leave `SMTP_FROM=onboarding@resend.dev` so
verification email delivery does not break for in-flight users.

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

### Admin access model

The admin surface at `/admin/*` is gated by `users.role='admin'` in
`apps/web/src/app/(admin)/layout.tsx` via `checkAdminAccess(session)`.
Admin = regular user with the admin role; the first user to complete
the in-product `/setup` wizard (`POST /api/setup/admin`) is granted
`role='admin'` automatically. There is no Traefik basic-auth, no
htpasswd file, no separate admin login.

**Break-glass recovery** when the wizard is unreachable: connect to
Postgres directly and `UPDATE users SET role='admin' WHERE email='ops@example.com'`
against an existing user row (or `INSERT` a fresh user via Better Auth's
admin API if no row exists). Sign in via the standard /sign-in flow;
AdminLayout admits the session on next request.

### Admin Claim Modes (hybrid hardening — v1.0.11+)

> Closes audit findings HIGH Dim 5 (email-verify bypass), MEDIUM Dim 8/9
> (CSRF / Origin allowlist), LOW O1 (audit-log emission gap). Quick-task
> `260527-im6` -- see `.planning/quick/260527-im6-admin-claim-hybrid-hardening/CONTEXT.md`
> for the locked design decisions.

OpenWhispr enforces ONE of two paths for the first-admin onboarding. The
server **refuses to boot** (exit 78 EX_CONFIG) when
`setup_state.status='pending'` AND neither path is configured. Pick a
mode at provision time; switch later by setting the appropriate env vars
and re-rolling the api Deployment.

#### Mode A -- Env token (`OPENWHISPR_SETUP_CLAIM_TOKEN`)

Use for: corporate / Kubernetes deployments where SMTP is not yet
wired; operator-recovery flows; smoke tests on fresh deploys.

1. Generate the token. Single canonical recipe:
   ```bash
   openssl rand -hex 32
   ```
   Output is exactly 64 lowercase hex chars (256 bits). Do NOT reuse any
   value from this docs page -- the boot validator's exact-string
   reject-allowlist will refuse boot if you paste an example value
   verbatim. The validator also refuses low-entropy / well-known
   patterns (all zeros, all `a`s, repeated `deadbeef`, etc.).

2. Set it in your deployment env.

   **docker-compose `.env`:**
   ```
   OPENWHISPR_SETUP_CLAIM_TOKEN=<your-generated-hex64>
   ```

   **Kubernetes (SealedSecret):**
   ```bash
   kubectl -n openwhispr create secret generic openwhispr-setup-claim \
     --from-literal=token=<your-generated-hex64> \
     --dry-run=client -o yaml \
     | kubeseal --controller-name=sealed-secrets-controller \
                --format yaml > setup-claim-sealed.yaml
   ```
   Then reference in your `values.yaml`:
   ```yaml
   setupClaim:
     tokenSecretRef:
       name: openwhispr-setup-claim
       key: token
   ```

3. Claim the wizard. The desktop / web client must send:
   ```http
   POST /api/setup/admin
   Origin: https://your-instance.example.com   ← MUST match INGRESS_BASE_URL
                                                  OR be a member of
                                                  ADDITIONAL_ALLOWED_ORIGINS
   Authorization: Bearer <your-generated-hex64>
   Content-Type: application/json

   {"email":"admin@example.com","password":"...","name":"...","workspace":"...","timezone":"..."}
   ```
   Response: `201` with `{"admin":{"email":"..."}, "alreadyCompleted":false}`.
   The admin user is created and `role='admin'` is set synchronously.
   No email verification is required -- this mode bypasses the email
   path by design (it is the operator-recovery / corporate-internal
   path).

#### Mode B -- Verified email (no env token)

Use for: self-host OSS / single-VM deployments where SMTP is configured.

1. Configure SMTP (existing knobs -- see `### Configuring SMTP` above).
   Verify the transport with a smoke send before exposing the instance.

2. Claim the wizard. `POST /api/setup/admin` WITHOUT a Bearer header.
   Response:
   ```json
   201 {"admin":{"email":"..."}, "alreadyCompleted":false, "pending_verification":true}
   ```
   The user is created with `role=NULL` and `setup_state.status='pending'`.
   A verification email is dispatched automatically via the existing
   Better Auth `sendVerificationEmail` chain.

3. Click the verification link in the inbox. The
   `afterEmailVerification` hook fires atomically:
   - sets `users.role='admin'`,
   - sets `setup_state.status='completed'`,
   - emits an `admin.role_changed` row to `audit_log`.

#### Origin allowlist -- `ADDITIONAL_ALLOWED_ORIGINS` (dev / multi-host)

`POST /api/setup/admin` and `GET /api/setup-state` reject any request
whose `Origin` header does NOT match `INGRESS_BASE_URL` exactly. For
multi-host deployments or local dev where the wizard is served from a
different port (e.g. Next dev on `:5173` while the api binds `:4000`),
set:

```
ADDITIONAL_ALLOWED_ORIGINS=http://localhost:5173,https://app.example.com
```

Format rules (boot-validated, exit 78 on violation):

- Comma-separated; whitespace around each entry is trimmed.
- EACH entry must be a full `scheme://host[:port]` origin -- no path,
  no query, no hash. Trailing slashes are stripped via `URL.origin`
  semantics.
- Each entry is added to the **strict-equality** allowlist. The Origin
  guard runs `Set.has(request.Origin)` -- there is NO wildcard, NO
  suffix match, NO `startsWith`. Adding `https://example.com` does NOT
  allow `https://app.example.com`.
- Empty entries are skipped silently; a malformed entry refuses boot.

Dev `.env.local` recipe (typical):

```
INGRESS_BASE_URL=http://localhost:4000
ADDITIONAL_ALLOWED_ORIGINS=http://localhost:5173
```

#### Recovery

If you mis-paste the env token, the boot validator refuses to start
with a stderr line naming the failing predicate. Fix the env value and
restart.

If a verification email bounces or the link expires, the operator can
re-trigger via `POST /api/auth/send-verification-email`. The wizard is
`setup_state='pending'` until a successful verify lands, so the
operator can also clear the half-created user via
`DELETE FROM users WHERE email=$1 AND email_verified=false` (BYPASSRLS
psql shell) and re-submit the wizard.

24h cleanup of stale unverified-pending-admin rows is NOT bundled with
this release; tracked separately as a worker-job follow-up.

#### Audit trail

Every successful first-admin promotion (both modes) emits an
`audit_log` row with `action='admin.role_changed'` and payload
`{target_user_id, before:'user', after:'admin'}`. Query it with:

```sql
SELECT action, payload->>'target_user_id', payload->>'before', payload->>'after', created_at
  FROM audit_log
 WHERE action = 'admin.role_changed'
 ORDER BY id DESC LIMIT 1;
```

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

### `REALTIME_DEFAULT_LANGUAGE` — language hint for the relay's `session.update`

> **v1.0.9 / chart 1.0.12.** Server-side language injection for the
> OpenAI Realtime GA `session.audio.input.transcription.language`
> field, coordinated with the openwhispr client patch ≥ v1.7.9 that
> sends `?language=` on its WSS upgrade URL.

The preconfigured cloud client opens `/v1/realtime` without any
language hint. OpenAI's GA decoder runs an auto-detect pass per VAD
segment, and on short utterances (≤ ~2 seconds, typical for dictation)
the multi-script detector frequently latches onto a wrong script —
Russian speech surfaces as Maltese / Korean / Japanese / Hindi
transcripts. The fix is to set the `language` field on the GA
`session.update` the relay originates.

**Fallback chain (per WSS upgrade):**

1. `?language=<code>` query param on the client's WSS URL — preferred,
   PER-USER granularity. Requires **openwhispr client ≥ v1.7.9**.
2. `REALTIME_DEFAULT_LANGUAGE=<code>` env var — fallback, GLOBAL for
   the api process. Recommended for single-language tenants OR while
   pre-v1.7.9 client binaries are still in the field.
3. Omit — OpenAI auto-detect path (the pre-1.0.9 behavior; subject to
   the multi-script drift symptom).

**Whitelist (v1):** `en`, `ru` — matches the DB `users.locale` CHECK
constraint. Widening (`zh`, `ja`, `hi`, …) is gated on a CHECK-
constraint migration and a corresponding update to the single
exported `REALTIME_LANGUAGE_WHITELIST` constant in
`apps/api/src/config/realtime.ts` — env validator and route query
validator BOTH consult this constant.

**Validation:**

- Env: an unrecognized `REALTIME_DEFAULT_LANGUAGE` value is
  **BOOT-FATAL** — `loadRealtimeConfigFromEnv` throws
  `RealtimeConfigError`, the entrypoint catches it and exits with
  **EX_CONFIG (78)**, same pattern as `REALTIME_BACKEND`. Operators
  see the typo immediately in container stdout rather than silently
  falling through to OpenAI's auto-detect path.
- Query: an unrecognized `?language=` value is **dropped + logged
  at warn level** (`event: realtime.language.invalid`), and the env
  fallback then applies (so a typo on the wire does NOT silently
  un-configure a single-language tenant). The relay-originated
  upstream URL strips `?language=` in BOTH backend modes — the hint
  travels in-band on the GA `session.update`, never on the URL.

**Configuration example (single-language Russian tenant):**

```yaml
# In your externally-managed Kubernetes Secret consumed by the api
# Deployment via envFrom — no chart values.yaml schema change.
stringData:
  REALTIME_DEFAULT_LANGUAGE: ru
```

Cross-references:
- Source: `apps/api/src/config/realtime.ts`,
  `apps/api/src/lib/realtime-frame-translate.ts`,
  `apps/api/src/routes/realtime.ts`.
- Tests: `apps/api/tests/unit/routes/realtime-language.test.ts`
  (M2 / M3 / M5 / M6 / M7 / M8 / M9 matrix) and
  `apps/api/tests/unit/lib/realtime-frame-translate.test.ts`
  (M1 / M4 / M6).
- Companion client change: openwhispr Yambr-fork ≥ v1.7.9 — adds
  `?language=` to the WSS URL build in
  `src/helpers/openaiRealtimeStreaming.js`. Coordinated with peer
  `wd6g78xz`.

### `REALTIME_FORCE_TRANSCRIPTION_MODEL` — operator realtime model wins (upstream #1.5)

> **Default `true`.** The operator-configured realtime transcription
> model (`REALTIME_TRANSCRIPTION_MODEL`) is force-pinned on every
> client→upstream `session.update` / `transcription_session.update`
> frame, so a client-supplied realtime transcription model can NEVER
> override it. The client's `language` field still passes through.

The desktop client originates a `session.update` carrying
`session.audio.input.transcription.model: <client model>` when it is not
preconfigured. Left unchecked, a buggy or malicious client could redirect
realtime transcription to an unintended (or more expensive / ungranted)
model. With force mode on, the relay pins the operator model on BOTH the
Beta-translation path and the GA `session.update` passthrough path before
the frame reaches the upstream.

**Configuration:**

- Unset / `true` / `1` → **force ON** (operator model wins; recommended
  default).
- `0` / `false` (case-insensitive) → **force OFF** (honor the
  client-supplied model). Use only if you intentionally let clients pick
  their own realtime model.
- The model VALUE comes from `REALTIME_TRANSCRIPTION_MODEL` (no new value
  knob); this flag only toggles whether it is enforced.

Cross-references:
- Source: `apps/api/src/config/realtime.ts`
  (`forceTranscriptionModel`), `apps/api/src/lib/realtime-frame-translate.ts`
  (`translateClientToUpstream(frame, forceTranscriptionModel?)`),
  `apps/api/src/routes/realtime.ts` (threaded via `bridgeRealtimeSockets`).
- Tests: `apps/api/tests/unit/lib/realtime-frame-translate.test.ts`
  (force-model Beta + GA paths) and
  `apps/api/tests/unit/config/realtime.test.ts`
  (`REALTIME_FORCE_TRANSCRIPTION_MODEL` default-on / opt-out matrix).

### `LITELLM_USER_HEADER_NAME` — end-user email attribution (upstream #4)

> **OPT-IN.** When set, every LiteLLM gateway call (chat/agent, cleanup,
> STT, realtime) emits this HTTP header carrying the authenticated user's
> EMAIL, so an operator LiteLLM (or its spend dashboard) can attribute
> usage by human-readable identity. Unset → no email header is emitted
> (there is no default header name).

Identity surfaces on each gateway call in three places, kept distinct on
purpose:

1. **Body `user` field** (chat/agent + cleanup only — the multipart STT
   and opaque passthrough/realtime calls have no JSON body slot): carries
   the EMAIL when available, falling back to the UUID. Always present —
   not gated on `LITELLM_USER_HEADER_NAME`.
2. **`x-litellm-end-user-id` header**: ALWAYS the stable UUID
   (`req.user.id`). This is LiteLLM's end-user key + spend-logs anchor;
   emails are mutable, so the keying identity must stay the UUID.
3. **`LITELLM_USER_HEADER_NAME` header** (this var): the configurable,
   opt-in EMAIL header. Emitted ONLY when the var is set AND an
   authenticated email is present. For the multipart STT and opaque
   passthrough/realtime calls this header is the ONLY attribution vector
   (they have no body `user` slot).

For the realtime relay (litellm mode) the equivalent OpenAI attribution
is the `?user=` query param, which carries the email when available; the
spend-logs `openwhispr_user_id` field stays the UUID.

**Validation (T-oc4-01):** the header NAME is operator-controlled, so a
value containing CR, LF or `:` is REFUSED at boot (the loader throws →
EX_CONFIG). An operator typo cannot inject a second header or split the
outbound request. An empty value is treated as unset.

**Configuration example:**

```yaml
stringData:
  LITELLM_USER_HEADER_NAME: X-OpenWhispr-User-Email
```

Cross-references:
- Source: `packages/litellm-client/src/config.ts` (`userHeaderName`),
  `packages/litellm-client/src/index.ts` (`endUser` + `authHeaders`),
  `apps/api/src/routes/{reason,transcribe,realtime}.ts` call sites.
- Tests: `packages/litellm-client/tests/unit/auth-headers.test.ts` +
  `packages/litellm-client/tests/unit/config.test.ts`.

### Reasoning / thinking-off contract (`requestKind`, upstream #2.4)

The thinking-OFF directive
(`extra_body.chat_template_kwargs.enable_thinking:false`, a Qwen3/vLLM
syntax) applies to the **CLEANUP request class ONLY** — dictation cleanup
must not "reason". It is provider-specific: backends other than
Qwen3/vLLM ignore the kwarg silently (e.g. OpenRouter keeps reasoning on),
so the directive alone does not guarantee thinking is off — the model
choice matters too.

The cleanup-vs-agent routing class is **EXPLICIT** via `requestKind`
(shipped #36):

- **PRIMARY:** the client sends `body.requestKind` (`"cleanup"` or
  `"agent"`). The server schema accepts it as a plain string (fail-safe,
  not a strict enum) and routes on it directly.
- **FALLBACK:** when `requestKind` is absent, the weakened
  `isCleanupRequest` heuristic infers the class from the request shape.

The configurable seam for per-model reasoning syntax is
`REASONING_MODEL_PARAMS` (a litellm-style per-alias params bag spread
verbatim into the upstream body) plus `REASONING_CLEANUP_MODEL` (the fast
cleanup-class alias). No new env var is required — point the cleanup alias
at a non-reasoning instruct checkpoint, or supply the provider's own
reasoning-off syntax via `REASONING_MODEL_PARAMS`. The server NEVER merges
request-body fields into that bag (that would be an upstream-injection
vector — see `apps/api/src/lib/reason-prompt-select.ts`).

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
| `DEFAULT_AGENT_MODEL` | optional | first `model_name` in `compose/litellm/litellm_config.yaml` (bundled: `qwen3.6-plus`) | `apps/api/src/routes/agent/stream.ts` | Override the default model id for `/api/agent/stream` requests that don't pass `model:` in the body. When unset, the route reads `model_list[0].model_name` from the bundled LiteLLM yaml. |

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
- Under the load-test profiles, `compose/docker-compose.load-test.yml` explicitly
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
`ghcr.io/yambr/openwhispr-test-probe:<appVersion>` image which
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
| Postgres pod exits with `could not load library pg_partman_bgw`    | `postgres.imageName` not pointing at the custom `cnpg-postgres-17-pgpartman` image, OR `postgres.shared_preload_libraries` missing `pg_partman_bgw`. | Confirm `postgres.imageName: ghcr.io/yambr/openwhispr-cnpg-postgres-17-pgpartman:17.6-<chart-version>`; values.schema.json enforces `:17.*` via regex.                                                                                                                  |
| Bundled-AI Speaches pod Pending with `0/3 nodes available: no nodes match nvidia.com/gpu.present` | GPU node label missing or NVIDIA device plugin not installed.            | `kubectl get nodes -L nvidia.com/gpu.present`. Install the NVIDIA device plugin (see Prerequisites) and label your GPU node(s) `nvidia.com/gpu.present=true`. Or disable bundled AI: `--set bundledAi.enabled=false`.                                                       |
| cert-manager Certificate stuck `Issuing`                          | ClusterIssuer misconfigured or DNS-01 / HTTP-01 challenge failing.    | `kubectl describe certificate openwhispr-api-tls -n openwhispr`; `kubectl describe clusterissuer letsencrypt-prod`. For air-gapped clusters use the internal CA ClusterIssuer template at `charts/openwhispr/examples/cert-manager-clusterissuer-internal-ca.yaml`.           |
| `helm test` fails with `transcribe-non-200`                       | LiteLLM upstream unreachable, or transcribe SLO budget exceeded.       | `kubectl -n openwhispr logs deploy/ow-openwhispr-litellm` for the embedded LiteLLM (or check `LITELLM_BASE_URL` connectivity in external mode); `kubectl logs <test-pod>` for the probe's structured JSON `step` field.                                                       |
| Upgrade-matrix CI fails on integrity-check                        | Migration dropped or mutated `transcriptions` columns the seed depends on. | Inspect `tools/seed-test-data.js` — if a column was renamed legitimately, update SEED_ROWS + integrity-check to match the new schema. If unintended, the upgrade-matrix has caught a regression — revert.                                                                    |

## Live version verification

Every api replica exposes the build it was assembled from on `/api/health`:

```bash
curl -s https://openwhispr.example.com/api/health | jq
# {
#   "status": "ok",
#   "migrations_completed": true,
#   "version": "1.0.14",
#   "commit_sha": "ae565bb8d5c8f3a2...",
#   "image_tag": "1.0.14"
# }
```

The three build fields are populated at image build time by
`docker/build-push-action@v7` `build-args`
(`BUILD_VERSION` / `BUILD_SHA` / `IMAGE_TAG`), which set `ARG`s in
`apps/api/Dockerfile`'s runtime stage, which set
`OPENWHISPR_BUILD_VERSION` / `OPENWHISPR_BUILD_SHA` /
`OPENWHISPR_IMAGE_TAG` environment variables in the image, which are
read once at process boot by
`apps/api/src/config/build-info.ts`'s `parseBuildInfoFromEnv()`.

### `"unknown"` semantics

Any of the three fields reading `"unknown"` means the image was built
outside the canonical `release.yml` workflow (local `docker build`,
third-party rebuild, malformed CI override). Production installs SHOULD
see real values on all three; a `"unknown"` triplet on a production
replica is operator-actionable — rebuild via the canonical workflow and
re-deploy.

### Rollout verification (replaces `kubectl get pods -o jsonpath`)

When a new image is rolled out across N replicas, drift between replicas
during the rollout window can be observed by polling `/api/health` from
the ingress (no `kubectl` needed):

```bash
for i in $(seq 1 10); do
  curl -s https://openwhispr.example.com/api/health \
    | jq -r '"\(.version) \(.commit_sha[0:8]) \(.image_tag)"'
done | sort | uniq -c
# Expected once converged (all replicas on the new image):
#   10 1.0.14 ae565bb8 1.0.14
```

A mid-rollout poll will show two distinct triplets (old + new) — useful
for confirming the rollout is in progress without scraping pod metadata.

### Drift detection

To detect images built outside the canonical workflow on any production
replica:

```bash
curl -s https://openwhispr.example.com/api/health \
  | jq -r 'select(.version=="unknown" or .commit_sha=="unknown" or .image_tag=="unknown")'
# Expected on production: NO output (empty stdout).
# Output present -> image rebuilt outside release.yml; rebuild via the
# canonical workflow.
```

The widening is strictly additive — `migrations_completed` and `status`
fields remain wire-compatible with every prior `/api/health` consumer
including the Electron client's BACKEND_SPEC parser.

## Upgrade runbook

OpenWhispr Server follows semver across the chart, the api image, and
the worker image. Minor and patch releases are upgrade-in-place;
major releases ship a migration guide alongside the release notes.

### Upgrade from Phase 13 — virtual-key-rotation removal

Phase 14 / Plan 05 removed the `virtual-key-rotation` BullMQ worker,
its weekly cron, and its noop LiteLLM key-client + user-key-lookup
adapters per CONTEXT decision 3 and the REQUIREMENTS BYOK-03 audit
closure. The production rotation dispatcher was never built; the
weekly cron enqueued a nil-UUID sentinel against noop adapters in
production code — a direct violation of the constitutional "no mocks
of internal logic" rule (CLAUDE.md).

**Operator action — none required for new installs.** A fresh
`docker compose up` or `helm install` against Phase 14+ images
provisions the seven surviving queues only, and Valkey never sees a
`bull:virtual-key-rotation:*` keyspace.

**Operator action — upgrade-in-place from Phase 13 → 14.** Existing
deployments have stale `bull:virtual-key-rotation:*` keys in Valkey
from the prior worker boot (scheduler metadata, job records, repeatable
job manifest). The Phase 14 worker drains these automatically at boot
via a one-shot SCAN+DEL loop in `apps/worker/src/index.ts`
(`drainStaleVkrKeys`) — wrapped in try/catch so cleanup failure never
blocks the worker from starting. For most operators the transient
cleanup is sufficient and no further action is needed.

If you prefer a manual one-shot cleanup (e.g. fleet-wide rollout where
you'd rather drain keys before the new worker image lands), exec into
the Valkey container and run:

```bash
# docker-compose
docker compose exec valkey valkey-cli \
  -a "${VALKEY_PASSWORD}" \
  --scan --pattern 'bull:virtual-key-rotation:*' \
  | xargs -r docker compose exec -T valkey valkey-cli -a "${VALKEY_PASSWORD}" DEL bull:virtual-key-rotation:*

# Kubernetes (Helm) — one-liner against the Valkey StatefulSet
kubectl -n openwhispr exec sts/ow-valkey -- sh -c \
  'valkey-cli -a "$VALKEY_PASSWORD" --scan --pattern "bull:virtual-key-rotation:*" \
     | xargs -r valkey-cli -a "$VALKEY_PASSWORD" DEL bull:virtual-key-rotation:*'
```

The one-shot is idempotent — subsequent runs find zero matching keys
and exit cleanly. After a single successful drain the worker's
boot-time cleanup is a belt-and-braces no-op; the cleanup helper will
be removed in a future phase once stragglers stop appearing in
production telemetry.

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

## Database migration upgrade notes

These notes cover migration behaviours an operator must be aware of when
upgrading an existing installation. They do not change any migration SQL —
applied migrations are immutable — they document forward-only consequences.

### Destructive forward migrations

> Review finding HI-01.

Migration `0005_session_token_plain.sql` runs an **unconditional
`TRUNCATE TABLE "sessions"`** (step 3 of the migration) inside the migration
runner's per-migration transaction. It dates from an early-phase schema
reshape (dropping the legacy `token_hash` / `previous_token_hash` bytea
columns) and was written assuming a dev-only database.

**Impact when upgrading an installation that predates migration 0005 and has
live sessions:**

- **Every active session is cleared** the moment migration 0005 applies.
  Every signed-in user — including every connected OpenWhispr desktop client —
  is logged out and must re-authenticate.
- Migration 0005 has **no `.down.sql` companion**. The truncated session rows
  are **unrecoverable**; a rollback cannot restore them.

**Pre-flight check before upgrading across migration 0005:**

1. Confirm whether the target installation is already at or beyond migration
   0005: `SELECT * FROM _meta.__drizzle_migrations ORDER BY id;` — if a row
   tagged `0005_session_token_plain` is present, this migration has already
   run and the warning does not apply to subsequent upgrades.
2. If migration 0005 has **not** yet been applied, schedule the upgrade in a
   **maintenance window** and notify users that they will be signed out.

Migration `0021_safe_table_reset_helper.sql` later introduced a
`_safe_table_reset(...)` guard so that any future table-reset is non-empty-row
aware; it prevents recurrence but **cannot retroactively make migration 0005
non-destructive**.

### Audit-log partition maintenance after upgrade

> Review finding HI-03.

Migration `0014_audit_log_partition.sql` converts `audit_log` into a
pg_partman-managed range-partitioned table. As part of the migration it copies
the pre-existing (legacy) `audit_log` rows into the new partitioned parent.

`create_parent` materialises the current month plus four future months. Legacy
rows whose `created_at` predates that window do **not** land in a bounded
monthly partition — they fall through to the catch-all **`audit_log_default`**
partition. The migration deliberately does **not** call
`run_maintenance_proc()` itself, because that procedure issues an internal
`COMMIT`, which is illegal inside the migration runner's wrapping transaction.

**Required operator action after upgrading through migration 0014:**

Ensure the legacy rows are promoted off `audit_log_default` into properly
bounded monthly child partitions. Either:

- **Let the scheduled `partman-maintenance` BullMQ worker job run** — it runs
  daily and calls partman maintenance for you; nothing to do beyond confirming
  the worker is deployed and healthy; **or**
- **Run partman maintenance once manually**, outside any transaction:

  ```sql
  -- Run as a partman-privileged role, NOT inside a transaction block.
  CALL partman.run_maintenance_proc();
  ```

**Until promotion runs, month-scoped audit queries silently miss the legacy
rows** (those rows sit on `audit_log_default`, which a month-bounded partition
prune skips). If the `partman-maintenance` worker job is misconfigured or
fails to deploy, run the manual `CALL` above as a one-time remediation.

### Tenant deletion

> Review finding HI-05.

Not every `tenant_id` foreign key cascades. The five tables below reference
`tenants(id)` with **`ON DELETE NO ACTION`** (the application/identity tables),
while `notes`, `folders`, `conversations`, `messages`, `transcriptions` and
`api_keys` reference it with `ON DELETE CASCADE`:

| Table          | `tenant_id` FK posture | Rationale                                   |
| -------------- | ---------------------- | ------------------------------------------- |
| `audit_log`    | `NO ACTION`            | Append-only audit data must not be cascaded away. |
| `usage_ledger` | `NO ACTION`            | Append-only billing/usage data.             |
| `sessions`     | `NO ACTION`            | Better Auth identity table.                 |
| `account`      | `NO ACTION`            | Better Auth identity table.                 |
| `verification` | `NO ACTION`            | Better Auth identity table.                 |

**Consequence:** a `DELETE FROM tenants WHERE id = ?` **fails with a foreign-key
violation** if any `audit_log` / `usage_ledger` / `sessions` / `account` /
`verification` row still references that tenant. This is deliberate — it
prevents silent loss of append-only audit/usage history.

**To delete a tenant, the operator must first purge or archive the referencing
rows.** Append-only audit and usage data should be **exported** (not silently
dropped) before removal — see the Backup and restore section. Only after the
five `NO ACTION` tables hold no rows for the tenant will the `DELETE FROM
tenants` succeed.

---

## Agent stream error contract

> **Wire surface:** `POST /api/agent/stream` returns NDJSON
> (`Content-Type: application/x-ndjson`). Every line is a JSON object
> tagged by a `type` discriminant. Prior to 260528-0cm (v1.0.13)
> upstream failures collapsed every 4xx/5xx + every connect/abort error
> into an opaque `{type:"done", finishReason:"upstream_error"}` chunk
> the desktop renderer could not bind to a user-facing error UI —
> producing empty assistant bubbles for every signed-up free-tier user.
> v1.0.13 introduces a dedicated `{type:"error", error, code, provider}`
> terminal envelope + a structured `agent.stream.upstream_failure` log
> event for operator observability.

### NDJSON wire shape per chunk type

| `type`        | Payload fields                                                | Terminal? |
| ------------- | ------------------------------------------------------------- | --------- |
| `"content"`   | `text: string`                                                | No        |
| `"tool_call"` | `id, name, arguments` (accumulator output; client-executable) | No        |
| `"done"`      | `finishReason: string, usage: {promptTokens, completionTokens}` | Yes (happy path) |
| `"error"`     | `error: string, code: AgentErrorCode, provider: "litellm" \| "unknown"` | Yes (NO `done` follows) |

**Terminal-frame rule:** an `error` chunk is itself terminal — the
server NEVER emits a `done` chunk after it (CONTEXT.md D1 lock). Mid-stream
failures preserve the preceding `content` chunks on the wire and append
ONE terminal `error` chunk.

### `AgentErrorCode` taxonomy

| Code                       | Trigger condition                                                                       | Operator-facing meaning                                                   | Suggested operator action                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upstream_auth`            | LiteLLM upstream 401 or 403 (or `kind:"auth"`)                                          | Upstream provider rejected the API key.                                   | Rotate the failing alias's API key (`OPENROUTER_API_KEY` / `GROQ_API_KEY` / `OPENAI_API_KEY` / vendor-specific); redeploy the LiteLLM container.       |
| `upstream_rate_limit`      | LiteLLM upstream 429 (with or without `Retry-After`)                                    | Upstream provider returned rate-limit / throttling.                       | If sustained: bump LiteLLM concurrency limits OR upgrade upstream provider tier. The `retry_after_ms` field in the log carries the parsed hint.        |
| `upstream_quota_exceeded`  | LiteLLM upstream 402                                                                    | Upstream provider quota/billing limit hit.                                | Top up provider billing; verify spend caps in LiteLLM dashboard.                                                                                         |
| `upstream_invalid_model`   | LiteLLM 404, or 400 whose body matches `/invalid model name\|model_not_found\|not.found/i` | Requested model alias does not exist in the upstream catalog.            | Verify `compose/litellm/litellm_config.yaml` `model_list` against the client's `chatAgentModel` selector; check for alias drift after rebuilds.        |
| `upstream_timeout`         | `AbortError` / `UND_ERR_*_TIMEOUT` / `ECONNREFUSED` / `ECONNRESET` / `ETIMEDOUT` / `ENOTFOUND` / `EAI_AGAIN` / `UND_ERR_ABORTED` / `UND_ERR_SOCKET` | Network/abort failure reaching upstream.                                  | Investigate the LiteLLM → upstream-provider network path; check undici dispatcher logs; rule out provider degradation.                                  |
| `upstream_unknown`         | Any other upstream 4xx/5xx, plain Error, TypeError, null/undefined throw                | Unclassified upstream failure.                                            | Read `upstream_body_truncated` field in the log binding for diagnosis; treat as provider degradation until classified.                                  |

### Log event schema — `agent.stream.upstream_failure`

Every preflight + drain failure produces exactly ONE `req.log.error` line
with the binding shape below (no `req.log.warn` is emitted for these
paths — see CONTEXT.md D4 lock):

```json
{
  "level": "error",
  "event": "agent.stream.upstream_failure",
  "upstream_status": 429,
  "upstream_body_truncated": "Rate limit exceeded for ... [redacted] ...",
  "code": "upstream_rate_limit",
  "provider": "litellm",
  "kind": "rate_limit",
  "model": "openwhispr-default",
  "litellm_call_id": "abcd1234-...",
  "retry_after_ms": 30000,
  "request_id": "req-XXXX",
  "msg": "agent stream upstream call failed"
}
```

Per-field operator notes:

| Field                       | Meaning                                                                                                                                              | LogQL probe                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `event`                     | Fixed string for stream-failure correlation across deployments.                                                                                      | `{app="openwhispr-api"} \| json \| event="agent.stream.upstream_failure"`                          |
| `upstream_status`           | LiteLLM HTTP status (LitellmUpstreamError path) or `null` for network/abort/non-Error throws.                                                        | `... \| upstream_status=429`                                                                       |
| `upstream_body_truncated`   | Redacted (no credential shapes) + truncated to ≤500 chars upstream payload. NEVER serialized onto the wire.                                          | `... \| upstream_body_truncated =~ "(?i)retry"`                                                    |
| `code`                      | The `AgentErrorCode` discriminant (taxonomy above).                                                                                                  | `... \| code="upstream_auth"`                                                                      |
| `provider`                  | `"litellm"` when upstream returned an HTTP error envelope; `"unknown"` for network/abort/dispatch failures. Server-self-attestation, not a verifiable claim. | `... \| provider="litellm"`                                                                  |
| `kind`                      | LiteLLM `LitellmErrorKind` passthrough (`"auth" \| "rate_limit" \| "server" \| "client"`) or `null`.                                                  | `... \| kind="rate_limit"`                                                                         |
| `model`                     | Resolved upstream model alias (body → env → yaml fallback chain).                                                                                    | `... \| model="qwen3.6-plus"`                                                                      |
| `litellm_call_id`           | The `x-litellm-call-id` header value, or `undefined` for preflight failures (no response yet).                                                       | `... \| litellm_call_id != ""`                                                                     |
| `retry_after_ms`            | Parsed + capped (≤60s) `Retry-After` for 429 cases; `undefined` otherwise.                                                                           | `... \| retry_after_ms > 0`                                                                        |
| `request_id`                | The Fastify-generated `req.id` for end-to-end correlation.                                                                                           | `... \| request_id="req-XXXX"`                                                                     |

### Operator alerts to consider

Suggested Loki/Grafana alert recipes (tune thresholds per traffic profile):

- **`upstream_auth` sustained rate > 1/min for 5 min** — rotate the failing
  provider API key (read `model` field to identify the alias). Noise floor:
  ~0 (any non-zero rate is actionable).
- **`upstream_invalid_model` sustained rate > 2/min for 5 min** — desktop
  client / server alias mismatch. Verify `model_list` against the client's
  selector. Noise floor: ~0 in steady-state.
- **`upstream_quota_exceeded` ANY occurrence** — top up provider billing;
  verify spend caps. Noise floor: 0.
- **`upstream_rate_limit` sustained > 5/min for 10 min** — bump LiteLLM
  concurrency OR upgrade upstream tier. Noise floor: low-single-digit per
  hour acceptable.
- **`upstream_timeout` sustained > 3/min for 10 min** — investigate
  LiteLLM↔upstream network path. Noise floor: 0–1/hour acceptable.
- **`upstream_unknown` sustained > 1/min for 5 min** — read
  `upstream_body_truncated` for forensic detail. Noise floor: 0.

LogQL template: `{app="openwhispr-api"} | json | event="agent.stream.upstream_failure" | code="<code>"`.

For correlation with the actual upstream provider behind LiteLLM
(groq / openai / openrouter / anthropic): pivot by `litellm_call_id`
into LiteLLM Proxy's own log stream — the proxy's logs carry
`metadata.llm_provider` per LiteLLM observability conventions. This
field is populated whenever the drain-side catch fires (the header was
already captured pre-fix); preflight-side catches have
`litellm_call_id: undefined` because no upstream response existed.

### i18n future

Canonical `chunk.error` messages are English-only in v1. Runtime i18n
via i18next is a follow-up phase. The internal `CANONICAL_ERROR_MESSAGES`
const at `apps/api/src/lib/agent-upstream-error-classify.ts` is the
canonical `code → English-text` source the future i18n catalog will
adopt.

### Cross-references

- Source of truth for codes + messages:
  [`apps/api/src/lib/agent-upstream-error-classify.ts`](../apps/api/src/lib/agent-upstream-error-classify.ts).
- Emitter (preflight + drain catches): [`apps/api/src/routes/agent/stream.ts`](../apps/api/src/routes/agent/stream.ts).
- Peer-filed bug report: [`.planning/debug/agent-stream-upstream-error-2026-05-28.md`](../.planning/debug/agent-stream-upstream-error-2026-05-28.md).
- Helper unit coverage:
  [`apps/api/tests/unit/lib/agent-upstream-error-classify.test.ts`](../apps/api/tests/unit/lib/agent-upstream-error-classify.test.ts).
- Route mapping coverage:
  [`apps/api/tests/unit/routes/agent/__tests__/stream-error-mapping.test.ts`](../apps/api/tests/unit/routes/agent/__tests__/stream-error-mapping.test.ts).
- Integration contract:
  [`apps/api/tests/integration/agent-stream-error-contract.test.ts`](../apps/api/tests/integration/agent-stream-error-contract.test.ts).

---

## Future phases

- **Phase 10 (this document):** full operator handbook (deploy / upgrade
  / scale / backup / restore / troubleshoot / i18n) — completed by
  Plan 10-03.
