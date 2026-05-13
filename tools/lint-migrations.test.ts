// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  aggregate,
  BLOCKING_RULES,
  enumerateNewMigrations,
  main,
  parseArgs,
  runSquawkOnFile,
  type SquawkDiagnostic,
  type SquawkResult,
  scanForDropWarnings,
} from "./lint-migrations.js";

describe("BLOCKING_RULES", () => {
  it("contains the canonical online-migration rules", () => {
    expect(BLOCKING_RULES.has("ban-drop-column")).toBe(true);
    expect(BLOCKING_RULES.has("require-concurrent-index-creation")).toBe(true);
    expect(BLOCKING_RULES.has("adding-required-field")).toBe(true);
  });

  it("does NOT include noisy info-level rules", () => {
    expect(BLOCKING_RULES.has("require-timeout-settings")).toBe(false);
    expect(BLOCKING_RULES.has("prefer-robust-stmts")).toBe(false);
  });
});

describe("parseArgs", () => {
  it("returns empty exclude list when --exclude absent", () => {
    expect(parseArgs([]).exclude).toEqual([]);
  });

  it("parses --since flag", () => {
    expect(parseArgs(["--since", "origin/main"]).since).toBe("origin/main");
  });

  it("parses --exclude csv into array", () => {
    const r = parseArgs(["--exclude", "a,b ,c"]).exclude;
    expect(r).toEqual(["a", "b", "c"]);
  });

  it("collects files after -- separator", () => {
    const a = parseArgs(["--", "x.sql", "y.sql"]);
    expect(a.files).toEqual(["x.sql", "y.sql"]);
  });

  it("collects bare .sql args", () => {
    const a = parseArgs(["foo/bar.sql", "--since", "main"]);
    expect(a.files).toEqual(["foo/bar.sql"]);
    expect(a.since).toBe("main");
  });

  it("ignores empty exclude entries", () => {
    expect(parseArgs(["--exclude", "a,,b"]).exclude).toEqual(["a", "b"]);
  });

  it("ignores bare args that are not .sql files", () => {
    const a = parseArgs(["random-arg", "another-thing"]);
    expect(a.files).toEqual([]);
  });
});

describe("enumerateNewMigrations", () => {
  it("returns SQL files from git diff output", () => {
    const fake = (_cmd: string, _args: string[]) =>
      "drizzle/0001_init.sql\ndrizzle/0002_add_col.sql\nREADME.md\n";
    expect(enumerateNewMigrations("main", fake)).toEqual([
      "drizzle/0001_init.sql",
      "drizzle/0002_add_col.sql",
    ]);
  });

  it("returns empty array when git command throws", () => {
    const failing = () => {
      throw new Error("bad ref");
    };
    expect(enumerateNewMigrations("nonsense", failing)).toEqual([]);
  });

  it("invokes git with the correct argv", () => {
    let captured: string[] = [];
    const fake = (_cmd: string, args: string[]) => {
      captured = args;
      return "";
    };
    enumerateNewMigrations("origin/main", fake);
    expect(captured).toContain("--diff-filter=A");
    expect(captured).toContain("origin/main...HEAD");
    expect(captured).toContain("drizzle/**/*.sql");
  });
});

describe("runSquawkOnFile", () => {
  it("returns parsed diagnostics and filters to blocking subset", () => {
    const all: SquawkDiagnostic[] = [
      { file: "x.sql", line: 2, rule_name: "require-concurrent-index-creation", message: "x" },
      { file: "x.sql", line: 2, rule_name: "require-timeout-settings", message: "y" },
    ];
    const fake = () => ({ stdout: JSON.stringify(all), status: 1 });
    const r = runSquawkOnFile("x.sql", [], fake);
    expect(r.all).toHaveLength(2);
    expect(r.blocking).toHaveLength(1);
    expect(r.blocking[0]!.rule_name).toBe("require-concurrent-index-creation");
  });

  it("handles empty squawk output (clean file)", () => {
    const fake = () => ({ stdout: "", status: 0 });
    const r = runSquawkOnFile("clean.sql", [], fake);
    expect(r.all).toEqual([]);
    expect(r.blocking).toEqual([]);
    expect(r.status).toBe(0);
  });

  it("returns empty diagnostics on non-JSON output", () => {
    const fake = () => ({ stdout: "garbled non-json", status: 0 });
    const r = runSquawkOnFile("x.sql", [], fake);
    expect(r.all).toEqual([]);
  });

  it("passes --pg-version 17 and --reporter json", () => {
    let captured: string[] = [];
    const fake = (_cmd: string, args: string[]) => {
      captured = args;
      return { stdout: "[]", status: 0 };
    };
    runSquawkOnFile("x.sql", [], fake);
    expect(captured).toContain("--pg-version");
    expect(captured).toContain("17");
    expect(captured).toContain("--reporter");
    expect(captured).toContain("json");
  });

  it("appends --exclude with csv-joined rules when given", () => {
    let captured: string[] = [];
    const fake = (_cmd: string, args: string[]) => {
      captured = args;
      return { stdout: "[]", status: 0 };
    };
    runSquawkOnFile("x.sql", ["rule-a", "rule-b"], fake);
    expect(captured).toContain("--exclude");
    const idx = captured.indexOf("--exclude");
    expect(captured[idx + 1]).toBe("rule-a,rule-b");
  });

  it("omits --exclude when list empty", () => {
    let captured: string[] = [];
    const fake = (_cmd: string, args: string[]) => {
      captured = args;
      return { stdout: "[]", status: 0 };
    };
    runSquawkOnFile("x.sql", [], fake);
    expect(captured).not.toContain("--exclude");
  });
});

describe("aggregate", () => {
  it("returns exitCode=0 when no blocking diagnostics", () => {
    const result: SquawkResult = { all: [], blocking: [], status: 0, raw: "" };
    const r = aggregate([{ file: "a.sql", result }]);
    expect(r.exitCode).toBe(0);
    expect(r.summary).toContain("✓ a.sql");
  });

  it("returns exitCode=0 when only non-blocking diagnostics emitted", () => {
    const result: SquawkResult = {
      all: [{ file: "a.sql", rule_name: "require-timeout-settings", line: 1, message: "x" }],
      blocking: [],
      status: 0,
      raw: "[]",
    };
    const r = aggregate([{ file: "a.sql", result }]);
    expect(r.exitCode).toBe(0);
  });

  it("returns exitCode=1 when any file has blocking diagnostics", () => {
    const d: SquawkDiagnostic = {
      file: "b.sql",
      line: 2,
      rule_name: "ban-drop-column",
      message: "Dropping columns breaks rolling deploys",
      help: "Use a multi-release expand/contract dance.",
    };
    const result: SquawkResult = {
      all: [d],
      blocking: [d],
      status: 0,
      raw: JSON.stringify([d]),
    };
    const r = aggregate([{ file: "b.sql", result }]);
    expect(r.exitCode).toBe(1);
    expect(r.summary).toContain("✗ b.sql");
    expect(r.summary).toContain("ban-drop-column");
    expect(r.summary).toContain("help:");
  });

  it("returns exitCode=1 when squawk crashed (status>1)", () => {
    const result: SquawkResult = { all: [], blocking: [], status: 2, raw: "squawk crashed" };
    const r = aggregate([{ file: "c.sql", result }]);
    expect(r.exitCode).toBe(1);
    expect(r.summary).toContain("squawk error");
  });

  it("emits squawk-error line without raw snippet when raw is empty", () => {
    const result: SquawkResult = { all: [], blocking: [], status: 2, raw: "" };
    const r = aggregate([{ file: "c.sql", result }]);
    expect(r.exitCode).toBe(1);
    expect(r.summary).toContain("squawk error");
    expect(r.summary).not.toContain("    ");
  });

  it("renders fallback `?` when diagnostic fields are undefined", () => {
    const d: SquawkDiagnostic = {};
    const result: SquawkResult = {
      all: [d],
      blocking: [{ ...d, rule_name: "ban-drop-column" }],
      status: 0,
      raw: "",
    };
    // Force the blocking entry to lack line and message:
    const forced: SquawkDiagnostic = { rule_name: "ban-drop-column" };
    const forcedResult: SquawkResult = {
      all: [forced],
      blocking: [forced],
      status: 0,
      raw: "",
    };
    const r = aggregate([{ file: "x.sql", result: forcedResult }]);
    expect(r.summary).toContain("line ?");
    // Make sure the optional help branch is exercised when ABSENT (no extra help: line).
    expect(r.summary).not.toContain("help:");
    expect(result).toBeTruthy();
  });

  it("returns empty-summary message when no inputs", () => {
    const r = aggregate([]);
    expect(r.exitCode).toBe(0);
    expect(r.summary).toBe("No new migrations to lint.");
  });
});

describe("scanForDropWarnings", () => {
  it("emits warning on DROP COLUMN", () => {
    const w = scanForDropWarnings("x.sql", () => "ALTER TABLE t DROP COLUMN c;");
    expect(w[0]).toContain("DROP COLUMN");
  });

  it("emits warning on DROP TABLE", () => {
    const w = scanForDropWarnings("x.sql", () => "DROP TABLE legacy;");
    expect(w[0]).toContain("DROP TABLE");
  });

  it("returns empty array for clean SQL", () => {
    const w = scanForDropWarnings("x.sql", () => "CREATE INDEX CONCURRENTLY foo ON t(c);");
    expect(w).toEqual([]);
  });
});

describe("main (integration with real squawk binary)", () => {
  it("returns 0 when no files supplied and no --since", async () => {
    const code = await main([]);
    expect(code).toBe(0);
  });

  it("returns 0 against the good-concurrent-index fixture", async () => {
    const code = await main(["--", "tools/fixtures/migrations/good-concurrent-index.sql"]);
    expect(code).toBe(0);
  }, 120_000);

  it("returns 1 against the bad-blocking-index fixture (require-concurrent-index-creation)", async () => {
    const code = await main(["--", "tools/fixtures/migrations/bad-blocking-index.sql"]);
    expect(code).toBe(1);
  }, 120_000);

  it("returns 1 against bad-drop-column fixture (ban-drop-column)", async () => {
    const code = await main(["--", "tools/fixtures/migrations/bad-drop-column.sql"]);
    expect(code).toBe(1);
  }, 120_000);

  it("returns 1 against bad-add-not-null-without-default (adding-required-field)", async () => {
    const code = await main([
      "--",
      "tools/fixtures/migrations/bad-add-not-null-without-default.sql",
    ]);
    expect(code).toBe(1);
  }, 120_000);

  it("skips nonexistent files without erroring", async () => {
    const code = await main(["--", "tools/fixtures/migrations/does-not-exist.sql"]);
    expect(code).toBe(0);
  });

  it("accepts --since flag and returns 0 when git diff yields no matching files", async () => {
    // HEAD vs HEAD diff is empty; enumerator returns []; main returns 0.
    const code = await main(["--since", "HEAD"]);
    expect(code).toBe(0);
  }, 30_000);

  it("enumerateNewMigrations with real git default runner returns array (smoke)", () => {
    // Calls without a runner override — exercises the real defaultGitRunner.
    const result = enumerateNewMigrations("HEAD");
    expect(Array.isArray(result)).toBe(true);
  });
});
