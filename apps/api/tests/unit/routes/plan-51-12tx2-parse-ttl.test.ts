// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-12tx2 — REVIEW api-routes-transcriptions HI-6.
// `parseTtlSeconds` shared helper hardens token TTL parsing across
// `tokens/assemblyai.ts` + `tokens/deepgram.ts`. Pre-fix the routes did
// `Number(process.env.X_TTL ?? DEFAULT)` which silently produced NaN
// for non-numeric values; NaN flowed downstream into upstream URLs +
// JSON bodies producing misleading "not configured" 503s.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parseTtlSeconds } from "../../../src/routes/tokens/_parse-ttl.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ASSEMBLYAI = resolve(TEST_DIR, "../../../src/routes/tokens/assemblyai.ts");
const DEEPGRAM = resolve(TEST_DIR, "../../../src/routes/tokens/deepgram.ts");

function makeLog() {
  return { warn: vi.fn() };
}

describe("Plan 51-12tx2 — parseTtlSeconds (HI-6)", () => {
  it("returns default when env value is undefined", () => {
    const log = makeLog();
    expect(parseTtlSeconds(undefined, 60, "X", log)).toBe(60);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("returns default when env value is empty string", () => {
    const log = makeLog();
    expect(parseTtlSeconds("", 60, "X", log)).toBe(60);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("returns parsed integer for a valid value in range", () => {
    const log = makeLog();
    expect(parseTtlSeconds("120", 60, "X", log)).toBe(120);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("falls back to default + warns on non-numeric env (the HI-6 NaN case)", () => {
    const log = makeLog();
    expect(parseTtlSeconds("abc", 60, "ASSEMBLYAI_TOKEN_TTL", log)).toBe(60);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn.mock.calls[0]?.[0]).toMatchObject({
      env_var: "ASSEMBLYAI_TOKEN_TTL",
      raw: "abc",
      fallback: 60,
    });
  });

  it("falls back on zero / negative / non-integer / out-of-range", () => {
    const log = makeLog();
    expect(parseTtlSeconds("0", 60, "X", log)).toBe(60);
    expect(parseTtlSeconds("-1", 60, "X", log)).toBe(60);
    expect(parseTtlSeconds("60.5", 60, "X", log)).toBe(60);
    expect(parseTtlSeconds("99999", 60, "X", log, 3600)).toBe(60);
    expect(log.warn).toHaveBeenCalledTimes(4);
  });
});

describe("Plan 51-12tx2 — routes call parseTtlSeconds (HI-6)", () => {
  it("assemblyai.ts no longer uses bare Number(process.env.ASSEMBLYAI_TOKEN_TTL)", () => {
    const src = readFileSync(ASSEMBLYAI, "utf8");
    expect(src).toMatch(/parseTtlSeconds\([^)]*ASSEMBLYAI_TOKEN_TTL/s);
    expect(src).not.toMatch(/Number\(\s*process\.env\.ASSEMBLYAI_TOKEN_TTL/);
  });

  it("deepgram.ts no longer uses bare Number(process.env.DEEPGRAM_TOKEN_TTL)", () => {
    const src = readFileSync(DEEPGRAM, "utf8");
    expect(src).toMatch(/parseTtlSeconds\([^)]*DEEPGRAM_TOKEN_TTL/s);
    expect(src).not.toMatch(/Number\(\s*process\.env\.DEEPGRAM_TOKEN_TTL/);
  });
});
