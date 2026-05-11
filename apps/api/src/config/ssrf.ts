// Phase 6 / Plan 06 / SCALE-04 — SSRF config (D-S1..S6).
//
// Env-driven configuration for the process-wide SSRF dispatcher. Parsed
// once at boot (apps/api/src/bootstrap.ts → installGlobalSSRF()).
//
// Vars (D-S4):
//   OUTBOUND_ALLOWED_HOSTS           — comma-separated default-deny allow-list.
//                                      Bare entries match exact host; `*.foo.bar`
//                                      matches one-or-more left labels.
//                                      EMPTY ⇒ deny everything (locked).
//   OUTBOUND_PRIVATE_HOST_ALLOWLIST  — hostnames (typically docker-compose
//                                      service names like `litellm`, `valkey`)
//                                      permitted to resolve to RFC1918.
//   OUTBOUND_ALLOW_LOOPBACK          — `"1"` permits 127/8 + ::1 ONLY when
//                                      NODE_ENV != 'production' (D-S6).
//   OUTBOUND_SSRF_MODE               — `enforce` (default) | `warn`. Warn
//                                      mode still emits audit row with
//                                      payload.mode='warn' (D-S5).

import { z } from "zod";

const csv = z
  .string()
  .optional()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );

export const ssrfEnvSchema = z.object({
  OUTBOUND_ALLOWED_HOSTS: csv,
  OUTBOUND_PRIVATE_HOST_ALLOWLIST: csv,
  OUTBOUND_ALLOW_LOOPBACK: z
    .string()
    .optional()
    .default("0")
    .transform((v) => v === "1"),
  OUTBOUND_SSRF_MODE: z.enum(["enforce", "warn"]).default("enforce"),
});

export type SSRFConfig = z.infer<typeof ssrfEnvSchema>;

export function loadSSRFConfig(env: NodeJS.ProcessEnv = process.env): SSRFConfig {
  return ssrfEnvSchema.parse(env);
}
