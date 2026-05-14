// SPDX-License-Identifier: Apache-2.0
// Phase 14 / Plan 04 / Task 3 — Boot-order discipline test.
//
// Asserts the literal import + call order at the top of apps/api/src/index.ts
// AND apps/worker/src/index.ts:
//
//   1. `import { assertBYOKConfig } from "@openwhispr/byok-guard";`
//      MUST appear BEFORE `import "./otel-bootstrap.js";` and BEFORE
//      `import { installGlobalSSRF } from "./bootstrap.js";`.
//   2. `assertBYOKConfig();` MUST be called BEFORE
//      `installGlobalSSRF();`.
//
// Rationale (CONTEXT.md decision 2 + RESEARCH §F):
//   * The guard must fire BEFORE OTel SDK side-effects so a misconfigured
//     OTLP endpoint does not produce cascading retry noise on stderr
//     before the fatal record reaches operators.
//   * The guard must also fire BEFORE installGlobalSSRF() so we do not
//     waste cycles installing the global undici dispatcher on a process
//     that is about to exit 1 — and so the fatal log line is not
//     interleaved with SSRF init diagnostics.
//
// Test mechanism: source-text indexOf assertions. We deliberately use
// the literal source rather than dynamic imports because (a) we are
// asserting LEXICAL order (the order in which statements appear in the
// file), not runtime order, and (b) dynamic-importing apps/api/src/index.ts
// would actually start the API, which is not what this test needs.
//
// The boot-order test additionally checks that apps/api/package.json and
// apps/worker/package.json both declare `"@openwhispr/byok-guard":
// "workspace:*"` under `dependencies` (no cross-app relative imports —
// per CONTEXT.md / PATTERNS.md the workspace package boundary is hard).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_INDEX = path.join(REPO_ROOT, "apps/api/src/index.ts");
const WORKER_INDEX = path.join(REPO_ROOT, "apps/worker/src/index.ts");
const API_PKG = path.join(REPO_ROOT, "apps/api/package.json");
const WORKER_PKG = path.join(REPO_ROOT, "apps/worker/package.json");

const IMPORT_LINE =
  /^import\s+\{\s*assertBYOKConfig\s*\}\s+from\s+["']@openwhispr\/byok-guard["']\s*;?\s*$/m;
// Anchored to start-of-line so comments mentioning the symbol do not
// match. (Multi-line flag so `^` means start-of-line.)
const CALL_LINE = /^assertBYOKConfig\(\)\s*;?\s*$/m;
const OTEL_IMPORT_LINE = /^import\s+["']\.\/otel-bootstrap\.js["']\s*;?\s*$/m;
const SSRF_IMPORT_LINE =
  /^import\s+\{\s*installGlobalSSRF\s*\}\s+from\s+["']\.\/bootstrap\.js["']\s*;?\s*$/m;
const SSRF_CALL_LINE = /^installGlobalSSRF\(\)\s*;?\s*$/m;

describe("boot-order (Phase 14 / Plan 04 / Task 3)", () => {
  describe("apps/api/src/index.ts", () => {
    const src = fs.readFileSync(API_INDEX, "utf8");

    it("imports @openwhispr/byok-guard BEFORE ./otel-bootstrap.js", () => {
      const guardIdx = src.search(IMPORT_LINE);
      const otelIdx = src.search(OTEL_IMPORT_LINE);
      expect(guardIdx).toBeGreaterThan(-1);
      expect(otelIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeLessThan(otelIdx);
    });

    it("imports @openwhispr/byok-guard BEFORE installGlobalSSRF import", () => {
      const guardIdx = src.search(IMPORT_LINE);
      const ssrfIdx = src.search(SSRF_IMPORT_LINE);
      expect(guardIdx).toBeGreaterThan(-1);
      expect(ssrfIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeLessThan(ssrfIdx);
    });

    it("calls assertBYOKConfig() BEFORE installGlobalSSRF()", () => {
      const guardCallIdx = src.search(CALL_LINE);
      const ssrfCallIdx = src.search(SSRF_CALL_LINE);
      expect(guardCallIdx).toBeGreaterThan(-1);
      expect(ssrfCallIdx).toBeGreaterThan(-1);
      expect(guardCallIdx).toBeLessThan(ssrfCallIdx);
    });
  });

  describe("apps/worker/src/index.ts", () => {
    const src = fs.readFileSync(WORKER_INDEX, "utf8");

    it("imports @openwhispr/byok-guard BEFORE ./otel-bootstrap.js", () => {
      const guardIdx = src.search(IMPORT_LINE);
      const otelIdx = src.search(OTEL_IMPORT_LINE);
      expect(guardIdx).toBeGreaterThan(-1);
      expect(otelIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeLessThan(otelIdx);
    });

    it("calls assertBYOKConfig() at module top-level", () => {
      expect(src).toMatch(CALL_LINE);
    });
  });

  describe("workspace dependency wiring", () => {
    it("apps/api/package.json declares @openwhispr/byok-guard: workspace:*", () => {
      const pkg = JSON.parse(fs.readFileSync(API_PKG, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      expect(pkg.dependencies?.["@openwhispr/byok-guard"]).toBe("workspace:*");
    });

    it("apps/worker/package.json declares @openwhispr/byok-guard: workspace:*", () => {
      const pkg = JSON.parse(fs.readFileSync(WORKER_PKG, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      expect(pkg.dependencies?.["@openwhispr/byok-guard"]).toBe("workspace:*");
    });
  });
});
