// SPDX-License-Identifier: FSL-1.1-ALv2
//
// Fixture: violates.ts — intentionally contains forbidden NODE_ENV reads
// and comparisons so that lint-no-env-branches.test.ts can assert the
// linter flags both `NODE_ENV-read` and `NODE_ENV-compare` labels.
//
// DO NOT consume this file from production code; it is referenced only
// by tools/lint-no-env-branches.test.ts and lives under a path the
// locker's PATTERNS glob excludes (tools/ is outside apps and packages
// src globs).
export function violateA(): boolean {
  // Forbidden: process.env.NODE_ENV read
  if (process.env.NODE_ENV === "production") {
    return true;
  }
  return false;
}

// Forbidden: NODE_ENV !== compare without process.env. prefix
declare const NODE_ENV: string;
export const isTest = NODE_ENV !== "production";
