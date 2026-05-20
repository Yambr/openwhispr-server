// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 68 / Plan 68-01 — REVIEW web HIGH HI-06.
//
// `internal-api.ts` carried a hardcoded `DEFAULT_INTERNAL_API_URL =
// "http://api:3000"`. The `:3000` port literal is on the LOCKER-03
// blocklist (`:3000|:4000|:8080`) and `apps/web/src/lib/` is not an
// allowlisted directory — so the literal only survived via a transitional
// `tools/lint-no-hardcode.allowlist.txt` entry.
//
// HI-06 removes the literal: `internalApiUrl()` is now fail-closed — it
// throws a clear error when `INTERNAL_API_URL` is unset/empty. Both
// supported deploy paths (docker-compose + the Helm chart) always set the
// var, so a fail-closed default has no cost. The allowlist entries for
// `internal-api.ts` are removed; `pnpm lint:lockers` passes without them.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { internalApiUrl } from "@/lib/internal-api";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(TEST_DIR, "../../../../src/lib/internal-api.ts");

describe("HI-06 — internal-api.ts has no hardcoded :3000 port", () => {
  it("HI-06: source contains no `:3000` literal", () => {
    const src = readFileSync(SRC, "utf8");
    expect(src.includes(":3000")).toBe(false);
  });

  describe("HI-06 — internalApiUrl() runtime contract", () => {
    const original = process.env.INTERNAL_API_URL;
    beforeEach(() => {
      delete process.env.INTERNAL_API_URL;
    });
    afterEach(() => {
      if (original === undefined) delete process.env.INTERNAL_API_URL;
      else process.env.INTERNAL_API_URL = original;
    });

    it("HI-06: returns the env value when INTERNAL_API_URL is set", () => {
      process.env.INTERNAL_API_URL = "http://api.internal";
      expect(internalApiUrl()).toBe("http://api.internal");
    });

    it("HI-06: throws (fail-closed) when INTERNAL_API_URL is unset", () => {
      expect(() => internalApiUrl()).toThrow(/INTERNAL_API_URL/);
    });

    it("HI-06: throws (fail-closed) when INTERNAL_API_URL is empty", () => {
      process.env.INTERNAL_API_URL = "";
      expect(() => internalApiUrl()).toThrow(/INTERNAL_API_URL/);
    });
  });
});
