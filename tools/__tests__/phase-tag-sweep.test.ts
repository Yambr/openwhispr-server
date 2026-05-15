// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * phase-tag-sweep.test.ts — RED→GREEN coverage for the phase-tag comment
 * codemod (Phase 16 / Plan 01 — COMMENT-01 + COMMENT-02).
 *
 * The codemod classifies each `//` line in `.ts`/`.tsx` files under
 * `apps/` + `packages/` into a REMOVE or KEEP bucket per CONTEXT Q2:
 *   - REMOVE rule 1: bare `// Phase NN[.M] [/ Plan NN-MM]` header with no prose.
 *   - REMOVE rule 2: trailing-only `// D-NN[...]` with no body text.
 *   - REMOVE rule 3: history close-out `// D-NN.M-EXk close-out: …`.
 *   - REMOVE rule 4: standalone `// Phase NN — implementation note`.
 *   - KEEP rule 1: multi-line `//` context (prev or next line is also `//`).
 *   - KEEP rule 2: contains keyword (because/to avoid/workaround/fixes/NEVER/MUST/prevent).
 *   - KEEP rule 3: references `PITFALLS §` or `SUMMARY.md`.
 *   - KEEP rule 4: inline `// D-NN — <body>` with non-empty body after em-dash.
 *   - KEEP default: ambiguous → KEEP, never auto-REMOVE.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auditDir, classifyLine, fixDir, main } from "../phase-tag-sweep.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "phase-tag-sweep-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function touch(rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

describe("classifyLine — REMOVE bucket (CONTEXT Q2)", () => {
  it("R1: classifies bare `// Phase 14` header as REMOVE", () => {
    expect(classifyLine("// Phase 14", {})).toBe("REMOVE");
  });

  it("R2: classifies `// Phase 14 / Plan 04-02 —` bare header as REMOVE", () => {
    expect(classifyLine("// Phase 14 / Plan 04-02 —", {})).toBe("REMOVE");
  });

  it("R3: classifies trailing bare `// D-19` as REMOVE", () => {
    expect(classifyLine("  // D-19", {})).toBe("REMOVE");
  });

  it("R3b: classifies trailing bare `// D-12.3-EX1` as REMOVE", () => {
    expect(classifyLine("// D-12.3-EX1", {})).toBe("REMOVE");
  });

  it("R4: classifies `// D-12.3-EX1 close-out: removed legacy adapter` as REMOVE", () => {
    expect(classifyLine("// D-12.3-EX1 close-out: removed legacy adapter", {})).toBe("REMOVE");
  });

  it("R5: classifies `// Phase 7 — implementation note` as REMOVE", () => {
    expect(classifyLine("// Phase 7 — implementation note", {})).toBe("REMOVE");
  });

  // WR-01 regression: close-out REMOVE rule must preempt the KEEP-keyword scan
  // because CONTEXT Q2 classifies any `// D-NN.M-EXk close-out: ...` line as
  // REMOVE (history narrative) regardless of body keywords. Without this
  // ordering, a real-world close-out body that contains a KEEP keyword like
  // `workaround` / `removed` / `fixed` would incorrectly stay KEEP.
  it("R6 (WR-01): `// D-12.3-EX1 close-out: removed workaround` is REMOVE despite KEEP keyword in body", () => {
    expect(classifyLine("// D-12.3-EX1 close-out: removed workaround.", {})).toBe("REMOVE");
  });
});

describe("classifyLine — KEEP bucket (CONTEXT Q2)", () => {
  it("K1: keeps `// Phase 12 / Plan 03 —` when next line is also `//`", () => {
    expect(
      classifyLine("// Phase 12 / Plan 03 —", {
        next: "// because the upstream emits stale timestamps",
      }),
    ).toBe("KEEP");
  });

  it("K2: keeps inline `// D-19 — availableProviders is COMPUTED FRESH per request to avoid stale cache`", () => {
    expect(
      classifyLine(
        "// D-19 — availableProviders is COMPUTED FRESH per request to avoid stale cache",
        {},
      ),
    ).toBe("KEEP");
  });

  it("K3: keeps comment referencing `PITFALLS §3`", () => {
    expect(
      classifyLine("// Phase 8 — workaround for LiteLLM multipart bug, see PITFALLS §3", {}),
    ).toBe("KEEP");
  });

  it("K4: keeps `// D-03: NEVER cache; refresh on every call` (NEVER keyword)", () => {
    expect(classifyLine("// D-03: NEVER cache; refresh on every call", {})).toBe("KEEP");
  });

  it("K5: keeps `// Phase 4 / Plan 02 — see SUMMARY.md for migration rationale`", () => {
    expect(classifyLine("// Phase 4 / Plan 02 — see SUMMARY.md for migration rationale", {})).toBe(
      "KEEP",
    );
  });

  it("default: keeps a comment that doesn't match any REMOVE rule", () => {
    expect(classifyLine("// just a normal comment about the algorithm", {})).toBe("KEEP");
  });

  it("default: keeps a non-comment line", () => {
    expect(classifyLine("const x = 1;", {})).toBe("KEEP");
  });

  // CR-01 regression: PLAN 16-01 sanctioned exactly 4 REMOVE rules; the
  // executor added an unauthorized 5th regex (REMOVE_RULE_1_HEADER_WITH_BODY)
  // that stripped 6+ comments carrying load-bearing WHY content. Under the
  // plan-sanctioned 4-rule classifier these lines all match the default
  // KEEP branch (single-line, no KEEP keyword, no marker, no multi-line
  // neighbour — but body carries non-obvious WHY content the reader can't
  // derive from surrounding code). These assertions fail under the widened
  // rule and pin the conservative-KEEP default that CONTEXT Q2 specified.
  describe("K6 (CR-01): plan-sanctioned 4-rule classifier KEEPs prose-bearing single-line phase headers", () => {
    it("keeps `// Phase 02.12 — hashToken removed; recordPreviousToken now takes plain text.`", () => {
      expect(
        classifyLine(
          "  // Phase 02.12 — hashToken removed; recordPreviousToken now takes plain text.",
          {},
        ),
      ).toBe("KEEP");
    });

    it("keeps `// Phase 02.12 — column is now \\`previous_token\\` (text), not \\`previous_token_hash\\`.`", () => {
      expect(
        classifyLine(
          "    // Phase 02.12 — column is now `previous_token` (text), not `previous_token_hash`.",
          {},
        ),
      ).toBe("KEEP");
    });

    it("keeps `// Phase 02.12 — bearer text is bound directly; no SHA-256 hashing.`", () => {
      expect(
        classifyLine("    // Phase 02.12 — bearer text is bound directly; no SHA-256 hashing.", {}),
      ).toBe("KEEP");
    });

    it("keeps `// Phase 02.12 — bytea token_hash dropped; sessions.token is plain text.`", () => {
      expect(
        classifyLine(
          "    // Phase 02.12 — bytea token_hash dropped; sessions.token is plain text.",
          {},
        ),
      ).toBe("KEEP");
    });

    it("keeps `// Phase 02.12 — function signature is now (text), not (bytea).`", () => {
      expect(
        classifyLine("      // Phase 02.12 — function signature is now (text), not (bytea).", {}),
      ).toBe("KEEP");
    });

    it("keeps `// Phase 6 / Plan 02 — migration 0014 requires pg_partman.` (non-obvious image choice rationale)", () => {
      expect(
        classifyLine("    // Phase 6 / Plan 02 — migration 0014 requires pg_partman.", {}),
      ).toBe("KEEP");
    });

    it("keeps `// Phase 6 / Plan 02 — provision pg_partman + GRANT chain.`", () => {
      expect(classifyLine("  // Phase 6 / Plan 02 — provision pg_partman + GRANT chain.", {})).toBe(
        "KEEP",
      );
    });

    it("keeps `// Phase 03 / Plan 10 — PROVIDER-01 introspection seam.`", () => {
      expect(classifyLine("  // Phase 03 / Plan 10 — PROVIDER-01 introspection seam.", {})).toBe(
        "KEEP",
      );
    });

    it("keeps `// Phase 5 / Plan 01 — settings + CRUD resource families`", () => {
      expect(classifyLine("  // Phase 5 / Plan 01 — settings + CRUD resource families", {})).toBe(
        "KEEP",
      );
    });

    it("keeps `// Phase 15 / Plan 02 (STRUCT-01) — tests live under tests/unit/ post-move.`", () => {
      expect(
        classifyLine(
          "    // Phase 15 / Plan 02 (STRUCT-01) — tests live under tests/unit/ post-move.",
          {},
        ),
      ).toBe("KEEP");
    });
  });
});

describe("auditDir + fixDir — codemod shape (S1-S3)", () => {
  it("S1: auditDir returns the REMOVE-violation list (paths + line numbers); KEEP lines absent", async () => {
    // Note: trailing `// D-NN` suffixes on code lines are KEPT (deviation
    // Rule 1 vs original plan fixture which would have erased production
    // code under the whole-line filter — see SUMMARY). Bare comment-only
    // `// D-NN` lines surrounded by code ARE classified REMOVE per CONTEXT
    // Q2 rule 2; bare headers adjacent to other `//` lines are KEPT by
    // KEEP rule 1 (multi-line context, conservative default).
    touch(
      "apps/api/src/a.ts",
      [
        "// Phase 14",
        "export const x = 1;",
        "// D-19",
        "export const z = 3;",
        "// D-19 — availableProviders is COMPUTED FRESH to avoid stale cache",
        "export const y = 2;",
      ].join("\n"),
    );
    const violations = await auditDir(root);
    const rels = violations.map((v) => `${v.file}:${v.lineNumber}`).sort();
    expect(rels).toEqual(["apps/api/src/a.ts:1", "apps/api/src/a.ts:3"]);
  });

  it("S2: fixDir deletes exactly the REMOVE lines and leaves KEEP + code intact", async () => {
    touch(
      "apps/api/src/b.ts",
      [
        "// Phase 14",
        "export const x = 1;",
        "// D-19 — explains WHY in detail because of upstream bug",
        "export const y = 2;",
      ].join("\n"),
    );
    const result = await fixDir(root);
    expect(result.filesChanged).toBe(1);
    expect(result.commentsRemoved).toBe(1);
    const after = readFileSync(join(root, "apps/api/src/b.ts"), "utf8");
    expect(after).toBe(
      [
        "export const x = 1;",
        "// D-19 — explains WHY in detail because of upstream bug",
        "export const y = 2;",
      ].join("\n"),
    );
  });

  it("S3: fixDir is idempotent — second run produces zero diff", async () => {
    touch("packages/data/src/c.ts", ["// Phase 12 / Plan 03 —", "export const z = 3;"].join("\n"));
    await fixDir(root);
    const second = await fixDir(root);
    expect(second.filesChanged).toBe(0);
    expect(second.commentsRemoved).toBe(0);
  });

  it("scopes to apps/ + packages/ only — tools/ and tests/ are skipped", async () => {
    touch("tools/foo.ts", "// Phase 14\nexport const t = 1;\n");
    touch("tests/e2e/bar.ts", "// Phase 14\nexport const e = 1;\n");
    const violations = await auditDir(root);
    expect(violations).toEqual([]);
  });
});

describe("main — CLI verb dispatch (S4 + exit codes)", () => {
  it("S4a: main(['audit', root]) returns 1 when REMOVE candidates exist", async () => {
    touch("apps/api/src/d.ts", "// Phase 14\nexport const v = 1;\n");
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main(["audit", root]);
    errSpy.mockRestore();
    expect(code).toBe(1);
  });

  it("S4b: main(['audit', root]) returns 0 on clean tree", async () => {
    touch("apps/api/src/e.ts", "export const v = 1;\n");
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await main(["audit", root]);
    outSpy.mockRestore();
    expect(code).toBe(0);
  });

  it("S4c: main(['fix', root]) prints `N comment(s) removed` and returns 0", async () => {
    touch("apps/api/src/f.ts", "// Phase 14\nexport const v = 1;\n");
    const captured: string[] = [];
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      captured.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    });
    const code = await main(["fix", root]);
    outSpy.mockRestore();
    expect(code).toBe(0);
    expect(captured.join("")).toMatch(/comment\(s\) removed/);
  });

  it("S4d: main(['bogus']) returns 2", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main(["bogus"]);
    errSpy.mockRestore();
    expect(code).toBe(2);
  });

  it("S4e: main([]) (no verb) returns 2", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main([]);
    errSpy.mockRestore();
    expect(code).toBe(2);
  });

  it("S4f: main(['audit']) defaults rootDir to process.cwd()", async () => {
    // Smoke — just confirms the default branch is exercised; the real cwd is
    // the repo root, which has REMOVE candidates (baseline > 0). Either exit
    // code is acceptable here; what matters is it does not throw.
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main(["audit"]);
    outSpy.mockRestore();
    errSpy.mockRestore();
    expect([0, 1]).toContain(code);
  });
});

describe("edge cases — empty files + mixed content", () => {
  it("handles a file with zero comments without error", async () => {
    touch("apps/api/src/empty.ts", "export const x = 1;\n");
    const violations = await auditDir(root);
    expect(violations).toEqual([]);
  });

  it("handles a fully-empty file without error", async () => {
    touch("apps/api/src/blank.ts", "");
    const violations = await auditDir(root);
    expect(violations).toEqual([]);
  });

  it("preserves trailing newline at EOF after a REMOVE deletion at start", async () => {
    touch("apps/api/src/eol.ts", "// Phase 14\nexport const z = 1;\n");
    await fixDir(root);
    const after = readFileSync(join(root, "apps/api/src/eol.ts"), "utf8");
    expect(after).toBe("export const z = 1;\n");
  });
});
