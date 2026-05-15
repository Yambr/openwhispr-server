// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-await-in-non-async.test.ts — RED→GREEN for the D-39 AST guard.
 *
 * The scanner flags `await` keywords whose nearest enclosing function is
 * NOT marked async (typical mistake: `expect(() => Schema.parse(await x))`
 * inside a Vitest assertion). Such code currently raises
 * `SyntaxError: await is only valid in async functions` at parse time
 * when run via Vitest with TS source, surfacing as cryptic suite failures.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findAwaitInNonAsync } from "../lint-await-in-non-async.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lint-await-async-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, body: string): string {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body, "utf8");
  return full;
}

describe("findAwaitInNonAsync (AST scanner)", () => {
  it("flags `() => await foo()` (non-async arrow)", async () => {
    write(
      "a.test.ts",
      `async function foo() { return 1 }
const f = () => await foo();
`,
    );
    const hits = await findAwaitInNonAsync(root);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]).toMatchObject({ file: "a.test.ts" });
  });

  it("flags `expect(() => Schema.parse(await res.json())).not.toThrow()`", async () => {
    write(
      "b.test.ts",
      `declare const expect: any; declare const Schema: any; declare const res: any;
async function run() {
  expect(() => Schema.parse(await res.json())).not.toThrow();
}
`,
    );
    const hits = await findAwaitInNonAsync(root);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag await inside an async arrow", async () => {
    write(
      "c.test.ts",
      `declare const fetch: any;
const f = async () => await fetch("/x");
`,
    );
    const hits = await findAwaitInNonAsync(root);
    expect(hits).toEqual([]);
  });

  it("does NOT flag top-level await (module-level)", async () => {
    write(
      "d.test.ts",
      `declare const probe: () => Promise<boolean>;
const reachable = await probe();
`,
    );
    const hits = await findAwaitInNonAsync(root);
    expect(hits).toEqual([]);
  });

  it("does NOT flag await inside async function declaration", async () => {
    write(
      "e.test.ts",
      `async function run() { await Promise.resolve(); }
`,
    );
    const hits = await findAwaitInNonAsync(root);
    expect(hits).toEqual([]);
  });
});
