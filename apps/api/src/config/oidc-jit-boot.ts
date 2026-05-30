// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-01 / Task 1 — JIT mapping boot validator.
//
// `validateJitBoot()` is the SINGLE JSON.parse site for the two JIT mapping
// env vars (OIDC_TENANT_MAPPING / OIDC_ROLE_MAPPING). It lives under config/
// alongside `validateLitellmBoot()` / `validateEncryptionBoot()` — co-locating
// every boot-time loud-fail gate in one discoverable place. This placement is
// ARCHITECTURAL, NOT a locker mandate: LOCKER-01 restricts ONLY NODE_ENV
// branching outside the allowlisted boot files, and scalar process.env reads
// in lib/ are an established precedent (lib/oidc-providers.ts). The reason the
// JSON.parse lives here is the loud-fail co-location, not a JSON.parse ban.
//
// On malformed JSON OR a zod-shape failure the validator calls `onFail` with a
// FATAL message naming the offending var. The default `onFail` writes FATAL to
// stderr and `process.exit(78)` (EX_CONFIG) — verbatim posture from
// config/litellm.ts. Unit tests inject a throwing stub instead of exiting.
//
// `readJitConfig()` (lib/oidc-jit-config.ts) delegates to this function so the
// loud-fail parse happens exactly once; the loader receives already-parsed,
// already-validated objects.

import { z } from "zod";

const EX_CONFIG = 78;

/** Zod shape for OIDC_TENANT_MAPPING: claim-value → tenant-id (string → string). */
const tenantMappingSchema = z.record(z.string(), z.string());

/** Zod shape for OIDC_ROLE_MAPPING: group-name → role (string → enum). */
const roleMappingSchema = z.record(z.string(), z.enum(["admin", "member", "viewer"]));

/** The parsed + validated mapping pair returned to `readJitConfig`. */
export interface JitBootMappings {
  readonly tenantMapping?: Record<string, string>;
  readonly roleMapping?: Record<string, "admin" | "member" | "viewer">;
}

/**
 * Parse + validate the two JIT mapping env vars or refuse to boot.
 *
 * @param env Environment snapshot. Defaults to `process.env`; injected in unit
 *   tests to avoid mutating the global.
 * @param onFail Side-effect invoked on malformed/invalid mapping JSON. Production
 *   callers omit this; the default writes FATAL to stderr and `process.exit(78)`.
 * @returns `{tenantMapping, roleMapping}` — each `undefined` when its var is absent.
 */
export function validateJitBoot(
  env: NodeJS.ProcessEnv = process.env,
  onFail: (message: string) => never = defaultFail,
): JitBootMappings {
  const tenantMapping = parseMapping(
    "OIDC_TENANT_MAPPING",
    env.OIDC_TENANT_MAPPING,
    tenantMappingSchema,
    onFail,
  );
  const roleMapping = parseMapping(
    "OIDC_ROLE_MAPPING",
    env.OIDC_ROLE_MAPPING,
    roleMappingSchema,
    onFail,
  );
  // Conditional spread: under exactOptionalPropertyTypes an optional prop must be
  // omitted rather than assigned an explicit `undefined`.
  return {
    ...(tenantMapping !== undefined ? { tenantMapping } : {}),
    ...(roleMapping !== undefined ? { roleMapping } : {}),
  };
}

function parseMapping<T>(
  varName: string,
  raw: string | undefined,
  schema: z.ZodType<T>,
  onFail: (message: string) => never,
): T | undefined {
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return onFail(
      `oidc-jit-boot: ${varName} is not valid JSON. Refusing to boot — fix the ` +
        `JSON map (e.g. ${varName}={"key":"value"}) and restart.`,
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return onFail(
      `oidc-jit-boot: ${varName} has an invalid shape. Refusing to boot — ` +
        `${result.error.issues.map((i) => i.message).join("; ")}.`,
    );
  }
  return result.data;
}

/* v8 ignore start -- boot loud-fail sink: process.exit(78) is never executed
   in unit tests (would kill the runner); tests inject a throwing onFail stub. */
function defaultFail(message: string): never {
  // biome-ignore lint/suspicious/noConsole: pre-logger boot path — stderr is the only sink.
  console.error(`FATAL ${message}`);
  process.exit(EX_CONFIG);
}
/* v8 ignore stop */
