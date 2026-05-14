// SPDX-License-Identifier: Apache-2.0
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
import { X509Certificate } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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

interface BootstrapPaths {
  root: string;
  certPath: string;
  keyPath: string;
  rootCaPath: string;
  rootCaKeyPath: string;
}

function setupRoot(): BootstrapPaths {
  const root = mkdtempSync(join(tmpdir(), "bootstrap-cert-gen-test-"));
  mkdirSync(join(root, "tools", "bootstrap"), { recursive: true });
  mkdirSync(join(root, "compose", "traefik", "certs"), { recursive: true });
  copyFileSync(FIXTURE, join(root, ".env.example"));
  copyFileSync(REAL_DENY_LIST, join(root, "tools", "bootstrap", "default-secrets.txt"));
  return {
    root,
    certPath: join(root, "compose", "traefik", "certs", "local.crt"),
    keyPath: join(root, "compose", "traefik", "certs", "local.key"),
    rootCaPath: join(root, "compose", "traefik", "certs", "root-ca.crt"),
    rootCaKeyPath: join(root, "compose", "traefik", "certs", "root-ca.key"),
  };
}

function runBootstrap(root: string): RunResult {
  try {
    const stdout = execFileSync("bash", [SCRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        BOOTSTRAP_REPO_ROOT: root,
        // Phase 14 / Plan 02 — bootstrap.sh defaults to .env.slim.example;
        // this fixture writes .env.example. Pin the template explicitly.
        BOOTSTRAP_ENV_TEMPLATE: join(root, ".env.example"),
      },
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

// Phase 02.22 — Two-tier CA chain so Node 24 + OpenSSL 3 accept the cert
// supplied via NODE_EXTRA_CA_CERTS as a trust anchor. A self-signed leaf
// (basicConstraints=CA:FALSE) is rejected by Node's X509 trust evaluator
// (X509Certificate.ca === false) → DEPTH_ZERO_SELF_SIGNED_CERT inside the
// contract-test-runner. The fix: bootstrap generates a self-signed root CA
// (CA:TRUE, keyCertSign) and signs the leaf with it. Node trusts the root,
// the leaf chains up to it, TLS handshake succeeds.
describe("Phase 02.22 — bootstrap.sh two-tier CA chain (Node NODE_EXTRA_CA_CERTS compat)", () => {
  it("generates a self-signed root CA at compose/traefik/certs/root-ca.{crt,key}", () => {
    const { root, rootCaPath, rootCaKeyPath } = setupRoot();
    try {
      const r = runBootstrap(root);
      expect(r.code, `bootstrap exit nonzero. stderr=${r.stderr}`).toBe(0);
      expect(() => statSync(rootCaPath)).not.toThrow();
      expect(() => statSync(rootCaKeyPath)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("root CA is recognized as a CA by Node's X509Certificate (basicConstraints CA:TRUE)", () => {
    const { root, rootCaPath } = setupRoot();
    try {
      runBootstrap(root);
      const pem = readFileSync(rootCaPath, "utf8");
      const cert = new X509Certificate(pem);
      expect(cert.ca, "root CA must report .ca === true to Node").toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaf cert is NOT a CA (basicConstraints CA:FALSE)", () => {
    const { root, certPath } = setupRoot();
    try {
      runBootstrap(root);
      const pem = readFileSync(certPath, "utf8");
      const cert = new X509Certificate(pem);
      expect(cert.ca, "leaf cert must report .ca === false").toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaf cert is issued by the root CA (issuer == root subject, not self-signed)", () => {
    const { root, certPath, rootCaPath } = setupRoot();
    try {
      runBootstrap(root);
      const leaf = new X509Certificate(readFileSync(certPath, "utf8"));
      const rootCa = new X509Certificate(readFileSync(rootCaPath, "utf8"));
      expect(leaf.issuer).toBe(rootCa.subject);
      // Sanity: leaf must NOT be self-signed (subject != issuer).
      expect(leaf.subject).not.toBe(leaf.issuer);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("openssl verify -CAfile root-ca.crt local.crt succeeds (chain validates end-to-end)", () => {
    const { root, certPath, rootCaPath } = setupRoot();
    try {
      runBootstrap(root);
      // openssl verify exits 0 only when the full chain validates.
      const out = execFileSync("openssl", ["verify", "-CAfile", rootCaPath, certPath], {
        encoding: "utf8",
      });
      expect(out).toMatch(/OK\s*$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaf cert preserves all required SANs after the chain rewrite (no regression on Phase 02.7 SAN set)", () => {
    const { root, certPath } = setupRoot();
    try {
      runBootstrap(root);
      const text = readCertText(certPath);
      for (const san of REQUIRED_DNS_SANS) {
        expect(text, `missing DNS SAN after CA-chain rewrite: ${san}`).toContain(`DNS:${san}`);
      }
      expect(text).toContain("IP Address:127.0.0.1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("idempotent — second run preserves BOTH root-ca and leaf mtimes when validity > 30 days", () => {
    const { root, certPath, rootCaPath } = setupRoot();
    try {
      runBootstrap(root);
      const firstLeafMtime = statSync(certPath).mtimeMs;
      const firstRootMtime = statSync(rootCaPath).mtimeMs;
      execFileSync("sleep", ["1.1"]);
      const r2 = runBootstrap(root);
      expect(r2.code).toBe(0);
      expect(statSync(certPath).mtimeMs).toBe(firstLeafMtime);
      expect(statSync(rootCaPath).mtimeMs).toBe(firstRootMtime);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("regenerates BOTH root-ca and leaf when root-ca is missing (leaf alone is stale)", () => {
    const { root, certPath, rootCaPath } = setupRoot();
    try {
      runBootstrap(root);
      // Delete only the root CA — leaf is now orphaned. Bootstrap must regenerate the chain.
      rmSync(rootCaPath, { force: true });
      const beforeLeafMtime = statSync(certPath).mtimeMs;
      execFileSync("sleep", ["1.1"]);
      const r2 = runBootstrap(root);
      expect(r2.code).toBe(0);
      expect(() => statSync(rootCaPath)).not.toThrow();
      expect(statSync(certPath).mtimeMs).toBeGreaterThan(beforeLeafMtime);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("root CA private key is mode 600 (owner read/write only)", () => {
    const { root, rootCaKeyPath } = setupRoot();
    try {
      runBootstrap(root);
      const perms = statSync(rootCaKeyPath).mode & 0o777;
      expect(perms).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
