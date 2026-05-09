// Phase 2 / Plan 06 — CONTRACT-01 conformance harness env.
//
// All HTTP traffic targets BACKEND_URL / AUTH_URL — never an in-process
// `app.inject`. Defaults match the Plan 02 docker-compose stack
// (api.localhost / auth.localhost via Traefik). CI sets these explicitly;
// operators running `make contract-test BACKEND_URL=https://api.customer.com`
// pass them through as well.
//
// SHOULD_RUN signals "BACKEND_URL was set explicitly OR a docker-compose
// stack is presumed live". Helpers may use it to decide whether a probe
// failure should mark the test as skipped vs failed.
export const BACKEND_URL: string =
  process.env.BACKEND_URL ?? "http://api.localhost";
export const AUTH_URL: string =
  process.env.AUTH_URL ?? "http://auth.localhost";

/**
 * True when BACKEND_URL is set explicitly (CI / operator deployments).
 * Used by tests to decide whether to skip vs fail when no backend is
 * reachable. The default fallback to api.localhost is benign — tests
 * that probe and find it unreachable will receive a fetch ECONNREFUSED.
 */
export const BACKEND_URL_EXPLICIT: boolean =
  typeof process.env.BACKEND_URL === "string" &&
  process.env.BACKEND_URL.length > 0;

/**
 * Probe `/api/health` once at suite start to determine whether the
 * backend is reachable. Returns true on 2xx, false on any error /
 * non-2xx. Tests use this with `describe.skipIf(!BACKEND_REACHABLE)`
 * so the suite passes cleanly when no stack is up.
 */
export async function probeBackend(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
