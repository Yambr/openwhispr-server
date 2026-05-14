# @openwhispr/email

Shared, Fastify-decoupled email-sending library for the OpenWhispr Server
monorepo. Wraps [`nodemailer`](https://nodemailer.com/) behind a small,
structurally-typed `EmailSender` interface and centralizes the SMTP env
contract so `apps/api` and `apps/worker` share one configuration surface.

> Phase 13 / Plan 01 / Task 04 owns this package. The integration delta
> (rewiring `apps/worker` away from its `noopSender`, deleting
> `apps/api/src/email.ts`, updating its three importers) lands in the
> single atomic D-04 commit at the end of Plan 13-01.

## Why a separate package?

Before Phase 13, `apps/worker` shipped with a hardcoded `noopSender` that
discarded every verification email — the harness existed but the wire
was severed. The shared `EmailSender` here:

1. **Decouples the email surface from Fastify.** The old
   `apps/api/src/email.ts` imported `FastifyBaseLogger` directly, which
   made it impossible for the BullMQ worker (no Fastify instance) to reuse
   the same factory. The new `Logger` interface is purely structural —
   any object with `info`, `warn`, `error` methods satisfies it.
2. **Adds a production loud-fail.** The legacy dev-fallback (warn + no-op
   sender when `SMTP_HOST` was unset) silently swallowed verification
   emails in production. The new factory throws at construction when
   `NODE_ENV === "production"` and `SMTP_HOST` is unset.
3. **Exposes the full SMTP env contract.** `SMTP_SECURE` and
   `SMTP_REJECT_UNAUTHORIZED` were previously hardcoded from the port
   heuristic — corporate operators behind a self-signed internal relay
   could not opt in without patching code.

## Public surface

```ts
import {
  createEmailSender,
  type CreateEmailSenderOpts,
  type EmailSender,
  type Logger,
  type SendArgs,
  type SendResult,
} from "@openwhispr/email";

const sender: EmailSender = createEmailSender({
  log: app.log, // Fastify's logger — or any { info, warn, error } object
  env: process.env,
});

const result: SendResult = await sender.send({
  to: "user@example.com",
  subject: "Verify your email",
  text: "Click the link…",
  html: "<p>Click the link…</p>", // optional
});
```

`createEmailSender` reads the SMTP env block **at construction time** so
boot-time misconfiguration fails fast (instead of failing on the first
verification email an hour later).

## Environment-variable contract

All variables are read from the `env` argument passed to
`createEmailSender`. Defaults are evaluated only when the variable is
explicitly unset (an empty string is treated as set).

| Variable                      | Required             | Default                        | Effect                                                                                                  |
| ----------------------------- | -------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `SMTP_HOST`                   | **prod: yes**, dev: no | (none)                         | SMTP server hostname. **Unset in production -> throws at construction.** Unset in non-prod -> dev fallback. |
| `SMTP_PORT`                   | no                   | `587`                          | TCP port. `465` triggers implicit TLS via the port heuristic.                                            |
| `SMTP_SECURE`                 | no                   | `"true"` iff `port === 465`    | Explicit override of the implicit-TLS flag. `"true"` / `"false"` strings.                                |
| `SMTP_REJECT_UNAUTHORIZED`    | no                   | `"true"`                       | Set to `"false"` ONLY for self-signed internal relays. Propagates to `nodemailer` `tls.rejectUnauthorized`. |
| `SMTP_USER`                   | no                   | (none)                         | Auth username. Auth is attached only when BOTH `SMTP_USER` AND `SMTP_PASSWORD` are set.                  |
| `SMTP_PASSWORD`               | no                   | (none)                         | Auth password. **Note: the env name is `SMTP_PASSWORD`, NOT `SMTP_PASS`** (locked decision; see plan 13-01 user-decision 7). |
| `SMTP_FROM`                   | no                   | `"no-reply@openwhispr.local"`  | `From:` header value applied to every outgoing message.                                                  |
| `NODE_ENV`                    | no                   | (none)                         | When set to `"production"`, missing `SMTP_HOST` becomes a fatal construction error.                       |

### `NODE_ENV=production` loud-fail

In production, refusing to silently swallow verification emails is
non-negotiable. The factory throws synchronously at construction time:

```
Error: SMTP_HOST is required in production (event:email.smtp_required_in_production)
```

Operators should configure SMTP **before** booting the api/worker. The
error string includes a stable `event:email.smtp_required_in_production`
tag so it can be grepped from container logs.

### Non-production dev fallback

When `SMTP_HOST` is unset and `NODE_ENV !== "production"`, the factory
returns a stub sender that:

1. Emits a single greppable warn at construction:
   `{ event: "email.smtp_not_configured" }`.
2. Resolves every `.send()` call with `{ delivered: true, reason: "smtp-not-configured" }`.
3. Logs `{ event: "email.skipped" }` at info level for each call.
4. Never calls `nodemailer`.

This keeps Better Auth's `sendVerificationEmail` happy in a fresh
`docker compose up` with no SMTP wired, so the OSS first-launch SLO
survives.

## Error handling contract

`sender.send` **re-throws** any error raised by `nodemailer.sendMail`
(Pitfall #4 from `02-RESEARCH-CONTAINER.md`). This is intentional:

- Better Auth's verification flow must observe the rejection to keep the
  verification record unverified.
- Operators must see the failure in logs (and in Loki via the
  `event:"email.failed"` tag).

The factory itself only throws once, at construction, when the production
loud-fail gate trips. All runtime errors flow through `sender.send`.

## Logger contract

The `Logger` interface is structural:

```ts
export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}
```

Compatible with:

- Fastify's `FastifyBaseLogger` (the api path).
- `pino`'s `Logger` (the worker path; BullMQ workers run their own pino
  instance, not Fastify).
- A plain object `{ info: fn, warn: fn, error: fn }` (tests, ad-hoc
  scripts).

The package does **not** depend on `fastify` or `pino`. Callers wire
their own logger through.

## Log events emitted

| Event                         | Level | When                                                                                |
| ----------------------------- | ----- | ----------------------------------------------------------------------------------- |
| `email.smtp_not_configured`   | warn  | At construction in the dev-fallback path (`SMTP_HOST` unset, non-prod).             |
| `email.sent`                  | info  | After a successful `transporter.sendMail`. Payload includes `messageId`.            |
| `email.failed`                | error | When `transporter.sendMail` rejects. Payload includes the error. The error is then re-thrown. |
| `email.skipped`               | info  | Each `.send()` call in dev-fallback mode.                                           |

The constant `event` keys are stable and load-bearing — Loki dashboards
filter on them.

## Coverage

`vitest.config.ts` enforces a per-package `90/90/90/90` floor on
`packages/email/src/**/*.ts`. The constitutional floor for the wider
repo is also 90/90/90/90; this package matches it.

Run locally:

```bash
pnpm vitest run packages/email --coverage
```

## Testing posture

`nodemailer.createTransport` is mocked at the module boundary
(`vi.mock("nodemailer", …)`) — a third-party SaaS/network boundary,
which is the **only** category of mock permitted by the constitutional
rule "no mocks of internal logic". Real SMTP exercises live in the
end-to-end CJM harness (`tests/e2e-cjm/`) which boots a real `mailpit`
container.
