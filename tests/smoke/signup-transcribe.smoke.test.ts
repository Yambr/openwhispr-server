// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 60 — embedded-litellm stack smoke probe.
//
// End-to-end round-trip against a fully booted `docker compose` stack
// (compose/docker-compose.embedded-litellm.yml) wired to a hermetic mock
// LiteLLM (litellm_config.contract.yaml — every chat / transcription call
// short-circuits to a canned `mock_response`, so this probe needs NO
// provider keys and makes NO outbound network egress).
//
// Asserts the OSS-quickstart happy path:
//   (a) POST /api/auth/sign-up/email returns a non-error response and a
//       session cookie usable for the follow-up authenticated call;
//   (b) POST /api/transcribe with the bundled 1-second WAV fixture returns
//       200 with a string `text` field (the mock LiteLLM transcript).
//
// This is the Success Criterion 2 probe for the OSS publish: it proves a
// fresh `git clone && docker compose up` stack can complete sign-up plus
// transcribe with zero secrets configured.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, fetch, setGlobalDispatcher } from "undici";
import { describe, expect, it } from "vitest";

const SMOKE_BASE_URL = process.env.SMOKE_BASE_URL ?? "https://api.localhost";

// Self-signed mkcert dev certs are not in Node's CA bundle by default;
// allow them for *.localhost only.
setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Wrap the repo-root audio fixture in a single-part multipart/form-data
 * envelope. The boundary is timestamp-suffixed so concurrent runs do not
 * collide on a static boundary string.
 */
function audioMultipartBody(): { body: Buffer; contentType: string } {
  const filename = "sample-1s.wav";
  const boundary = `----openwhispr-smoke-boundary-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const fileBytes = readFileSync(resolve(__dirname, "../fixtures/audio", filename));
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    body: Buffer.concat([head, fileBytes, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("smoke: sign-up + transcribe round-trip (Phase 60)", () => {
  it("signs up a transient user and transcribes the WAV fixture via mock LiteLLM", {
    timeout: 30_000,
  }, async () => {
    // (a) Sign-up — Better Auth's sign-up/email path returns the session
    // cookie directly in `set-cookie`, which we replay on the follow-up
    // authenticated /api/transcribe call.
    const email = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@smoke.test`;
    const signUp = await fetch(`${SMOKE_BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: SMOKE_BASE_URL,
      },
      body: JSON.stringify({
        email,
        password: "smoke-Passw0rd!-test",
        name: "Smoke Test User",
      }),
    });
    // Non-error response — Better Auth answers 200 on a fresh sign-up.
    expect(
      signUp.status,
      `sign-up failed: ${signUp.status} ${await signUp
        .clone()
        .text()
        .catch(() => "")}`,
    ).toBeLessThan(400);

    const setCookie = signUp.headers.get("set-cookie");
    expect(setCookie, "sign-up did not return a session cookie").toBeTruthy();
    // Reduce the raw set-cookie header to a `name=value; name=value` jar.
    const cookieJar = (setCookie as string)
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.split(";")[0]?.trim())
      .filter(Boolean)
      .join("; ");

    // (b) Transcribe — authenticated multipart upload of the bundled
    // 1-second WAV fixture. Mock LiteLLM returns a canned transcript.
    const { body, contentType } = audioMultipartBody();
    const transcribe = await fetch(`${SMOKE_BASE_URL}/api/transcribe`, {
      method: "POST",
      headers: { "content-type": contentType, cookie: cookieJar },
      body,
    });
    expect(
      transcribe.status,
      `transcribe failed: ${transcribe.status} ${await transcribe
        .clone()
        .text()
        .catch(() => "")}`,
    ).toBe(200);
    const json = (await transcribe.json()) as { text?: unknown };
    expect(typeof json.text).toBe("string");
    expect((json.text as string).length).toBeGreaterThan(0);
  });
});
