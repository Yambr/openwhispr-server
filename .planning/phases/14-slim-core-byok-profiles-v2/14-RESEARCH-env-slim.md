# .env.slim.example design research (Phase 14)

## Existing OpenWhispr env files

| File | Lines | Keys | Purpose |
|---|---|---|---|
| `.env.example` | 452 | 90 | Current monolithic template — covers Phase 0-12, every overlay, every variant. Bloated. |
| `.env.embedded.example` | 95 | 23 | Phase 11 Variant A (embedded LiteLLM). Closest existing analog to slim-core. Carries DB roles, KEK, BACKUP_AGE_IDENTITY, MinIO, Grafana, Traefik, OPENROUTER/OPENAI keys. |
| `.env.e2e.example` | 23 | 4 | Provider keys only (OPENROUTER/GROQ/OPENAI/PYANNOTE). Stacks on top of `.env` via `make e2e-test`. Excellent precedent for "additive partial env file." |

**Key precedents already established in this repo:**
1. **Additive stacking is already a thing** — `.env.e2e.example` is read *in addition to* `.env` by `make e2e-test` (line 5 of that file). So operators are already used to multi-file env composition.
2. **`PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` + `tools/bootstrap.sh`** — auto-fills secrets. This already exists; slim-core can reuse it.
3. **`docker-compose` variable interpolation `${VAR}` in env defaults** is heavily used (DATABASE_URL composed from POSTGRES_APP_PASSWORD). This means many "keys" in the existing example are derived, not user-input.
4. `docs/operations.md` has **no BYOK matrix section yet** — Phase 14 must author it (success criterion #3).

## Mature OSS reference patterns

- **Plausible Community Edition** — TRULY minimal: 2 required keys (`BASE_URL`, `SECRET_KEY_BASE`) + DB passwords. Optional features (TOTP_VAULT_KEY, DISABLE_REGISTRATION) are documented in repo docs, NOT in `.env.example`. Strict-minimum approach. [plausible/community-edition](https://github.com/plausible/community-edition/)
- **NocoBase** — single `.env.example` with **commented-out sections** for cluster mode, worker/server mode toggles. Uncomment to enable. Industry-standard "commented overlay" pattern. [nocobase/.env.example](https://github.com/nocobase/nocobase/blob/main/.env.example) + separate `.env.test.example`, `.env.e2e.example` for orthogonal concerns (matches our existing convention).
- **Cal.com** — single bloated `.env.example` like our current one; users complain about its size. Counter-example for what NOT to do at scale. [cal.com docker docs](https://cal.com/docs/self-hosting/docker)
- **Outline / Supabase pattern** (common in 2025) — `.env.example` strict + `docs/configuration.md` with sectioned matrix table. Two-file split, no per-overlay env files. Discoverability via docs, not env comments.

## Comparison

| Option | Quickstart ergonomics | Discoverability of overlays | Loud-fail compatibility | Maintenance |
|---|---|---|---|---|
| **A. Strict 5-key minimum + docs/operations.md BYOK matrix** | Excellent — `cp && fill 5 vals && up`. Smallest cognitive load. | Medium — requires reading `docs/operations.md`. Good if matrix table is the FIRST H2 section. | Excellent — every BYOK env unset by default, api boots ONLY slim-core, opts in by *adding* env. No magic defaults possible. | Low — slim file changes rarely; docs updates absorb overlay churn. |
| **B. Slim + commented overlay sections in same file** | Excellent quickstart (uncommented top works) AND best discoverability (operator literally sees `# --with-storage: uncomment to enable`). | Excellent — single source of truth, no doc-hunting. Matches NocoBase precedent. | Good — but risks accidentally uncommenting partial sections. Mitigation: section headers carry `# REQUIRES: docker-compose.storage.yml overlay enabled` warnings. | Medium — file grows as overlays grow; needs disciplined section ordering. |
| **C. Per-overlay `.env.<overlay>.example` files** | Worst quickstart — operator must `cat .env.slim.example .env.storage.example > .env` or learn `env_file:` stacking syntax. Friction-heavy. | Excellent — 1:1 mapping with compose overlays. Self-documenting. | Excellent — same as A. | High — N files to keep in sync with N overlays + N Helm toggles. |
| **D. Strict + `tools/env-merge.ts` codemod** | Excellent quickstart for power users (`pnpm env-merge --with-storage`). Bad for newcomers (yet another tool to learn). | Excellent — `--help` enumerates overlays. | Excellent. | Highest — TS code + test surface; pnpm requirement contradicts OSS "git clone && docker compose up" promise. |

## Recommendation: **Option B (slim + commented overlay sections in the same file)**

The OSS quickstart promise ("`git clone && cp .env.slim.example .env && docker compose up`") works *identically* under A and B because operators leave commented sections alone for the slim path. But Option B uniquely solves the **overlay discoverability problem** that the existing 90-key `.env.example` was trying (and failing) to solve: an operator who runs `docker compose -f compose/storage.yml up` and gets a loud-fail "S3_ENDPOINT unset" error can find the fix *in the same file they already copied*, with the canonical example value next to a `# REQUIRES: docker-compose.storage.yml` banner. This matches NocoBase's mature pattern and respects the repo's existing convention of additive multi-file env (`.env.e2e.example` keeps its independent role for orthogonal concerns: real-provider e2e keys, not deployment overlays). `docs/operations.md` still gets the full BYOK matrix (success criterion #3 mandates this), but it becomes a *reference table*, not the primary discovery path. Option C is rejected because per-overlay env files force operators to learn env_file stacking syntax — an obstacle absent from compose's overlay model which uses `-f` flags. Option D's codemod is over-engineering for a file that ships once and gets edited by hand; the pnpm dependency also violates the "docker compose up" purity of the OSS promise (a fresh-clone operator should not need `pnpm install` to boot the stack).

## Concrete proposal — `.env.slim.example`

The slim 5 keys must each be (a) **user-input mandatory** (not derivable), (b) **required by ≥1 of the 6 slim-core services**, (c) **loud-fail if unset** (no magic default acceptable). Derived URLs like `DATABASE_URL` should compose via `${VAR}` interpolation from the input keys, NOT count as input keys.

### The 5 keys

```dotenv
# OpenWhispr Server — slim-core operator env (Phase 14).
#
# Quickstart:
#   cp .env.slim.example .env
#   ./tools/bootstrap.sh     # auto-fills every PLACEHOLDER_* with strong randoms
#   docker compose up        # 6 services: api, web, worker, postgres, valkey, litellm
#
# To enable an overlay (storage / observability / ingress / pgbouncer / dev-tools),
# uncomment the matching section BELOW and ALSO add `-f compose/docker-compose.<overlay>.yml`
# to your `docker compose` command. BYOK envs are documented in docs/operations.md#byok-matrix.

# 1. Postgres app-role password — non-BYPASSRLS role the api/worker connect as.
#    Used to compose DATABASE_URL below. bootstrap.sh fills this.
POSTGRES_APP_PASSWORD=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE

# 2. Better Auth session-signing secret. Rotating invalidates every live session.
#    Generate manually: openssl rand -hex 32
BETTER_AUTH_SECRET=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE

# 3. LiteLLM master bearer — auth between api/worker and the bundled LiteLLM proxy.
#    Generate manually: openssl rand -hex 32
LITELLM_MASTER_KEY=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE

# 4. Public origin where the api is reachable (used by Better Auth for cookie domain
#    + CORS allow-list). For localhost dev: http://localhost:3000.
BETTER_AUTH_URL=http://localhost:3000

# 5. OpenRouter API key — powers /api/reason via the bundled LiteLLM proxy.
#    The slim profile loud-fails if this is unset because /api/reason is a slim-core
#    route (D-10). Get one: https://openrouter.ai/keys
OPENROUTER_API_KEY=

# --- Derived (do not edit) -----------------------------------------------
DATABASE_URL=postgres://openwhispr_app:${POSTGRES_APP_PASSWORD}@postgres:5432/openwhispr
VALKEY_URL=redis://valkey:6379/0
LITELLM_BASE_URL=http://litellm:4000
```

### Commented overlay appendix (sketch — full content in Phase 14 plan)

```dotenv
# =========================================================================
# OPT-IN OVERLAYS — uncomment the section matching your `-f compose/...yml`
# =========================================================================

# --- --with-storage (compose/docker-compose.storage.yml) -----------------
# Adds MinIO. api loud-fails if storage overlay is OFF AND any of these are set.
# S3_ENDPOINT=http://minio:9000
# S3_ACCESS_KEY=openwhispr
# S3_SECRET_KEY=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE
# S3_BUCKET=openwhispr

# --- --with-observability (compose/docker-compose.observability.yml) -----
# Adds OTel Collector + Tempo + Loki + Grafana. api emits OTLP only when set.
# OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
# OTEL_SERVICE_NAME=openwhispr-api

# --- --with-ingress (compose/docker-compose.ingress.yml) -----------------
# Adds Traefik with ACME. Required for public hostnames + Let's Encrypt.
# INGRESS_BASE_URL=https://openwhispr.example.com
# ACME_EMAIL=ops@example.com

# --- --with-pgbouncer (compose/docker-compose.pgbouncer.yml) -------------
# Adds PgBouncer transaction-mode pooler. Rewrites DATABASE_URL to point at it.
# PGBOUNCER_ADMIN_PASSWORD=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE
# (DATABASE_URL override is applied by the overlay compose file's environment: block)

# --- --with-dev-tools (compose/docker-compose.dev-tools.yml) -------------
# Adds Mailpit + pgweb. Dev-only — refuses to attach when NODE_ENV=production.
# SMTP_HOST=mailpit
# SMTP_PORT=1025
```

**Why exactly these 5 (not 4, not 6):**
- `POSTGRES_APP_PASSWORD` (not `DATABASE_URL`) — single input, multiple derived URLs interpolate from it. Matches `.env.embedded.example` precedent.
- `BETTER_AUTH_SECRET` — already required by every existing variant; no magic-default possible.
- `LITELLM_MASTER_KEY` — same; bearer between api and the bundled proxy.
- `BETTER_AUTH_URL` — without this, Better Auth cookies + CORS are broken on any non-default origin. Has a sane localhost default but operator MUST override for any public deploy; loud-fail when `NODE_ENV=production` AND value matches the localhost default.
- `OPENROUTER_API_KEY` — slim-core includes `/api/reason` (per D-10 / MEMORY: phase 5 web-search providers locked). Empty value = loud-fail on first `/api/reason` request with 503 envelope, matching the existing "leave blank to enable 503" pattern in `.env.example` line 80. Alternative: drop to 4 keys and treat OPENROUTER as overlay-style, but `/api/reason` is in the slim 6-service surface so the key belongs in the base.

**Sources:**
- [plausible/community-edition .env.example](https://github.com/plausible/community-edition/)
- [nocobase/.env.example](https://github.com/nocobase/nocobase/blob/main/.env.example)
- [nocobase/.env.e2e.example](https://github.com/nocobase/nocobase/blob/main/.env.e2e.example)
- [cal.com docker self-hosting docs](https://cal.com/docs/self-hosting/docker)
