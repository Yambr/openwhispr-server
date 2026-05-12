// Phase 08 / Plan 02 — Task 2 GREEN: k6 setup() user provisioner.
//
// `provisionUsers()` is the pure, vitest-testable core of the k6 setup()
// hook. It pre-creates N users via Better Auth's
// /api/auth/sign-up/email so the steady-state load run binds a stable
// VU-to-user mapping (no sign-up storms during steady-state).
//
// The k6 runtime wrapper at the bottom of this file is excluded from
// vitest coverage because its execution context is k6, not vitest.

import { BASE_URL, DEFAULT_HEADERS } from "./utils/http.js";

/** One pre-provisioned user, consumed by k6 VUs at iteration time. */
export interface ProvisionedUser {
  email: string;
  token: string;
}

/** Shape of the HTTP response surface the provisioner needs. */
export interface HttpResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/** Injectable HTTP client; tests swap in a vi.fn(). */
export type HttpClient = (url: string, body: unknown) => HttpResponse;

/** Injectable sleep; tests swap in a vi.fn() to avoid wall-clock waits. */
export type Sleep = (ms: number) => void;

export interface ProvisionUsersOpts {
  backend: string;
  count: number;
  httpClient: HttpClient;
  sleep: Sleep;
  /** Pace between sign-ups in milliseconds. Default 50. */
  paceMs?: number;
}

/**
 * Pre-provision `count` users via Better Auth. Returns one
 * `ProvisionedUser` per user. Throws when any sign-up returns non-200,
 * identifying the offending user index in the message.
 *
 * Email uniqueness is guaranteed across invocations by a high-resolution
 * timestamp suffix (millis + a counter), so a re-run does not collide
 * with users created by a previous run.
 */
export function provisionUsers(opts: ProvisionUsersOpts): ProvisionedUser[] {
  const paceMs = opts.paceMs ?? 50;
  const stamp = `${Date.now()}-${COUNTER.next()}`;
  const users: ProvisionedUser[] = [];
  for (let i = 0; i < opts.count; i += 1) {
    const email = `loadtest-${stamp}-${i}@example.test`;
    const response = opts.httpClient(`${opts.backend}/api/auth/sign-up/email`, {
      email,
      password: "Password-12345!",
      name: `LoadTest User ${i}`,
    });
    if (response.status !== 200) {
      throw new Error(`provisionUsers: user ${i} sign-up failed with status ${response.status}`);
    }
    const token = readToken(response);
    if (token === null) {
      throw new Error(`provisionUsers: user ${i} sign-up returned no token in body or headers`);
    }
    users.push({ email, token });
    opts.sleep(paceMs);
  }
  return users;
}

function readToken(response: HttpResponse): string | null {
  if (
    typeof response.body === "object" &&
    response.body !== null &&
    "token" in response.body &&
    typeof (response.body as { token: unknown }).token === "string"
  ) {
    return (response.body as { token: string }).token;
  }
  for (const [key, value] of Object.entries(response.headers)) {
    if (key.toLowerCase() === "set-auth-token") {
      return value;
    }
  }
  return null;
}

// Monotonic counter so two invocations within the same millisecond
// still yield distinct email suffixes (the timestamp-only suffix would
// collide under fast vitest runs).
const COUNTER = {
  value: 0,
  next(): number {
    this.value += 1;
    return this.value;
  },
};

// ---------------------------------------------------------------------------
// k6 runtime wrapper (excluded from vitest coverage via vitest.config.ts).
//
// Wave 2 / Plan 06 wires this into the k6 default export. Wave 0 keeps
// the binding here so consumers can `import { setup } from '@openwhispr/load-test/setup'`
// once the flow files land. The body is intentionally minimal — all
// non-k6 logic lives in `provisionUsers()` above so it stays unit-testable.
// ---------------------------------------------------------------------------

/* c8 ignore start */
/**
 * k6 setup() hook. Reads N_USERS from env (default 1000) and pre-creates
 * the users. The returned array is passed into every VU iteration via
 * the k6 `data` argument.
 *
 * @param httpClient — injectable for the rare case Wave 2 needs to swap
 *                     in a different transport; defaults to a thin wrapper
 *                     around k6's `http.post` which is only available in
 *                     the k6 VM, hence the lazy import pattern Wave 2 will
 *                     use.
 */
export function setup(httpClient: HttpClient, sleep: Sleep): ProvisionedUser[] {
  const count = Number(globalThis.process?.env?.["N_USERS"] ?? "1000");
  return provisionUsers({
    backend: BASE_URL,
    count,
    httpClient,
    sleep,
    paceMs: 50,
  });
}
export const DEFAULTS_HEADERS_REF = DEFAULT_HEADERS;
/* c8 ignore stop */
