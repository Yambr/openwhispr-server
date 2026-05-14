# Loud-fail UX research — Phase 14 BYOK boot guard

## Existing OpenWhispr patterns

Three loud-fail / soft-warn shapes already live in the codebase. The new Phase 14 BYOK guard must be coherent with them.

**1. `loadLitellmConfigFromEnv` — synchronous throw, no exit, no structured payload** (`packages/litellm-client/src/config.ts:36-38`):
```ts
if (!masterKey || masterKey.length === 0) {
  throw new Error("LITELLM_MASTER_KEY is required");
}
```
The bootstrap entry point in `apps/api/src/index.ts:564-576` catches this, logs a `console.warn` with the **redacted** URL + error class name, and **continues booting** — the LiteLLM-backed routes are simply skipped. This is the "soft-warn → degraded surface" posture (operator gets 404, not 503).

**2. `createEmailSender` — NODE_ENV-gated hard fail** (`packages/email/src/EmailSender.ts:74-91`):
```ts
if (env.NODE_ENV === "production") {
  throw new Error(
    "SMTP_HOST is required in production (event:email.smtp_required_in_production)",
  );
}
// non-prod: log.warn({event: "email.smtp_not_configured"}, "..."); return stub sender
```
This is the closest pattern to what Phase 14 needs: production loud-fail with a stable `event:` token in the message, non-prod degraded mode. **The token convention `event:<dot.namespaced.id>` is already a search key in Loki queries.** No exit code is set explicitly — `pino` is unaware; the throw propagates up and Node exits non-zero on uncaught.

**3. `apps/api/src/index.ts:670-676` — final listen() catch arm:**
```ts
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  console.error(err);
  process.exit(1);
});
```
The only explicit `process.exit` in the api boot path uses **exit 1**, not 78. The worker entry point `apps/worker/src/index.ts:220,238` uses `process.exit(0)` for SIGTERM, `process.exit(1)` for fatal errors. **The codebase has no precedent for `sysexits.h` codes.**

**4. Bootstrap warning redaction (Phase 13 HI-02):** `redactUrl()` is mandatory on any string that may embed a credential. Same rule applies to the new BYOK guard — if the missing-env diagnostic mentions any *existing* env (e.g., to suggest "DATABASE_URL is fine but..."), it must redact.

**Pino usage:** `apps/api/src/auth.ts:150` has `fatal: noop` in a logger stub — Pino's fatal level is reserved but **never actually invoked anywhere in production code**. There is no current `logger.fatal({...}, msg); process.exit(N)` pattern to align with.

## Ecosystem norms

- **`sysexits.h` exit 78 (EX_CONFIG) is rarely used in real Node services.** The dedicated [`sysexits` npm package](https://github.com/jeanlauliac/sysexits) exists but has minimal uptake; mainstream Node tooling (npm, pnpm, eslint, vitest) all use **exit 1** for "something went wrong" without finer-grained codes. The convention is documented but not adopted ([Node.js Exit Codes](https://www.geeksforgeeks.org/node-js-exit-codes/), [chrisdown.name](https://chrisdown.name/2013/11/03/exit-code-best-practises.html)).
- **Docker / Kubernetes treat any non-zero exit identically** — `restart: on-failure` and `restartPolicy: Always` retry regardless of whether the code is 1 or 78. Kubernetes applies exponential back-off (10s → 20s → 40s → cap 5min) and surfaces `CrashLoopBackOff`; the exit code is shown by `kubectl describe pod` but **does not influence retry behavior** ([Sysdig](https://www.sysdig.com/blog/debug-kubernetes-crashloopbackoff), [Komodor](https://komodor.com/learn/how-to-fix-crashloopbackoff-kubernetes-error/)). So picking 78 vs 1 buys ZERO operational change in either runtime; the only benefit is operator-visible classification.
- **Pino's `fatal` level + `process.exit` handoff** is a documented pattern but requires `logger.flush()` or `pino.final()` since Pino is async — naive `log.fatal(...); process.exit()` truncates the line under load. Boot-time guards run before any async logger flushing pressure, so the risk is small, but the pattern still needs `await new Promise<void>(r => logger.flush(r))` for correctness.
- **Fastify boot-failure convention:** `app.listen().catch(err => { console.error(err); process.exit(1); })` is the official template (matches what `apps/api/src/index.ts:672` already does).

## Comparison table

| Option | Operator clarity | SRE parsing | Consistency | Complexity | Tests | Restart-loop behavior |
|---|---|---|---|---|---|---|
| **A. Typed JSON to stderr + exit 78** | LOW (humans must learn codes) | HIGH (structured, greppable) | LOW (no JSON-to-stderr precedent; codebase uses Pino or `console.warn`/`console.error` with string args) | Medium — new helper + new code registry doc | Helper + per-overlay tests; ~6-8 cases | Identical to exit 1 in both Docker and K8s; CrashLoopBackOff fires regardless |
| **B. Human text to stderr + exit 1** | HIGH (one-line, immediate) | LOW (regex-only classification) | MEDIUM (matches `index.ts:674-675` but loses the `event:` discriminator the rest of the codebase uses) | Low — one-line guard | ~3-4 cases per overlay | Same |
| **C. NODE_ENV-gated dual mode** | Medium (varies) | Medium | LOW (NODE_ENV-gates are a known footgun; double the matrix) | High — two formats + env gate | Double the surface | Same |
| **D. Pino `log.fatal({code, missing, hint}, msg)` + exit 78** | HIGH in Loki (one line, structured + human-readable msg field) | HIGH (Pino JSON is already the canonical log format ingested by Loki/Mimir) | **HIGH — matches the codebase's structured-logging contract; `event:` token convention extends naturally to `code:` field** | Low — reuse existing Pino logger instance + `pino.final()` flush helper | ~4-6 cases per overlay | Same |
| **E. (proposed) Pino `log.fatal({code,...}, msg)` + exit 1** | HIGH | HIGH | HIGHEST (matches BOTH the structured-log contract AND the `index.ts:675` exit-1 precedent) | Low | ~4-6 cases | Same |

## Recommendation: Option E (Pino fatal + exit 1) with `event:` + `code:` discriminators

Use the existing `pino` logger (`apps/api/src/index.ts` already has one in scope via the Fastify instance, and the bootstrap path can construct a `pino({ name: "boot" })` mirroring `apps/worker/src/index.ts:65`) to emit **one** structured fatal line, flush it via `pino.final()`, then `process.exit(1)`. Shape:

```ts
// In a new apps/api/src/lib/byok-guard.ts
const logger = pino({ name: "boot" });
const finalLogger = pino.final(logger);
finalLogger.fatal(
  {
    event: "byok.required",
    code: "BYOK_STORAGE_REQUIRED",
    overlay: "storage",
    missing: ["S3_ENDPOINT"],
    hint: "Set S3_ENDPOINT or enable the storage overlay (docker compose -f docker-compose.yml -f compose/docker-compose.storage.yml up)",
  },
  "BYOK env missing for disabled overlay; refusing to start",
);
process.exit(1);
```

**Why E beats D:** The single deviation Option D introduces — exit 78 — buys zero operational behavior change in Docker or Kubernetes (both back-off identically on any non-zero) and contradicts the only existing `process.exit(N)` call in the api entry point (`index.ts:675` uses 1). Exit 1 stays consistent with `apps/worker/src/index.ts:238`, with the existing api `listen().catch` arm, and with every other Node tool in the stack (npm, pnpm, vitest, drizzle-kit). The structured Pino payload alone gives SRE everything Option A's JSON-to-stderr gave — `code`, `missing`, `hint` — but inside the canonical log stream already shipped to Loki via the Phase 6 LGTM stack, so the operator gets one searchable record per boot failure (`{event="byok.required"} | json | code="BYOK_STORAGE_REQUIRED"`) without a second log surface to tail. It extends the `event:` token convention from `createEmailSender` (`email.smtp_required_in_production`) into a stable namespaced family (`byok.required`, `byok.storage_required`, etc.), and the `code:` field gives ops a stable enum for alerting rules. The `pino.final()` wrapper avoids the truncation pitfall called out in the Pino fatal docs. This is the option that adds the least new surface, contradicts zero existing patterns, and gives both humans (`msg` field is rendered as a sentence) and machines (every other field is a discriminator) what they need.

**Catch-arm cohabitation:** at the very top of `index.ts` (before `installGlobalSSRF()`), call `assertBYOKConfig(process.env)` from the new helper module; on missing overlay+env pairs it emits the fatal line + exits. This places the guard BEFORE `otel-bootstrap` import side-effects fire — important because OTel SDK init may itself try to dial `OTEL_EXPORTER_OTLP_ENDPOINT`, which on a misconfigured boot is exactly the kind of cascading-error noise the loud-fail is meant to prevent.

## Open questions for the user

1. Should the BYOK guard fire in `NODE_ENV !== "production"` too, or follow the `createEmailSender` precedent and only loud-fail in production? Phase 14 success criterion #3 says "refuses to start" without env qualification — recommend **always loud-fail** (no NODE_ENV gate) since the overlay flag is the operator's explicit opt-in signal; a dev who forgets to enable storage overlay should see the failure immediately, not get a half-broken stack.
2. Is there appetite for promoting the `event:` + `code:` shape into a shared `packages/observability` constants module so it can be reused by the three worker noop loud-fails (criterion #4)? That would unify Phase 14 byok loud-fails with the worker loud-fails landing in the same phase.

Sources:
- [GitHub - jeanlauliac/sysexits npm package](https://github.com/jeanlauliac/sysexits)
- [Node.js Exit Codes — GeeksforGeeks](https://www.geeksforgeeks.org/node-js-exit-codes/)
- [Exit code best practices — chrisdown.name](https://chrisdown.name/2013/11/03/exit-code-best-practises.html)
- [sysexits.h Linux manual page](https://man7.org/linux/man-pages/man3/sysexits.h.3head.html)
- [Kubernetes CrashLoopBackOff — Sysdig](https://www.sysdig.com/blog/debug-kubernetes-crashloopbackoff)
- [Kubernetes CrashLoopBackOff — Komodor](https://komodor.com/learn/how-to-fix-crashloopbackoff-kubernetes-error/)
