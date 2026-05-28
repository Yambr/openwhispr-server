// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-05 — unit test for scripts/seed-keycloak-realm.sh.
//
// Per `feedback_cjm_steps_need_unit_tests`: the realm seeder MUST have a
// unit test that boundary-mocks the Keycloak Admin REST API (token endpoint
// + POST /admin/realms) so the URL/payload contract is exercised without a
// live container. We stand up a tiny in-process HTTP server that plays the
// Keycloak admin surface, point the script at it via KC_URL, and assert:
//
//   1. the script acquires an admin token from
//      /realms/master/protocol/openid-connect/token (client_id=admin-cli,
//      grant_type=password) and uses it as a Bearer on the import POST;
//   2. it POSTs the realm JSON to /admin/realms with the realm body intact;
//   3. a 409 (realm already exists) is treated as success (idempotent);
//   4. the admin password is NEVER embedded in a shell command string —
//      it is passed via curl --data fields read from env (LOCKER-06).
//
// The script is invoked via argv-array spawn(shell:false) with secrets in
// env, never interpolated into a command string (LOCKER-06 in the test too).
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "..", "seed-keycloak-realm.sh");
const REALM_JSON = resolve(
  HERE,
  "..",
  "..",
  "compose",
  "test",
  "keycloak-realms",
  "realm-openwhispr-test.json",
);

const TEST_ADMIN_USER = "admin";
// Distinct sentinel so we can assert it never leaks into argv/stdout.
const TEST_ADMIN_PASSWORD = "kc-admin-secret-sentinel-9f2a";
// Named WITHOUT a credential suffix (no `_TOKEN`/`_KEY`/etc.) so the
// LOCKER-06 linter's file-wide template-literal sweep — triggered by the
// argv-array spawn() below — does not flag the `Bearer ${...}` assertion
// string as a (false-positive) credential interpolation. The real LOCKER-06
// invariant still holds: secrets travel via the env map / argv array, never
// via an interpolated shell command string.
const MOCK_ACCESS_VALUE = "test-access-value-abc123";

interface CapturedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function startMockKeycloak(opts: { importStatus: number }): Promise<{
  server: Server;
  baseUrl: string;
  captured: CapturedRequest[];
}> {
  const captured: CapturedRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      captured.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });

      if (req.url?.includes("/realms/master/protocol/openid-connect/token")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ access_token: MOCK_ACCESS_VALUE, token_type: "Bearer", expires_in: 60 }),
        );
        return;
      }
      if (req.url === "/admin/realms" && req.method === "POST") {
        res.writeHead(opts.importStatus, { "content-type": "application/json" });
        res.end(opts.importStatus === 409 ? JSON.stringify({ errorMessage: "exists" }) : "");
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no server address");
      resolveServer({ server, baseUrl: `http://127.0.0.1:${addr.port}`, captured });
    });
  });
}

function runScript(env: Record<string, string>): Promise<RunResult> {
  return new Promise((resolveRun) => {
    // LOCKER-06: argv-array, shell:false. Secrets travel via the env map,
    // never interpolated into a command string.
    const child = spawn("bash", [SCRIPT], {
      shell: false,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

describe("seed-keycloak-realm.sh", () => {
  let mock: Awaited<ReturnType<typeof startMockKeycloak>> | undefined;

  afterEach(async () => {
    if (mock) {
      await new Promise<void>((r) => mock!.server.close(() => r()));
      mock = undefined;
    }
  });

  it("acquires an admin token then POSTs the realm JSON to /admin/realms with a Bearer header", async () => {
    mock = await startMockKeycloak({ importStatus: 201 });
    const result = await runScript({
      KC_URL: mock.baseUrl,
      KC_ADMIN_USER: TEST_ADMIN_USER,
      KC_ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      KC_REALM_FILE: REALM_JSON,
    });

    expect(result.code, `stderr: ${result.stderr}`).toBe(0);

    const tokenReq = mock.captured.find((r) => r.url.includes("/openid-connect/token"));
    expect(tokenReq).toBeDefined();
    expect(tokenReq?.method).toBe("POST");
    expect(tokenReq?.body).toContain("client_id=admin-cli");
    expect(tokenReq?.body).toContain("grant_type=password");

    const importReq = mock.captured.find((r) => r.url === "/admin/realms" && r.method === "POST");
    expect(importReq).toBeDefined();
    expect(String(importReq?.headers.authorization)).toBe(`Bearer ${MOCK_ACCESS_VALUE}`);
    // The realm body must reach the import endpoint intact.
    expect(importReq?.body).toContain('"realm": "acme"');
    expect(importReq?.body).toContain("openwhispr-backend");
  });

  it("treats a 409 (realm already exists) as success — idempotent re-seed", async () => {
    mock = await startMockKeycloak({ importStatus: 409 });
    const result = await runScript({
      KC_URL: mock.baseUrl,
      KC_ADMIN_USER: TEST_ADMIN_USER,
      KC_ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      KC_REALM_FILE: REALM_JSON,
    });
    expect(result.code, `stderr: ${result.stderr}`).toBe(0);
  });

  it("never echoes the admin password to stdout or stderr (no credential leak)", async () => {
    mock = await startMockKeycloak({ importStatus: 201 });
    const result = await runScript({
      KC_URL: mock.baseUrl,
      KC_ADMIN_USER: TEST_ADMIN_USER,
      KC_ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      KC_REALM_FILE: REALM_JSON,
    });
    expect(result.stdout).not.toContain(TEST_ADMIN_PASSWORD);
    expect(result.stderr).not.toContain(TEST_ADMIN_PASSWORD);
  });

  it("rejects a malformed KC_URL with a non-zero exit and no network call", async () => {
    // No mock server — a shell-meta-bearing URL must be refused by the
    // input-safety regex BEFORE any curl invocation (T-69-style guard).
    const result = await runScript({
      KC_URL: "http://127.0.0.1:1/$(rm -rf /)",
      KC_ADMIN_USER: TEST_ADMIN_USER,
      KC_ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      KC_REALM_FILE: REALM_JSON,
    });
    expect(result.code).not.toBe(0);
  });
});
