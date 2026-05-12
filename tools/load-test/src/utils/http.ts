// Phase 08 / Plan 02 — Task 2 GREEN: HTTP base constants.
//
// Pinned here so the k6 flow files (Wave 2 / Plan 06) all agree on
// the Traefik surface, headers, and TLS-verification posture.

/**
 * The Traefik HTTPS surface established in Phase 07.1. The load test
 * always hits HTTPS; CLAUDE.md forbids plaintext HTTP on externally
 * reachable ports.
 */
export const BASE_URL = "https://api.localhost";

/**
 * Default headers attached to every request the load test originates.
 * The User-Agent identifies traffic in access logs so operators can
 * isolate load-test runs from real traffic during forensics.
 */
export const DEFAULT_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "user-agent": "k6-openwhispr-load-test/1.0",
};

/**
 * k6 option that disables TLS verification. The self-host quickstart
 * uses ACME against `localhost`, which yields a self-signed cert k6
 * cannot validate without this flag. The corporate-override profile
 * (cert-manager + internal CA) flips this off via env.
 */
export const INSECURE_SKIP_TLS_VERIFY = true;
