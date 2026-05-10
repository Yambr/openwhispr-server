/**
 * Phase 03 / Plan 01 / Task 1 — TDD test for tools/lint-docs-headings.ts
 * AND for the document docs/wire-contracts-phase-3.md (D-09).
 *
 * Source-of-record: this is the RED test of TDD pair { lint-docs-headings.ts,
 * wire-contracts-phase-3.md }. It runs the lint tool against the live document
 * and against synthetic broken inputs to assert:
 *   1. Live wire-contracts-phase-3.md passes (exit 0).
 *   2. Tool exits 1 on missing H2 section.
 *   3. Tool exits 1 on H2 section without a fenced code block.
 *   4. Tool exits 1 on a doc lacking BACKEND_SPEC.md:L<n> citations.
 *   5. Tool exits 1 on a doc lacking the wordsUsed / diarization-mount decisions.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const TOOL = join(process.cwd(), "tools", "lint-docs-headings.ts");
const LIVE_DOC = join(process.cwd(), "docs", "wire-contracts-phase-3.md");
const TSX = join(process.cwd(), "node_modules", ".bin", "tsx");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): RunResult {
  try {
    const stdout = execFileSync(TSX, [TOOL, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

describe("lint-docs-headings — live wire-contracts-phase-3.md", () => {
  it("passes lint (all 4 H2 sections + fenced quotes + BACKEND_SPEC citations + decisions)", () => {
    const result = run([LIVE_DOC]);
    if (result.code !== 0) {
      // Fail loudly with full diagnostic — the doc is the contract.
      throw new Error(`lint-docs-headings rejected ${LIVE_DOC} (exit ${result.code}):\n${result.stderr}`);
    }
    expect(result.code).toBe(0);
  });
});

describe("lint-docs-headings — failure modes", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "lint-docs-headings-"));
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  function writeDoc(content: string): string {
    const path = join(scratch, "doc.md");
    writeFileSync(path, content);
    return path;
  }

  it("exits 1 when an H2 section is missing", () => {
    const path = writeDoc(`# Title

## POST /api/transcribe

\`\`\`json
{}
\`\`\`

BACKEND_SPEC.md:L161

## POST /api/reason

\`\`\`json
{}
\`\`\`

## Diarization

\`\`\`text
quote
\`\`\`

Decision: wordsUsed semantics — minutes-of-audio.
Decision: diarization mount — /v1/audio/diarization.
`);
    // Missing WSS /v1/realtime
    const result = run([path]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/WSS \/v1\/realtime/);
  });

  it("exits 1 when an H2 section has no fenced code block", () => {
    const path = writeDoc(`# Title

## POST /api/transcribe

(prose only, no fence)

## POST /api/reason

\`\`\`json
{}
\`\`\`

## Diarization

\`\`\`text
quote
\`\`\`

## WSS /v1/realtime

\`\`\`text
quote
\`\`\`

BACKEND_SPEC.md:L161
Decision: wordsUsed semantics — x.
Decision: diarization mount — y.
`);
    const result = run([path]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/no-fenced-quote/);
    expect(result.stderr).toMatch(/POST \/api\/transcribe/);
  });

  it("exits 1 when no BACKEND_SPEC.md:L citation appears", () => {
    const path = writeDoc(`# Title

## POST /api/transcribe

\`\`\`json
{}
\`\`\`

## POST /api/reason

\`\`\`json
{}
\`\`\`

## Diarization

\`\`\`text
quote
\`\`\`

## WSS /v1/realtime

\`\`\`text
quote
\`\`\`

Decision: wordsUsed semantics — x.
Decision: diarization mount — y.
`);
    const result = run([path]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/no-source-citation/);
  });

  it("exits 1 when the wordsUsed or diarization-mount decision is missing", () => {
    const path = writeDoc(`# Title

## POST /api/transcribe

\`\`\`json
{}
\`\`\`

## POST /api/reason

\`\`\`json
{}
\`\`\`

## Diarization

\`\`\`text
quote
\`\`\`

## WSS /v1/realtime

\`\`\`text
quote
\`\`\`

BACKEND_SPEC.md:L161
`);
    const result = run([path]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/missing-decision/);
  });
});
