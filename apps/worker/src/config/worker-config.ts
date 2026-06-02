// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 66 / CR-03 — worker boundary config.
//
// This is the SINGLE place the worker resolves its process.env contract.
// As a `*config*.ts` file it is inside the LOCKER-01 allowed boundary set
// (CLAUDE.md rule 11) — `process.env` reads are permitted here and ONLY
// here for the worker's runtime configuration.
//
// CR-03 closes a constitutional LOCKER-01 violation: `email-delivery.ts`
// previously read `process.env.NODE_ENV` and silently green-completed an
// undelivered email whenever NODE_ENV !== "production" (staging / unset
// included). The dev-compose-up convenience is now an EXPLICIT operator
// opt-in via `EMAIL_FALLBACK_NONFATAL`, NOT a side effect of NODE_ENV.

/** Resolved worker runtime configuration. */
export interface WorkerConfig {
  /**
   * When `true`, the email-delivery job treats a `smtp-not-configured`
   * sender result as a non-fatal no-op (the job resolves instead of
   * throwing). This exists ONLY so a fresh `docker compose up` with no
   * SMTP env vars does not burn BullMQ retries. It is an explicit
   * operator opt-in (`EMAIL_FALLBACK_NONFATAL=1`/`true`) — it is NEVER
   * derived from `NODE_ENV`. With the flag OFF (the default), an
   * undelivered email fails the job so BullMQ retries / DLQs it.
   */
  allowSmtpFallback: boolean;

  /**
   * When `true`, the worker constructs the LiteLLM co-tenant DB pool and
   * registers the spend-reconciliation jobs (`ingest-litellm-spend`,
   * `reconciliation-daily-check`, `reconciliation-discrepancy`) plus the
   * reconciliation cron. These jobs read `LiteLLM_SpendLogs` DIRECTLY out
   * of LiteLLM's own database (cross-DB), so they cannot run without a
   * reachable LiteLLM DB URL.
   *
   * Resolution requires BOTH:
   *   1. an explicit operator opt-in (`SPEND_RECONCILIATION_ENABLED=1`/`true`), AND
   *   2. a LiteLLM DB URL (`LITELLM_READ_DATABASE_URL` ?? `LITELLM_DATABASE_URL`).
   *
   * It auto-resolves to `false` when no LiteLLM DB URL is set — EVEN IF the
   * flag is on — because there is nothing to reconcile against. On a
   * corporate self-host pointed at an EXTERNAL LiteLLM gateway, the worker
   * must NOT reach into that gateway's database (cross-service DB access is
   * a deploy-policy violation; spend is metered gateway-side per
   * virtual-key). Like `allowSmtpFallback`, it is NEVER derived from
   * `NODE_ENV`. Default OFF.
   */
  spendReconciliationEnabled: boolean;
}

/** Truthy-string parse — accepts `"1"` and `"true"` (case-insensitive). */
function envFlag(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true";
}

/**
 * Resolve the worker runtime config from the environment. `env` is
 * injectable so tests can exercise the parse without mutating
 * `process.env`.
 */
export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  // A LiteLLM DB URL is a hard prerequisite for spend reconciliation — the
  // jobs read LiteLLM_SpendLogs cross-DB. `?.trim()` so an empty-string env
  // (set-but-blank in a values.yaml) counts as absent.
  const litellmDbUrl = env.LITELLM_READ_DATABASE_URL?.trim() || env.LITELLM_DATABASE_URL?.trim();
  return {
    allowSmtpFallback: envFlag(env.EMAIL_FALLBACK_NONFATAL),
    spendReconciliationEnabled: envFlag(env.SPEND_RECONCILIATION_ENABLED) && Boolean(litellmDbUrl),
  };
}
