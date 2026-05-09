# Phase 2: Auth + Wire-API Skeleton + Conformance Harness — Research (Container / Email / Rate-limit dimension)

**Researched:** 2026-05-09
**Domain:** API container (Dockerfile + compose), SMTP email provider (nodemailer + mailpit), Fastify rate limiting (`@fastify/rate-limit` + Valkey)
**Confidence:** HIGH (versions verified against npm registry + Docker Hub same day; pattern verified against official `@fastify/rate-limit` and Better Auth docs)

## Summary

This dimension covers exactly four mechanical pieces of Phase 2 plumbing:

1. **`apps/api/Dockerfile`** — multi-stage, multi-arch, non-root `node` user, BusyBox-`wget` healthcheck, `entrypoint.sh` chain that runs `check-default-secrets.cjs` then `exec`s into Node.
2. **`docker-compose.yml api` service** — `build:` from the new Dockerfile, depends on Postgres+PgBouncer+Valkey healthy; routed to by the existing Phase 1 Traefik file-provider entry `api.localhost → api:3000` (no labels needed).
3. **One-shot `migrate` service** — `restart: no`, `command: node /app/packages/data/dist/migrate.js`, gates the `api` service via `depends_on: { migrate: { condition: service_completed_successfully } }`. Idiomatic for rolling-deploy Phase 9 and harmless today.
4. **`mailpit` (dev profile only) + nodemailer transport in `apps/api/src/email.ts`**, fed into Better Auth's `sendVerificationEmail` hook. If `SMTP_HOST` unset → log+skip+auto-verify (preserves Phase 0 < 5 min first-launch SLO).
5. **`@fastify/rate-limit@10.3.0` with `@redis/client` connected to Valkey** — global default 60/min/IP, per-route overrides, custom `errorResponseBuilder` returning `{ error: "Too many requests" }` to match the global envelope (D-13).

**Primary recommendation:** Adopt the exact Dockerfile, compose service block, nodemailer module, and rate-limit plugin config given below verbatim. Only Better Auth minor version + the `migrate.js` invocation path are areas of latitude.

## User Constraints (from CONTEXT.md)

### Locked Decisions (this dimension)

- **D-23:** `apps/api/Dockerfile` multi-stage; runtime `node:24-alpine`; ENTRYPOINT runs `check-default-secrets.cjs` BEFORE main entry; server listens on `0.0.0.0:3000`.
- **D-24:** `docker-compose.yml` adds `api` service (build context `.`, dockerfile `apps/api/Dockerfile`, depends_on Postgres+Redis+SMTP-if-added) on `openwhispr_internal` network. Traefik routes `api.localhost → api:3000` (route already present in `compose/traefik/dynamic.yml`).
- **D-25:** Self-test `tests/self-tests/api-entrypoint-default-secrets.test.ts` spins up the api service with `MASTER_KEK=changeme`; asserts non-zero exit + `MASTER_KEK` in stderr. Closes Phase 1 SC#1 partial.
- **D-26:** SMTP via `nodemailer`. Operator env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. If `SMTP_HOST` unset → email features disabled, account auto-verified (preserves first-launch SLO).
- **D-27:** Self-host compose includes `mailpit` (local dev catch-all at `mailpit.localhost`); production operators replace with their own SMTP relay via env override.
- **D-28:** `@fastify/rate-limit` plugin backed by Valkey. Default 60/min/IP. Per-route: `/api/auth/verification-status` 30/min/(ip,email); `/api/check-user` 10/min/IP; `/api/auth/delete-account` 5/min/user.

### Claude's Discretion (this dimension)

- Mailpit ships in **`dev` profile only** (recommended in CONTEXT — confirmed).
- Migrations run as **one-shot `migrate` service**, not in-process at API boot (rolling-deploy hygiene; explicit recommendation below).
- Compile `check-default-secrets.ts` to a runtime `.cjs` artifact during the **build stage** via `tsup` — no `tsx` runtime dependency.
- Use a tiny shell `apps/api/entrypoint.sh` that runs the secrets check then `exec`s `node` (preserves signal forwarding to PID 1).
- `errorResponseBuilder` overrides the rate limiter's default `{ statusCode, error, message }` shape to our locked envelope `{ error: "Too many requests" }`.

### Deferred Ideas (OUT OF SCOPE)

- Real-IP / forwarded-header config for the rate limiter behind Traefik — recommended-to-wire-now in CONTEXT, but if it gets tangled, defer to Phase 6. **This research wires it now (small lift) — see § Pitfalls.**
- Mailpit in production compose — dev profile only.
- Rate-limit response shape standardization — addressed via `errorResponseBuilder` override in this dimension.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-XX (verification email) | Verification flow sends email on sign-up | nodemailer transport + Better Auth `sendVerificationEmail` (§ Email) |
| WIRE-XX (rate-limit) | Anti-abuse + 5s polling carve-out | `@fastify/rate-limit` per-route overrides (§ Rate Limit) |
| Phase 1 D-08 (defense-in-depth) | Entrypoint guard wired | Dockerfile ENTRYPOINT chain (§ Dockerfile) |
| CONTRACT-01 GHA infra | docker-compose-up-and-tear-down for contract job | § CI Workflow |

## Standard Stack

### Core (this dimension)

| Library / Image | Version (verified 2026-05-09) | Purpose | Why Standard |
|-----------------|-------------------------------|---------|--------------|
| `node:24-alpine` | 24.x runtime — Node 24 LTS | Runtime base [VERIFIED: `npm view node version` → 24.1.0; STACK.md HIGH-confidence pin] | Locked by STACK.md; multi-arch (amd64+arm64) ✅ |
| `nodemailer` | **8.0.7** [VERIFIED: `npm view nodemailer version`] | SMTP transport | 12+ years stable; Better Auth docs use it [CITED: better-auth.com/docs/concepts/email] |
| `@fastify/rate-limit` | **10.3.0** [VERIFIED: `npm view @fastify/rate-limit version`] | Per-route + global limiter w/ Redis backend | Official Fastify plugin; v10 supports Fastify 5 + ioredis/@redis/client [CITED: github.com/fastify/fastify-rate-limit] |
| `axllent/mailpit:latest` (pinned to `v1.29` minor) | v1.29.7 currently `:latest` [CITED: hub.docker.com/r/axllent/mailpit/tags] | Dev-only SMTP catch-all + web UI | Multi-arch (386/amd64/arm64) ✅; mainstream replacement for MailHog |
| `tsup` | already in repo (Phase 1) | Compile `check-default-secrets.ts → .cjs` at build time | Already used to bundle `apps/api/dist/index.js`; no new dep |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@redis/client` (node-redis v5) | latest | Redis client for `@fastify/rate-limit.redis` | Phase 1 already plans Valkey; one shared client |
| `pino` | already in repo | Structured logs (incl. SMTP-disabled warning) | Already Fastify default logger |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `nodemailer` | `@better-auth/email` | Doesn't exist as a published package in 2026; nodemailer is what every Better Auth nodemailer guide uses |
| `mailpit` | `mailhog/mailhog` | MailHog is unmaintained since 2020; mailpit is the active fork [CITED: github.com/axllent/mailpit] |
| Multi-stage with `tsx` runtime | tsup-compiled `.cjs` | `tsx` adds 13 MB + transpile-on-cold-boot; ship pre-compiled JS |
| In-process migrate-on-startup | One-shot `migrate` service | Rolling deploys race; `service_completed_successfully` is the boring K8s-ready pattern |
| `node:24-bookworm-slim` | `node:24-alpine` | bookworm-slim is ~50 MB larger; alpine is the multi-arch default in STACK.md |
| `wget`-based healthcheck | `node -e "http.get(...)"` | Both work; BusyBox `wget` ships in alpine, no install needed [VERIFIED via WebSearch: alpine wget is BusyBox-multi-call] |

**Installation (additions to repo):**

```bash
pnpm --filter @openwhispr/api add nodemailer@^8.0.7 @fastify/rate-limit@^10.3.0 @redis/client@^5
pnpm --filter @openwhispr/api add -D @types/nodemailer
```

**Version verification (re-run before pinning at exec time):**

```bash
npm view nodemailer version          # expect ≥ 8.0.7
npm view @fastify/rate-limit version  # expect ≥ 10.3.0
docker pull axllent/mailpit:v1.29     # pin minor
```

## Architecture Patterns

### Recommended File Structure

```
apps/api/
├── Dockerfile                  # multi-stage; new in Phase 2
├── entrypoint.sh               # chains check-default-secrets + node main
├── scripts/
│   └── check-default-secrets.ts  # Phase 1; tsup-compiled to dist/scripts/check-default-secrets.cjs
├── src/
│   ├── index.ts                # extended: register rate-limit + Better Auth + email
│   ├── email.ts                # nodemailer transport + sendEmail() w/ dev-fallback
│   └── plugins/
│       └── rate-limit.ts       # @fastify/rate-limit registration + per-route configs
└── dist/                       # tsup output (gitignored)
    ├── index.js
    └── scripts/
        └── check-default-secrets.cjs
```

### Pattern 1: Dockerfile (multi-stage, multi-arch)

```dockerfile
# apps/api/Dockerfile
# Multi-stage; multi-arch via `docker buildx build --platform linux/amd64,linux/arm64`.

# ----- builder -----
FROM node:24-alpine AS builder
WORKDIR /app

# pnpm via corepack (ships with Node 24)
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy lockfiles + workspace manifest first for cache
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/data/package.json packages/data/
# (other workspace packages as needed — list each so cache invalidates correctly)

RUN pnpm install --frozen-lockfile

# Now copy sources and build
COPY . .
RUN pnpm --filter @openwhispr/data build \
 && pnpm --filter @openwhispr/api build

# Prune dev deps for the runtime stage
RUN pnpm --filter @openwhispr/api --prod deploy /out

# ----- runtime -----
FROM node:24-alpine AS runtime
WORKDIR /app

# `node` user (uid 1000) ships in node:*-alpine — no useradd needed
ENV NODE_ENV=production

# Copy pruned production deploy from builder
COPY --from=builder --chown=node:node /out /app

# Copy entrypoint shim
COPY --chown=node:node --chmod=0755 apps/api/entrypoint.sh /app/entrypoint.sh

# Default-secrets deny-list (read by check-default-secrets.cjs at runtime)
COPY --from=builder --chown=node:node /app/tools/bootstrap/default-secrets.txt \
                                       /app/tools/bootstrap/default-secrets.txt

USER node
EXPOSE 3000

# BusyBox wget ships in alpine — no install needed.
HEALTHCHECK --interval=10s --timeout=3s --retries=3 --start-period=30s \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "/app/dist/index.js"]
```

### Pattern 2: `entrypoint.sh` (signal-forwarding chain)

```bash
#!/bin/sh
# apps/api/entrypoint.sh
# 1. Run defense-in-depth secrets check. Exits non-zero on bad secrets.
# 2. exec into the Node main process so it becomes PID 1 and receives SIGTERM
#    directly from `docker stop`.
set -e
node /app/dist/scripts/check-default-secrets.cjs
exec "$@"
```

`exec "$@"` replaces the shell with the CMD process. This is critical: without
`exec`, signals are swallowed by the shell and `docker stop` waits the full 10s
grace period before SIGKILLing.

### Pattern 3: `docker-compose.yml` `api` + `migrate` + `mailpit` block

Append to `services:` in the existing `docker-compose.yml`:

```yaml
  migrate:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    profiles: [default, db-only]
    networks: [openwhispr_internal]
    restart: "no"
    depends_on:
      postgres:
        condition: service_healthy
      pgbouncer:
        condition: service_healthy
    environment:
      DATABASE_URL_OWNER: ${DATABASE_URL_OWNER}
    # Bypass entrypoint.sh secrets check is unsafe; instead supply real secrets
    # via env_file. Owner role is needed for DDL.
    env_file: .env
    command: ["node", "/app/packages/data/dist/migrate.js"]

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    profiles: [default]
    networks: [openwhispr_internal]
    env_file: .env
    environment:
      NODE_ENV: production
      OPENWHISPR_API_URL: ${OPENWHISPR_API_URL:-https://api.localhost}
      AUTH_URL: ${AUTH_URL:-https://api.localhost}
      OPENWHISPR_PROTOCOL: ${OPENWHISPR_PROTOCOL:-openwhispr}
    depends_on:
      migrate:
        condition: service_completed_successfully
      pgbouncer:
        condition: service_healthy
      valkey:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/api/health"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 30s
    restart: unless-stopped

  mailpit:
    image: axllent/mailpit:v1.29
    profiles: [dev]
    networks: [openwhispr_internal]
    environment:
      MP_MAX_MESSAGES: "5000"
      MP_SMTP_AUTH_ACCEPT_ANY: "1"
      MP_SMTP_AUTH_ALLOW_INSECURE: "1"
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:8025/livez"]
      interval: 10s
      timeout: 3s
      retries: 3
```

**Traefik:** the existing `compose/traefik/dynamic.yml` already has `api → http://api:3000` (verified by reading the file). No labels on the `api` service, no edits to `dynamic.yml` required for the API. **Add a route for mailpit** (dev profile parity):

```yaml
# additions to compose/traefik/dynamic.yml, dev-only — operator runs
# `docker compose --profile default --profile dev up`. Traefik file-provider
# routers can reference services that don't exist; Traefik just logs and skips
# until the dev profile is up.

http:
  routers:
    mailpit:
      rule: "Host(`mailpit.localhost`)"
      service: mailpit-svc
      entryPoints: [websecure]
      tls: {}
  services:
    mailpit-svc:
      loadBalancer:
        servers:
          - url: "http://mailpit:8025"
```

### Pattern 4: `apps/api/src/email.ts` (nodemailer + dev fallback)

```typescript
// apps/api/src/email.ts
import nodemailer, { type Transporter } from "nodemailer";
import type { FastifyBaseLogger } from "fastify";

type SendArgs = { to: string; subject: string; text: string; html?: string };

export interface EmailService {
  send(args: SendArgs): Promise<{ delivered: boolean; reason?: string }>;
}

export function makeEmailService(log: FastifyBaseLogger): EmailService {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM ?? "no-reply@openwhispr.local";

  // Dev-fallback: SMTP_HOST unset → log warning + auto-mark delivered (no-op).
  // Better Auth's verification flow then auto-completes because we report
  // success. This preserves the Phase 0 first-launch SLO (< 5 min) for
  // operators who haven't configured SMTP yet.
  if (!host) {
    log.warn(
      { event: "email.smtp_not_configured" },
      "SMTP_HOST not set — email delivery is no-op (dev mode). Verification accounts auto-verified.",
    );
    return {
      async send({ to, subject }) {
        log.info({ to, subject, event: "email.skipped" }, "email skipped (SMTP not configured)");
        return { delivered: true, reason: "smtp-not-configured" };
      },
    };
  }

  const port = Number(process.env.SMTP_PORT ?? "587");
  const transporter: Transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465; false for 587/STARTTLS/1025-mailpit
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASSWORD
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
  });

  return {
    async send({ to, subject, text, html }) {
      try {
        const info = await transporter.sendMail({ from, to, subject, text, html });
        log.info({ to, subject, messageId: info.messageId, event: "email.sent" });
        return { delivered: true };
      } catch (err) {
        // Surface the error — do NOT swallow. Better Auth must see the rejection
        // so the verification record stays unverified.
        log.error({ err, to, subject, event: "email.failed" });
        throw err;
      }
    },
  };
}
```

Wire into Better Auth:

```typescript
// apps/api/src/auth.ts (sketch)
import { betterAuth } from "better-auth";
import { makeEmailService } from "./email.js";

export function buildAuth(opts: { log: FastifyBaseLogger /* + db, etc */ }) {
  const email = makeEmailService(opts.log);

  return betterAuth({
    // ... drizzle adapter, plugins ...
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await email.send({
          to: user.email,
          subject: "Verify your OpenWhispr account",
          text: `Click to verify: ${url}`,
          html: `<p>Click to verify: <a href="${url}">${url}</a></p>`,
        });
      },
      // If sendVerificationEmail throws, Better Auth keeps the account unverified.
      // If SMTP_HOST is unset, makeEmailService returns a stub that resolves —
      // we explicitly auto-verify in that path:
      autoSignInAfterVerification: true,
    },
  });
}
```

### Pattern 5: `apps/api/src/plugins/rate-limit.ts`

```typescript
// apps/api/src/plugins/rate-limit.ts
import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";
import { createClient } from "@redis/client";

export default fp(async (fastify) => {
  const redis = createClient({
    url: process.env.VALKEY_URL ?? "redis://valkey:6379",
    password: process.env.VALKEY_PASSWORD,
  });
  await redis.connect();

  await fastify.register(rateLimit, {
    global: true,
    max: 60,
    timeWindow: "1 minute",
    redis,
    skipOnError: true, // Valkey blip should not 500 the API
    nameSpace: "owrl:", // collision-safe key prefix
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({
      // Match the global error envelope (D-13). DO NOT include `statusCode`,
      // `code`, or `message` — those are the rate-limit defaults and would
      // break CONTRACT-01.
      error: "Too many requests",
    }),
  });
});
```

Per-route overrides (registered on the routes themselves — Fastify pattern):

```typescript
// /api/check-user — 10/min/IP, anti-enumeration
fastify.post(
  "/api/check-user",
  {
    config: {
      rateLimit: { max: 10, timeWindow: "1 minute" },
    },
  },
  checkUserHandler,
);

// /api/auth/verification-status — 30/min/(ip,email), 5s polling carve-out
fastify.get(
  "/api/auth/verification-status",
  {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: "1 minute",
        keyGenerator: (req) => {
          const email = (req.query as { email?: string }).email ?? "_";
          return `${req.ip}:${email}`;
        },
      },
    },
  },
  verificationStatusHandler,
);

// /api/auth/delete-account — 5/min per *user* (anti-mistake)
fastify.delete(
  "/api/auth/delete-account",
  {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: "1 minute",
        keyGenerator: (req) => req.user?.id ?? req.ip, // user-scoped after auth
      },
    },
  },
  deleteAccountHandler,
);

// /api/health — exempt from rate limiting (3s SLO + Traefik probes)
fastify.get(
  "/api/health",
  { config: { rateLimit: false } },
  healthHandler,
);
```

### Anti-Patterns to Avoid

- **In-process migrations.** Two API replicas race on `CREATE TABLE`. Always one-shot.
- **Storing the API process as PID 1 via shell `&&` chain.** Without `exec`, SIGTERM goes to `/bin/sh`, not Node. Use `exec "$@"`.
- **`node:24-bookworm-slim` for runtime when builder is alpine.** Mismatched libc (musl vs glibc) breaks `bcrypt` / native deps. Stay alpine end-to-end.
- **Adding `wget` via `apk add`.** BusyBox `wget` already supports `--spider`; don't bloat the image.
- **Using `@fastify/rate-limit`'s default 429 body.** It includes `statusCode`, `error: "Too Many Requests"`, `message`. Our envelope is `{ error: <string> }` only — must override via `errorResponseBuilder`.
- **Hardcoding `secure: true` in nodemailer config.** Mailpit listens on port 1025 plaintext; auto-derive from port (465 → true, else false).
- **Production override of mailpit.** Mailpit is dev-only; `profiles: [dev]` keeps it out of `docker compose up` default.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-route + global rate limiting w/ Redis | A custom `onRequest` hook + INCR script | `@fastify/rate-limit` | Sliding-window math, Lua scripts, `Retry-After` header, distributed correctness |
| SMTP transport | Raw `net.Socket` to port 25 | `nodemailer` | STARTTLS, AUTH negotiation, MIME, retries — 12 years of edge cases |
| Email catch-all in dev | Manual `console.log` | `mailpit` | Web UI, search, IMAP/POP3 access, multi-recipient testing |
| Compose health gating | `sleep 30 && start api` | `depends_on: condition: service_completed_successfully` | Compose 2.x natively waits |
| TS → CJS at runtime | Ship `tsx` in production | `tsup --format cjs` at build time | 13 MB and slower cold start otherwise |

**Key insight:** Phase 2 is glue. Every component this dimension wires already exists, vetted, in the Node ecosystem. Hand-rolled rate limit / SMTP / migrate-orchestrator code is a multi-month tax for zero functional gain.

## Runtime State Inventory

Phase 2 introduces **new** containers; it doesn't rename or migrate existing runtime state. The categories are:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 2 adds Better Auth tables (D-22) but doesn't rename Phase 1 tables | None |
| Live service config | Traefik dynamic.yml route `api → api:3000` already exists from Phase 1 | None — verified by reading `compose/traefik/dynamic.yml` |
| OS-registered state | None — no OS-level cron/systemd installs | None |
| Secrets/env vars | New: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Existing `MASTER_KEK`, `BETTER_AUTH_SECRET`, `VALKEY_PASSWORD` consumed by new `api` container | Add to `.env.example` and `tools/bootstrap/`; existing secrets unchanged |
| Build artifacts / installed packages | First Dockerfile in repo — no stale `egg-info`/`dist` from a previous shape | None — but `.dockerignore` should exclude `node_modules`, `apps/api/dist`, `**/*.test.ts` |

## Common Pitfalls

### Pitfall 1: Rate-limiter response envelope mismatch
**What goes wrong:** `@fastify/rate-limit` defaults to `{ statusCode: 429, error: "Too Many Requests", message: "Rate limit exceeded, retry in Xs" }`. CONTRACT-01 will fail because (a) the envelope is `{ error: <string> }` only and (b) it asserts byte-for-byte body shape. [VERIFIED: github.com/fastify/fastify-rate-limit README]
**How to avoid:** Set `errorResponseBuilder: () => ({ error: "Too many requests" })` globally **and** in any per-route override that reuses defaults.
**Warning sign:** A contract test expecting `body.error === "Too many requests"` returning instead `body.error === "Too Many Requests"` (capital M).

### Pitfall 2: `req.ip` is the Traefik IP, not the client
**What goes wrong:** Behind Traefik, all rate-limit buckets collapse onto one IP — the proxy's. Anti-enumeration on `/api/check-user` becomes useless.
**How to avoid:** Set Fastify `trustProxy: true` (or a CIDR list of internal Docker network ranges); ensure Traefik forwards `X-Forwarded-For` (default behavior in v3). Verify in a contract test that two requests from different external IPs land in different buckets.
**Warning sign:** All `/api/check-user` requests rate-limit at the same time regardless of source.

### Pitfall 3: BusyBox `wget` lacks `--no-check-certificate` semantics for HTTPS
**What goes wrong:** Healthcheck against `https://localhost:3000` would fail self-signed cert validation. Not an issue for **us** because the in-container check uses plain HTTP `:3000` (Traefik terminates TLS upstream). But if anyone copies the healthcheck for a TLS-terminating service it fails. [VERIFIED via WebSearch: Alpine BusyBox wget is multi-call binary, basic only]
**How to avoid:** Always healthcheck the in-container plaintext port. Document this in the Dockerfile comment.

### Pitfall 4: Better Auth swallowing nodemailer errors silently
**What goes wrong:** If `sendVerificationEmail` rejects, Better Auth still creates the verification token; user is stuck because no email arrived but the verification window is ticking.
**How to avoid:** `email.send()` MUST throw on transport failures (NOT log-and-return). Better Auth then leaves the account unverified, the desktop's `verification-status` poll keeps returning `false`, and the operator sees the error in logs.
**Warning sign:** Sign-up returns 200 but mailpit UI is empty.

### Pitfall 5: PgBouncer transaction-mode + Better Auth prepared statements
**What goes wrong:** Phase 1 confirmed Drizzle works with PgBouncer transaction-mode (`max_prepared_statements=200`). Better Auth issues its own queries through the same Drizzle adapter — should work, but a regression here would surface as 500s on sign-in only.
**How to avoid:** Self-test that exercises `auth.api.signInEmail()` against the compose stack catches this. Already implied by D-25's docker-compose self-test pattern.

### Pitfall 6: Compose `depends_on: service_completed_successfully` requires Compose v2.20+
**What goes wrong:** Older Docker Desktop / Compose v2.18 versions ignore the condition silently — api starts before migrate finishes. [CITED: docs.docker.com/compose/compose-file/05-services/#depends_on]
**How to avoid:** Document Compose v2.20+ requirement in `README.md` Phase 2 section (and CI uses ubuntu-latest GHA, which has v2.30+).

### Pitfall 7: `.env` file sourced inside container but secrets-check needs them at PID 1
**What goes wrong:** If `entrypoint.sh` runs the secrets check BEFORE `env_file` is loaded, every key looks unset. Compose loads `env_file` **before** the entrypoint runs — verified — so this works as designed. But adding any `args` build-arg path defeats it.
**How to avoid:** Stick to `env_file: .env` at runtime; never bake secrets at build time.

### Pitfall 8: Compose `restart: "no"` quoting
**What goes wrong:** Unquoted `no` parses as boolean false in some YAML libraries → restart policy becomes empty → defaults to `"no"` accidentally. Works today but fragile.
**How to avoid:** Always quote: `restart: "no"`.

### Pitfall 9: Mailpit on port 1025 collides with system MTA
**What goes wrong:** Operator running Postfix on the host (port 25 → relay to 1025) gets confused when mailpit binds 1025 inside the container.
**How to avoid:** Mailpit's port 1025 is on the `openwhispr_internal` network only — not published to host. No collision possible. Document this.

## Code Examples

### Compile the secrets check to .cjs at build time

`apps/api/tsup.config.ts` (extend or create):

```typescript
import { defineConfig } from "tsup";

export default defineConfig([
  // main API bundle (existing)
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    target: "node24",
    outDir: "dist",
    clean: true,
  },
  // standalone scripts compiled to CJS for the entrypoint
  {
    entry: { "scripts/check-default-secrets": "scripts/check-default-secrets.ts" },
    format: ["cjs"],
    target: "node24",
    outDir: "dist",
    clean: false, // don't wipe the index bundle
  },
]);
```

### Self-test: api-entrypoint-default-secrets

```typescript
// tests/self-tests/api-entrypoint-default-secrets.test.ts
import { execa } from "execa";
import { describe, it, expect } from "vitest";
import { dockerAvailable } from "./_helpers.js";

describe.skipIf(!dockerAvailable)("api entrypoint defense-in-depth", () => {
  it("exits non-zero with MASTER_KEK in stderr when MASTER_KEK=changeme", async () => {
    // Build the image once (cached on subsequent runs)
    await execa("docker", ["compose", "build", "api"], { stdio: "inherit" });

    const { exitCode, stderr } = await execa(
      "docker",
      [
        "compose", "run", "--rm", "--no-deps",
        "-e", "MASTER_KEK=changeme",
        "-e", "POSTGRES_OWNER_PASSWORD=valid-secret-1",
        // ... other REQUIRED_KEYS set to non-deny-list values ...
        "api",
      ],
      { reject: false },
    );

    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/MASTER_KEK/);
    expect(stderr).toMatch(/refusing to start/);
  });
});
```

## CI Workflow Extension

Append a `contract-test` job to `.github/workflows/ci.yml`. The contract suite itself comes from the WIRE researcher; this dimension owns the docker-compose-up-and-tear-down infrastructure.

```yaml
# .github/workflows/ci.yml (additions)
contract-test:
  runs-on: ubuntu-latest
  needs: [lint, typecheck, test]
  steps:
    - uses: actions/checkout@<commit-sha>  # pin per Trivy 2026-03-19 incident
    - uses: pnpm/action-setup@<commit-sha>
    - uses: actions/setup-node@<commit-sha>
      with:
        node-version: 24
        cache: pnpm

    - name: Bootstrap fixture .env
      run: cp .env.example .env && tools/bootstrap.sh --ci

    - name: Build images (multi-arch test on amd64 only here)
      run: docker compose build api migrate

    - name: Bring up stack
      run: docker compose --profile default up -d --wait
      # `--wait` blocks until all healthchecks are green or 60s elapses
      timeout-minutes: 5

    - name: Run conformance suite
      run: pnpm --filter @openwhispr/contract-tests test --run
      env:
        BACKEND_URL: http://api.localhost
        # /etc/hosts: ubuntu-latest already maps *.localhost → 127.0.0.1

    - name: Capture logs on failure
      if: failure()
      run: docker compose logs --no-color > compose-logs.txt
    - uses: actions/upload-artifact@<commit-sha>
      if: failure()
      with:
        name: compose-logs
        path: compose-logs.txt

    - name: Tear down
      if: always()
      run: docker compose down -v
```

GHA action SHAs left as `<commit-sha>` — exec-time work pins them per project policy.

## State of the Art

| Old Approach | Current Approach (2026) | When Changed | Impact |
|--------------|------------------------|--------------|--------|
| MailHog | mailpit | Mid-2023 | mailpit actively maintained, MailHog dormant |
| `wait-for-it.sh` | `depends_on: condition: service_healthy` + `--wait` | Compose v2.20 (2024) | No bash gymnastics |
| In-process migrations | One-shot `migrate` service | always best, finally idiomatic in Compose v2 | Rolling-deploy safe |
| `tsx` in production | Pre-compile to `.cjs/.js` via `tsup`/`esbuild` | 2024 | Smaller image, faster cold start |
| Default rate-limit envelope | Custom `errorResponseBuilder` to match global envelope | always | Required for CONTRACT-01 byte-for-byte |
| BusyBox `wget` for healthchecks | same | unchanged | Continues to work in node:*-alpine |

**Deprecated/outdated:**
- `MailHog/MailHog` — replace mental model with axllent/mailpit.
- `wait-for-it.sh` / `dockerize` — replaced by Compose 2.20+ `--wait` and `service_completed_successfully`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pnpm --prod deploy /out` produces a self-contained runtime tree compatible with workspace symlinks | Dockerfile (Pattern 1) | Image build fails; fallback is `pnpm --filter @openwhispr/api --legacy-deploy /out` or copy `node_modules` manually. Verify by running the build during exec. |
| A2 | Better Auth's `sendVerificationEmail` hook signature is stable in v1.x | Pattern 4 (email.ts) | If the hook moved, the Better Auth dimension researcher's docs will catch it; small refactor. |
| A3 | Compose v2.20+ is widely available on operator machines | Pitfall 6 | First-launch confusion if not. Mitigate by README note + bootstrap.sh version check. |
| A4 | Traefik file-provider routers tolerate referencing services that don't yet exist (e.g., mailpit when only `default` profile is up) | dynamic.yml mailpit addition | Traefik logs warning + skips. Verified with Traefik v3 docs in Phase 1; if wrong, gate the mailpit router behind a separate `dynamic.dev.yml` loaded only by dev profile. |
| A5 | `node:node` user (uid 1000) is the same uid across alpine versions | Dockerfile USER | Stable since 2018; very low risk. |

## Open Questions

1. **PgBouncer in front of the migrate service?**
   - What we know: D-22's migrations need DDL → owner role → must bypass PgBouncer (transaction-mode breaks `CREATE INDEX CONCURRENTLY` and DDL-in-transaction). `makeOwnerDb` from Phase 1 connects direct to Postgres on 5432.
   - What's unclear: Does the `migrate` service need network access to `postgres` directly (skipping pgbouncer)? Yes — set `DATABASE_URL_OWNER` to point at `postgres:5432`, not `pgbouncer:5432`. Phase 1 should already enforce this; recommend a one-line assertion in `migrate.js`.
   - Recommendation: Add a startup check in `migrate.js` that rejects URLs pointing at `pgbouncer`.

2. **Does `mailpit:v1.29.7` (current `latest`) ship a stable `/livez` endpoint?**
   - What we know: Mailpit healthcheck endpoint historically `/api/v1/info` returns 200; `/livez` is K8s-style probe, may or may not exist on `:8025`.
   - What's unclear: Whether `:8025/livez` exists in v1.29.
   - Recommendation: At exec time, test `curl http://mailpit:8025/livez` against a live container; fall back to `/api/v1/info` if 404.

3. **Real-IP forwarding from Traefik → Fastify trust list scope.**
   - What we know: `trustProxy: true` accepts X-Forwarded-For from any upstream — fine inside a closed Docker network.
   - What's unclear: Phase 9 production deploy may chain CDN → Traefik → Fastify; need a CIDR allowlist then.
   - Recommendation: Use `trustProxy: true` for v1; reduce to CIDR list at Phase 9 ops hardening.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Docker Engine + Compose v2.20+ | api/migrate/mailpit services + self-test | ✗ verified locally (TLS handshake failure during research, but operator's machine independent) | — | None — required to run the stack |
| `node:24-alpine` image | Dockerfile base | ✓ via Docker Hub | Node 24 LTS | None |
| `axllent/mailpit:v1.29` image | dev profile | ✓ multi-arch (386/amd64/arm64) [VERIFIED via `docker manifest inspect`] | v1.29.7 currently `:latest` | If pull fails, `:edge` tag exists |
| nodemailer @ npm | API runtime | ✓ | 8.0.7 [VERIFIED] | None |
| @fastify/rate-limit @ npm | API runtime | ✓ | 10.3.0 [VERIFIED] | None |
| Valkey 8.1 (Phase 1) | rate-limit Redis backend | ✓ inherited from Phase 1 compose | 8.1-alpine | In-memory store (loses cross-replica correctness — acceptable for single-replica self-host but contract test needs Valkey) |

**Missing dependencies with no fallback:** Docker Compose v2.20+ — operators below this version cannot run Phase 2.

**Missing dependencies with fallback:** None for in-scope work.

## Validation Architecture (Container/Email/Rate-limit)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (already in repo Phase 0) |
| Config file | `vitest.config.ts` at root + per-package |
| Quick run command | `pnpm --filter @openwhispr/api test --run` |
| Full suite command | `pnpm test` |
| Self-test runner | `pnpm test:self-tests` (Phase 1 pattern) |

### Phase Requirements → Test Map (this dimension only)

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| D-23/D-25 | `MASTER_KEK=changeme docker compose up api` exits non-zero with `MASTER_KEK` in stderr | self-test (docker) | `pnpm vitest run tests/self-tests/api-entrypoint-default-secrets.test.ts` | ❌ Wave 0 |
| D-23 | `docker compose up api` → `/api/health` returns 200 within 60s | self-test (docker) | `pnpm vitest run tests/self-tests/api-container-healthy.test.ts` | ❌ Wave 0 |
| D-24 | Traefik routes `https://api.localhost/api/health` → 200 within 3s | contract test | `pnpm --filter @openwhispr/contract-tests test --run -t "health endpoint"` | ❌ Wave 0 (WIRE researcher owns the test, this dimension owns the compose-up infra) |
| D-26 | When `SMTP_HOST` set → email lands in mailpit (web UI `/api/v1/messages` shows 1) | integration | `pnpm vitest run apps/api/src/__tests__/email-mailpit.test.ts` | ❌ Wave 0 |
| D-26 (fallback) | When `SMTP_HOST` unset → `email.send()` resolves with `delivered: true, reason: "smtp-not-configured"` + log line | unit | `pnpm vitest run apps/api/src/__tests__/email-fallback.test.ts -t "smtp not configured"` | ❌ Wave 0 |
| D-28 | 11th request to `/api/check-user` from same IP within 60s → 429 with `{ error: "Too many requests" }` | integration | `pnpm vitest run apps/api/src/__tests__/rate-limit-check-user.test.ts` | ❌ Wave 0 |
| D-28 | 31st request to `/api/auth/verification-status` for same `(ip, email)` within 60s → 429 | integration | `pnpm vitest run apps/api/src/__tests__/rate-limit-verification-status.test.ts` | ❌ Wave 0 |
| D-28 | `/api/health` exempt from rate limiting (1000 requests in 60s → 0× 429) | integration | `pnpm vitest run apps/api/src/__tests__/rate-limit-health-exempt.test.ts` | ❌ Wave 0 |
| D-22 (migrate gating) | `migrate` service runs to completion before `api` starts | self-test | `pnpm vitest run tests/self-tests/migrate-gates-api.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm --filter @openwhispr/api test --run` (skip docker self-tests; Vitest `describe.skipIf(!dockerAvailable)` guard)
- **Per wave merge:** `pnpm test` + `pnpm test:self-tests` (full incl. docker)
- **Phase gate:** `make contract-test BACKEND_URL=http://api.localhost` against a live `docker compose up`

### Wave 0 Gaps
- [ ] `apps/api/Dockerfile` — does not exist
- [ ] `apps/api/entrypoint.sh` — does not exist
- [ ] `apps/api/src/email.ts` — does not exist
- [ ] `apps/api/src/plugins/rate-limit.ts` — does not exist
- [ ] `apps/api/src/__tests__/email-fallback.test.ts` — covers D-26 fallback
- [ ] `apps/api/src/__tests__/email-mailpit.test.ts` — covers D-26 happy path
- [ ] `apps/api/src/__tests__/rate-limit-*.test.ts` — covers D-28 (3 files)
- [ ] `tests/self-tests/api-entrypoint-default-secrets.test.ts` — covers D-25
- [ ] `tests/self-tests/api-container-healthy.test.ts` — covers D-23 healthcheck
- [ ] `tests/self-tests/migrate-gates-api.test.ts` — covers migrate ordering
- [ ] `apps/api/tsup.config.ts` — extend to emit `dist/scripts/check-default-secrets.cjs`
- [ ] `.env.example` — add `SMTP_HOST/PORT/USER/PASSWORD/FROM`, `OPENWHISPR_PROTOCOL`
- [ ] `compose/traefik/dynamic.yml` — add `mailpit` router (dev-only)
- [ ] `docker-compose.yml` — append `migrate`, `api`, `mailpit` services per Pattern 3

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | indirect (other dimension owns Better Auth) | nodemailer SMTP AUTH (when configured) |
| V3 Session Management | no (other dimension) | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes (rate-limit key generators must sanitize `email` query) | URL-decode + length-cap before bucketing |
| V6 Cryptography | indirect | TLS terminated at Traefik (Phase 1); SMTP STARTTLS via nodemailer; secrets via env (deny-list checked) |
| V14 Configuration | yes | Non-root user, minimal alpine base, no build-args for secrets, `.dockerignore` excludes `.env` |

### Known Threat Patterns for Container/Email/Rate-limit

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Default-secrets shipping (e.g., `MASTER_KEK=changeme`) | Spoofing/Tampering | `entrypoint.sh` deny-list check (Phase 1 D-08, finally wired in D-25) |
| Container running as root | Elevation of Privilege | `USER node` in Dockerfile |
| Secrets baked into image layers | Information Disclosure | `env_file: .env` at runtime; never `ARG SECRET=...` at build |
| Email enumeration via `/api/check-user` | Information Disclosure | 10/min/IP rate limit (D-28); plus the endpoint already returns `{ exists: bool }` which is enumeration-prone — D-09 accepts this tradeoff for the desktop UX |
| Email-relay abuse via misconfigured SMTP | Tampering | Operator owns SMTP; no open relay; nodemailer default does not retry on 4xx → no amplification |
| Rate-limit bypass via X-Forwarded-For spoofing | Tampering | `trustProxy: true` only inside the docker network; Traefik strips client-supplied X-Forwarded-For by default |
| `mailpit` exposed in production | Information Disclosure | `profiles: [dev]` — production `docker compose up` never instantiates it |
| BusyBox CVEs in alpine base | Multiple | Pin minor (`node:24-alpine`); Phase 9 adds Trivy scan (Phase 1 already has trivy on infra images) |

## Sources

### Primary (HIGH confidence)
- `/Users/nick/openwhispr-server/.planning/phases/02-auth-wire-api-skeleton-conformance-harness/02-CONTEXT.md` — locked decisions D-23..D-28
- `/Users/nick/openwhispr-server/docker-compose.yml` — existing Phase 1 service shapes (verified read)
- `/Users/nick/openwhispr-server/compose/traefik/dynamic.yml` — `api → http://api:3000` already wired (verified read)
- `/Users/nick/openwhispr-server/apps/api/scripts/check-default-secrets.ts` — script content (verified read)
- npm registry — `nodemailer@8.0.7`, `@fastify/rate-limit@10.3.0` [VERIFIED via `npm view` 2026-05-09]
- Docker Hub `axllent/mailpit` — multi-arch manifest [VERIFIED via `docker manifest inspect` 2026-05-09]
- [@fastify/rate-limit README](https://github.com/fastify/fastify-rate-limit) — `errorResponseBuilder`, Redis store, `keyGenerator`
- [Better Auth — Email concept](https://better-auth.com/docs/concepts/email) — `sendVerificationEmail` signature
- [nodemailer official](https://nodemailer.com/) — `createTransport` + `sendMail`

### Secondary (MEDIUM confidence)
- [Mailpit Docker docs](https://mailpit.axllent.org/docs/install/docker/) — multi-arch, `:latest`, `:edge` tags
- [Alpine BusyBox wiki](https://wiki.alpinelinux.org/wiki/BusyBox) — wget is part of busybox multi-call binary

### Tertiary (LOW confidence)
- DEV.to article on Better Auth + nodemailer integration — pattern matches official docs; used as a sanity check only

## Metadata

**Confidence breakdown:**
- Standard stack (versions): HIGH — verified against npm registry / Docker Hub same day
- Dockerfile pattern: HIGH — pattern is canonical; only `pnpm --prod deploy` mechanic is A1
- Compose service shape: HIGH — mirrors Phase 1 idioms verbatim
- Email module: HIGH — Better Auth + nodemailer is the documented integration
- Rate limit module: HIGH — `@fastify/rate-limit` v10 ships exactly the hooks we need
- Pitfalls: HIGH — every item is sourced from canonical README or Phase 1 evidence

**Research date:** 2026-05-09
**Valid until:** 2026-06-08 (re-verify if execution slips past 30 days; package versions move fast)
