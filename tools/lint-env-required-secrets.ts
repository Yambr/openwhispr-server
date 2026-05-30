// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-env-required-secrets.ts — keep `.env.slim.example` in sync with the
 * migrate container's boot gate.
 *
 * `apps/api/scripts/check-default-secrets.ts` defines `COMPOSE_REQUIRED_KEYS` —
 * the secrets the migrate container REFUSES to start without (services the
 * `default` compose profile stands up). The slim OSS quickstart
 * (`.env.slim.example`, the bootstrap template) MUST seed every one of them
 * with a generatable placeholder, else `git clone && docker compose up` dies
 * at the migrate step with `refusing to start: <KEY> is unset…`.
 *
 * This was the contract-test / e2e / load-smoke `migrate exit 1` root cause
 * (fix 260530-rqk): PGBOUNCER/TRAEFIK/MINIO/GRAFANA secrets were missing from
 * slim. These pure helpers let the test assert the two lists stay aligned.
 */

/** Parse the `COMPOSE_REQUIRED_KEYS` array literal out of check-default-secrets.ts. */
export function parseComposeRequiredKeys(src: string): string[] {
  const m = src.match(/COMPOSE_REQUIRED_KEYS\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return [];
  return Array.from(m[1].matchAll(/["']([A-Z0-9_]+)["']/g)).map((x) => x[1]);
}

/**
 * Return the set of ACTIVE (uncommented) `KEY=` assignments in an env-example
 * body. Commented (`# KEY=`) and blank lines are excluded.
 */
export function parseActiveEnvKeys(body: string): Set<string> {
  const keys = new Set<string>();
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z0-9_]+)=/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

/**
 * Required keys NOT present (active) in the env template — the drift the boot
 * gate would reject. Empty array means the template covers the gate.
 */
export function missingRequiredKeys(requiredKeys: string[], envBody: string): string[] {
  const active = parseActiveEnvKeys(envBody);
  return requiredKeys.filter((k) => !active.has(k));
}
