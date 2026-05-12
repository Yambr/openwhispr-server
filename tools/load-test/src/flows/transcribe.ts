// Phase 08 / Plan 06 — Task 2 GREEN: transcribe flow.
//
// Submits a 5-second 16 kHz mono WAV to POST /api/transcribe as a
// multipart upload. The body shape mirrors what the OpenWhispr Electron
// client sends in production:
//   - field "file"     : binary WAV bytes
//   - field "model"    : the ASR model id (Whisper large-v3)
//   - field "language" : ISO-639-1 short code, fixed to "en" for the run
//
// The flow rotates the VU's bearer if the response carries
// `set-auth-token` so subsequent iterations keep authenticating.
// It NEVER throws on non-2xx — the k6 `check()` macro records the
// failure as a metric so a single endpoint outage cannot abort the
// whole run.

import { updateBearer } from "../utils/auth.js";
import { BASE_URL } from "../utils/http.js";
import type { HttpClient } from "../utils/http-client.js";

/** One pre-provisioned VU-bound user. */
export interface User {
  email: string;
  token: string;
}

/**
 * Dependencies the flow consumes. Tests inject `wavBytes` directly;
 * the k6 entrypoint passes the bytes loaded once at script-init via
 * `k6 open('fixtures/sample-5s-16k.wav', 'b')`.
 */
export interface TranscribeDeps {
  wavBytes: Uint8Array;
  /** Model id; defaults to the canonical Whisper large-v3 identifier. */
  model?: string;
}

const DEFAULT_MODEL = "Systran/faster-whisper-large-v3";

export function transcribe(user: User, client: HttpClient, deps: TranscribeDeps): void {
  // k6's http.request accepts an object body where binary fields are
  // wrapped in `http.file(bytes, filename, contentType)`. We pass the
  // raw bytes here because the k6 adapter (in production) wraps them
  // with http.file before forwarding. In tests the mock asserts the
  // shape verbatim.
  const body = {
    file: deps.wavBytes,
    model: deps.model ?? DEFAULT_MODEL,
    language: "en",
  };
  const response = client.request("POST", `${BASE_URL}/api/transcribe`, body, {
    headers: {
      authorization: `Bearer ${user.token}`,
    },
    tags: { endpoint: "transcribe" },
  });
  updateBearer(user, response);
  // Non-2xx is recorded as a metric in the k6 runtime (the adapter's
  // failure path), but we MUST NOT throw — a single 503 cannot abort
  // the VU iteration loop.
  if (response.status >= 200 && response.status < 300) {
    return;
  }
}
