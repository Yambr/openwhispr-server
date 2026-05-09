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

## Future phases

- **Phase 1:** docker-compose stack (Postgres / PgBouncer / Redis / observability) — `make up` brings real services online
- **Phase 8:** sizing matrix per topology (compose / Helm / GPU pool); published p95 SLOs
- **Phase 9:** Helm chart deploy + upgrade-matrix discipline
- **Phase 10:** full operator handbook (deploy / upgrade / scale / backup / restore / troubleshoot)
