// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 14 / Plan 05 — RED conformance for virtual-key-rotation removal.
//
// CONTEXT.md decision 3 + RESEARCH §A.5 + REQUIREMENTS BYOK-03 audit closure:
// remove the entire vkr worker wiring (job file, queue registration, cron,
// worker registration, noop adapters) because the production driver does
// not exist and the cron enqueues a nil-UUID sentinel that cannot succeed.
//
// This test is the conformance gate for the removal — RED in the pre-edit
// state, GREEN after Tasks 2 + 3 land. It also keeps the removal honest in
// future refactors: anyone resurrecting `virtualKeyRotation` symbols or the
// `0 3 * * 0` cron pattern in worker source must explicitly re-enable this
// queue under a new CONTEXT decision.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../..");

/**
 * Strip JS/TS line + block comments. Used so explanatory comments that
 * mention the removed symbols ("Phase 14 / Plan 05 — virtualKeyRotation
 * was removed…") don't count as live references.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]+\/\/.*$/gm, "");
}

/**
 * Walk a directory tree, collecting every .ts file (excluding `dist/`,
 * `node_modules/`, `coverage/`).
 */
function collectTsFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === "dist" || name === "coverage") continue;
      const p = `${dir}/${name}`;
      let s: { isDirectory: () => boolean; isFile: () => boolean };
      try {
        s = statSync(p);
      } catch {
        continue;
      }
      if (s.isDirectory()) stack.push(p);
      else if (s.isFile() && p.endsWith(".ts")) out.push(p);
    }
  }
  return out;
}

/** Confirms grep is wired correctly. */
function grepHits(pattern: string, paths: string[]): string[] {
  try {
    const out = execFileSync("grep", ["-rln", "--", pattern, ...paths], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    const e = err as { status?: number };
    if (e.status === 1) return [];
    throw err;
  }
}

describe("virtual-key-rotation removal conformance (Phase 14 / Plan 05)", () => {
  it("apps/worker/src/jobs/virtual-key-rotation.ts is deleted", () => {
    expect(existsSync(resolve(REPO_ROOT, "apps/worker/src/jobs/virtual-key-rotation.ts"))).toBe(
      false,
    );
  });

  it("apps/worker/src/jobs/virtual-key-rotation.test.ts is deleted", () => {
    expect(
      existsSync(resolve(REPO_ROOT, "apps/worker/src/jobs/virtual-key-rotation.test.ts")),
    ).toBe(false);
  });

  it("no live source under apps/ references the removed vkr symbols", () => {
    // grep first as a fast positive — confirms grep is wired before we
    // assert the empty result. If grep returns zero hits, we're done; if
    // it returns hits, those may be inside comments (legitimate
    // explanatory references to the removed code), so we re-check
    // post-comment-strip on each file.
    const rawHits = grepHits(
      "virtualKeyRotation\\|noopLitellmKeyClient\\|noopUserKeyLookup\\|buildVirtualKeyRotationHandler\\|vkrWorker",
      ["apps/worker/src", "apps/api/src"],
    );
    const pattern =
      /(?:virtualKeyRotation|noopLitellmKeyClient|noopUserKeyLookup|buildVirtualKeyRotationHandler|vkrWorker)/;
    const liveHits: string[] = [];
    for (const rel of rawHits) {
      const src = readFileSync(resolve(REPO_ROOT, rel), "utf8");
      if (pattern.test(stripComments(src))) liveHits.push(rel);
    }
    expect(liveHits).toEqual([]);
    // Belt-and-braces: walk every .ts file under apps/ and re-check.
    const tsFiles = [
      ...collectTsFiles(resolve(REPO_ROOT, "apps/worker/src")),
      ...collectTsFiles(resolve(REPO_ROOT, "apps/api/src")),
    ];
    const walkHits: string[] = [];
    for (const abs of tsFiles) {
      const src = readFileSync(abs, "utf8");
      if (pattern.test(stripComments(src))) walkHits.push(abs);
    }
    expect(walkHits).toEqual([]);
  });

  it("apps/worker/src/queues.ts does not contain virtualKeyRotation", () => {
    const src = readFileSync(resolve(REPO_ROOT, "apps/worker/src/queues.ts"), "utf8");
    expect(src).not.toMatch(/virtualKeyRotation/);
    expect(src).not.toMatch(/virtual-key-rotation/);
  });

  it("apps/worker/src/scheduler.ts does not contain virtualKeyRotation or 0 3 * * 0", () => {
    const src = readFileSync(resolve(REPO_ROOT, "apps/worker/src/scheduler.ts"), "utf8");
    expect(src).not.toMatch(/virtualKeyRotation/);
    expect(src).not.toMatch(/0 3 \* \* 0/);
  });

  it("tests/e2e/log-scrub-sentinel.test.ts enqueues against email-delivery, not the deleted queue", () => {
    const src = readFileSync(resolve(REPO_ROOT, "tests/e2e/log-scrub-sentinel.test.ts"), "utf8");
    // Strip block comments + line comments so the explanatory historical
    // note ("the virtual-key-rotation queue this test previously
    // exercised was removed wholesale") doesn't count as a live
    // reference. We care only about live identifiers in the test body.
    const live = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "")
      .replace(/[ \t]+\/\/.*$/gm, "");
    expect(live).not.toMatch(/virtual-key-rotation/);
    expect(live).toMatch(/email-delivery/);
  });

  it("docs/architecture.md no longer lists Q2[virtual-key-rotation] in the mermaid diagram", () => {
    const src = readFileSync(resolve(REPO_ROOT, "docs/architecture.md"), "utf8");
    // The mermaid diagram is the truth we assert removal against. The
    // narrative blockquote that explains *why* the slot was removed is
    // expected to mention the names — so we scope the assertion to the
    // mermaid fence(s) only.
    const fences = Array.from(src.matchAll(/```mermaid\n([\s\S]*?)```/g)).map((m) => m[1] ?? "");
    const allMermaid = fences.join("\n");
    expect(allMermaid).not.toMatch(/Q2\[virtual-key-rotation\]/);
    expect(allMermaid).not.toMatch(/vkrWorker/);
  });

  it("docs/operations.md documents the valkey-cli DEL bull:virtual-key-rotation:* cleanup", () => {
    const src = readFileSync(resolve(REPO_ROOT, "docs/operations.md"), "utf8");
    expect(src).toMatch(/DEL bull:virtual-key-rotation:\*/);
  });

  it("apps/worker/src/index.ts boots a transient bull:virtual-key-rotation:* cleanup", () => {
    const src = readFileSync(resolve(REPO_ROOT, "apps/worker/src/index.ts"), "utf8");
    expect(src).toMatch(/bull:virtual-key-rotation:\*/);
  });
});
