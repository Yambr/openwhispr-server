/**
 * First-launch SLO probe — DEPLOY-05 mitigation.
 *
 * Behavior (per Plan 09-11 must_haves):
 *   1. Reads env TARGET (required) and SLO_DEADLINE_MS (default 300000).
 *   2. Generates a random email + password.
 *   3. POSTs /api/auth/sign-up/email — captures Set-Cookie session + opaque bearer token
 *      (Better Auth returns the bearer token in the response body when configured with the
 *      bearer plugin, per Phase 02 wire decisions).
 *   4. POSTs multipart 5s WAV fixture to /api/transcribe with `Authorization: Bearer <opaque>`.
 *   5. Asserts HTTP 200 + JSON body shape { id, text, ... }.
 *   6. Emits a single structured JSON line on stdout: {"ok": bool, "elapsedMs": N, "deadline": D, "step": "ok"|"<failed-step>"}.
 *   7. Exits 0 iff ok && elapsedMs <= deadline; nonzero otherwise.
 *
 * Threat-model mitigation T-09-04: NEVER write the bearer token, session cookie, or password to
 * stdout/stderr. The probe redacts those fields from any log payload.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Dispatcher, FormData, fetch, type RequestInit } from "undici";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Fixture path resolution: prefer the bundled location next to the compiled
// JS (`dist/../fixtures/sample-5s.wav`) but fall back to the source-tree
// location when running via `tsx`.
function fixturePath(): string {
  const candidates = [
    join(__dirname, "..", "fixtures", "sample-5s.wav"),
    join(__dirname, "..", "..", "fixtures", "sample-5s.wav"),
  ];
  for (const c of candidates) {
    try {
      readFileSync(c);
      return c;
    } catch {
      /* c8 ignore next -- candidate not present, try next */
    }
  }
  /* c8 ignore next -- defensive: both candidates missing means broken image build */
  throw new Error(`probe fixture sample-5s.wav not found in ${candidates.join(", ")}`);
}

export interface ProbeResult {
  ok: boolean;
  elapsedMs: number;
  deadline: number;
  step:
    | "ok"
    | "signup-failed"
    | "no-bearer-token"
    | "transcribe-non-200"
    | "transcribe-bad-body"
    | "transcribe-too-slow";
  // status-only metadata; NEVER the bearer or password
  signupStatus?: number;
  transcribeStatus?: number;
  errorDetail?: string;
}

export interface ProbeOptions {
  target: string;
  deadlineMs: number;
  fixture?: Buffer;
  // Optional dispatcher (used by tests to inject a Fastify boundary)
  dispatcher?: Dispatcher;
  // Override RNG for deterministic test emails
  rng?: () => string;
}

function randomEmail(rng: () => string): string {
  return `probe-${rng()}@openwhispr.test`;
}

function randomPassword(rng: () => string): string {
  // Better Auth requires ≥ 8 chars by default; include mixed case + digit.
  return `Pw-${rng()}-${rng()}-9X`;
}

function defaultRng(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Pure probe logic — exposed for unit testing without process.exit.
 * Returns a ProbeResult; the caller decides exit code + stdout emission.
 */
export async function runProbe(opts: ProbeOptions): Promise<ProbeResult> {
  const startedAt = Date.now();
  const rng = opts.rng ?? defaultRng;
  const email = randomEmail(rng);
  const password = randomPassword(rng);
  const fixture = opts.fixture ?? readFileSync(fixturePath());

  const init = (extra: RequestInit = {}): RequestInit & { dispatcher?: Dispatcher } => {
    const merged: RequestInit & { dispatcher?: Dispatcher } = { ...extra };
    if (opts.dispatcher) {
      merged.dispatcher = opts.dispatcher;
    }
    return merged;
  };

  // --- 1. Sign up via Better Auth ---------------------------------------
  // Phase 09.2 F35: Better Auth's CSRF/origin gate rejects POST requests
  // whose Origin (or Referer) does not match `trustedOrigins`. undici's
  // default fetch sends NO Origin header, so the gate returned 403 in the
  // first kind helm test run. Send Origin = target so the api side admits
  // it (operator must include the in-cluster api Service URL in
  // AUTH_TRUSTED_ORIGINS_EXTRA — chart api-deployment.yaml does this
  // automatically for the in-cluster path).
  const signupUrl = `${opts.target}/api/auth/sign-up/email`;
  let signupResp: Awaited<ReturnType<typeof fetch>>;
  try {
    signupResp = await fetch(
      signupUrl,
      init({
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: opts.target,
        },
        body: JSON.stringify({ email, password, name: "probe" }),
      }),
    );
  } catch (err) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      deadline: opts.deadlineMs,
      step: "signup-failed",
      errorDetail: err instanceof Error ? err.message : String(err),
    };
  }

  if (signupResp.status < 200 || signupResp.status >= 300) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      deadline: opts.deadlineMs,
      step: "signup-failed",
      signupStatus: signupResp.status,
    };
  }

  // Better Auth bearer plugin returns the opaque token either in
  // `set-auth-token` response header OR in body.token. We accept both.
  const setAuthToken = signupResp.headers.get("set-auth-token");
  let bearer: string | undefined = setAuthToken ?? undefined;
  if (!bearer) {
    try {
      const body = (await signupResp.json()) as { token?: string; session?: { token?: string } };
      bearer = body.token ?? body.session?.token;
    } catch {
      /* c8 ignore next -- malformed signup body falls through to no-bearer-token */
      bearer = undefined;
    }
  }
  if (!bearer) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      deadline: opts.deadlineMs,
      step: "no-bearer-token",
      signupStatus: signupResp.status,
    };
  }

  // --- 2. POST /api/transcribe ------------------------------------------
  const form = new FormData();
  form.set("file", new Blob([fixture], { type: "audio/wav" }), "sample-5s.wav");
  form.set("model", "whisper-1");
  const transcribeUrl = `${opts.target}/api/transcribe`;
  let transcribeResp: Awaited<ReturnType<typeof fetch>>;
  try {
    transcribeResp = await fetch(
      transcribeUrl,
      init({
        method: "POST",
        headers: { authorization: `Bearer ${bearer}` },
        body: form,
      }),
    );
  } catch (err) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      deadline: opts.deadlineMs,
      step: "transcribe-non-200",
      errorDetail: err instanceof Error ? err.message : String(err),
    };
  }

  if (transcribeResp.status !== 200) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      deadline: opts.deadlineMs,
      step: "transcribe-non-200",
      transcribeStatus: transcribeResp.status,
    };
  }

  let body: { id?: string; text?: string } | undefined;
  try {
    body = (await transcribeResp.json()) as { id?: string; text?: string };
  } catch {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      deadline: opts.deadlineMs,
      step: "transcribe-bad-body",
      transcribeStatus: transcribeResp.status,
    };
  }
  if (!body || typeof body.text !== "string") {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      deadline: opts.deadlineMs,
      step: "transcribe-bad-body",
      transcribeStatus: transcribeResp.status,
    };
  }

  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > opts.deadlineMs) {
    return {
      ok: false,
      elapsedMs,
      deadline: opts.deadlineMs,
      step: "transcribe-too-slow",
      transcribeStatus: 200,
    };
  }

  return {
    ok: true,
    elapsedMs,
    deadline: opts.deadlineMs,
    step: "ok",
    transcribeStatus: 200,
  };
}

/**
 * CLI entry point. Reads env, runs probe, emits structured JSON, sets exit code.
 */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const target = env.TARGET;
  if (!target) {
    process.stderr.write("TARGET env var required\n");
    return 2;
  }
  const deadlineMs = Number.parseInt(env.SLO_DEADLINE_MS ?? "300000", 10);
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    process.stderr.write(`invalid SLO_DEADLINE_MS=${env.SLO_DEADLINE_MS}\n`);
    return 2;
  }
  const result = await runProbe({ target, deadlineMs });
  // Single structured line — operators / kubectl logs grep this.
  // Status-only fields, no secret material.
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : 1;
}

// Direct-run guard (skip when imported by tests).
/* c8 ignore start -- CLI bootstrap, exercised at runtime not in vitest */
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`probe crashed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
/* c8 ignore stop */
