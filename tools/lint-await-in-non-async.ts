#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-await-in-non-async.ts — RED skeleton (D-39 Plan 02).
 *
 * Placeholder: GREEN commit replaces the body with a TypeScript-AST
 * visitor. This file exists so the RED test imports successfully and
 * its assertions fail on absent behavior rather than module-not-found.
 */
import { exit } from "node:process";

export interface AwaitInNonAsync {
  file: string;
  line: number;
}

export async function findAwaitInNonAsync(_rootDir: string): Promise<AwaitInNonAsync[]> {
  return [];
}

/* c8 ignore start */
if (import.meta.url === `file://${process.argv[1]}`) {
  findAwaitInNonAsync(process.cwd()).then(
    (hits) => {
      if (hits.length === 0) {
        process.stdout.write("lint-await-in-non-async: clean\n");
        exit(0);
      }
      for (const h of hits) process.stderr.write(`  ${h.file}:${h.line}\n`);
      exit(1);
    },
    (err) => {
      process.stderr.write(`lint-await-in-non-async: ${String(err)}\n`);
      exit(2);
    },
  );
}
/* c8 ignore stop */
