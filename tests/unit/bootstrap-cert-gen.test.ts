/**
 * Phase 02.7 / D-05 — bootstrap.sh openssl SAN cert generation block.
 *
 * Source-of-record commit: <filled at commit time>
 *
 * Reverts: this test goes RED if the openssl SAN cert-gen block is removed
 *   from tools/bootstrap.sh (the Phase 02.6 state where compose/traefik/dynamic.yml
 *   documents /certs/local.{crt,key} but bootstrap.sh has ZERO openssl logic).
 *   The CONTRACT-bootstrap-fails-to-honor defect was the root cause for Phase 02.6
 *   reaching for NODE_TLS_REJECT_UNAUTHORIZED=0; this test pins that closed.
 *
 * Pattern reference: tests/unit/bootstrap-interpolate.test.ts (Phase 02.4 G1) —
 *   execFileSync('bash', [SCRIPT]) inside mkdtemp + BOOTSTRAP_REPO_ROOT.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "tools", "bootstrap.sh");
const FIXTURE = join(process.cwd(), "tests", "fixtures", "bootstrap-env-template.txt");
const REAL_DENY_LIST = join(process.cwd(), "tools", "bootstrap", "default-secrets.txt");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function setupRoot(): { root: string; certPath: string; keyPath: string } {
  const root = mkdtempSync(join(tmpdir(), "bootstrap-cert-gen-test-"));
  mkdirSync(join(root, "tools", "bootstrap"), { recursive: true });
  mkdirSync(join(root, "compose", "traefik", "certs"), { recursive: true });
  copyFileSync(FIXTURE, join(root, ".env.example"));
  copyFileSync(REAL_DENY_LIST, join(root, "tools", "bootstrap", "default-secrets.txt"));
  return {
    root,
    certPath: join(root, "compose", "traefik", "certs", "local.crt"),
    keyPath: join(root, "compose", "traefik", "certs", "local.key"),
  };
}

function runBootstrap(root: string): RunResult {
  try {
    const stdout = execFileSync("bash", [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, BOOTSTRAP_REPO_ROOT: root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

function readCertText(certPath: string): string {
  return execFileSync("openssl", ["x509", "-in", certPath, "-noout", "-text"], {
    encoding: "utf8",
  });
}

const REQUIRED_DNS_SANS = [
  "localhost",
  "*.localhost",
  "api.localhost",
  "auth.localhost",
  "grafana.localhost",
  "minio-console.localhost",
  "mailpit.localhost",
  "api.example.test",
  "auth.example.test",
  "*.example.test",
];

describe("Phase 02.7 D-05 — bootstrap.sh openssl SAN cert generation", () => {
  it("first run generates compose/traefik/certs/local.{crt,key} with all required SANs", () => {
    const { root, certPath, keyPath } = setupRoot();
    try {
      const r = runBootstrap(root);
      expect(r.code, `bootstrap exit nonzero. stderr=${r.stderr}`).toBe(0);
      // Files must exist.
      expect(() => statSync(certPath)).not.toThrow();
      expect(() => statSync(keyPath)).not.toThrow();

      const text = readCertText(certPath);
      // DNS SANs.
      for (const san of REQUIRED_DNS_SANS) {
        expect(text, `missing DNS SAN: ${san}`).toContain(`DNS:${san}`);
      }
      // IP SANs — openssl prints ::1 expanded in some builds, accept either form.
      expect(text).toContain("IP Address:127.0.0.1");
      const hasIpv6 =
        text.includes("IP Address:0:0:0:0:0:0:0:1") || text.includes("IP Address:::1");
      expect(hasIpv6, "missing IPv6 ::1 SAN").toBe(true);

      // Validity ≥ 365 days from now.
      execFileSync("openssl", [
        "x509",
        "-in",
        certPath,
        "-noout",
        "-checkend",
        String(86400 * 365),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is idempotent — second run preserves cert mtime when validity > 30 days", () => {
    const { root, certPath } = setupRoot();
    try {
      runBootstrap(root);
      const firstMtimeMs = statSync(certPath).mtimeMs;
      // Sleep enough for mtime to differ if regenerated (filesystem mtime resolution ≥ 1s on macOS HFS+).
      execFileSync("sleep", ["1.1"]);
      const r2 = runBootstrap(root);
      expect(r2.code).toBe(0);
      const secondMtimeMs = statSync(certPath).mtimeMs;
      expect(secondMtimeMs).toBe(firstMtimeMs);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("regenerates when existing cert expires within 30 days", () => {
    const { root, certPath, keyPath } = setupRoot();
    try {
      // Place a near-expiry self-signed cert (10-day validity, < 30-day threshold).
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-nodes",
          "-days",
          "10",
          "-newkey",
          "rsa:2048",
          "-keyout",
          keyPath,
          "-out",
          certPath,
          "-subj",
          "/CN=expiring",
        ],
        { stdio: ["ignore", "ignore", "ignore"] },
      );
      const beforeMtimeMs = statSync(certPath).mtimeMs;
      execFileSync("sleep", ["1.1"]);

      const r = runBootstrap(root);
      expect(r.code).toBe(0);
      const afterMtimeMs = statSync(certPath).mtimeMs;
      expect(afterMtimeMs).toBeGreaterThan(beforeMtimeMs);

      // New cert must be valid for ≥ 365 days.
      execFileSync("openssl", [
        "x509",
        "-in",
        certPath,
        "-noout",
        "-checkend",
        String(86400 * 365),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("private key is mode 600 (owner read/write only)", () => {
    const { root, keyPath } = setupRoot();
    try {
      runBootstrap(root);
      const st = statSync(keyPath);
      // Mask off file-type bits, keep permission bits.
      const perms = st.mode & 0o777;
      expect(perms).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
