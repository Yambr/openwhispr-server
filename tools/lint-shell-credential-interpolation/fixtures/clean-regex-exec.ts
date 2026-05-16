// SPDX-License-Identifier: FSL-1.1-ALv2
// Fixture (NOT shipped to runtime) — LOCKER-06 false-positive guard:
// regex `.exec()` method call. The linter MUST NOT flag this — AST
// distinguishes Identifier callee (child_process exec) from
// PropertyAccessExpression callee (regex.exec method).
//
// biome-ignore lint: fixture file, intentional dead code
export function parseBearer(value: string): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(value);
  return m?.[1] ?? null;
}

// Bonus false-positive: token-named identifier appearing in a regex match
// — NOT inside any shell-execution context. MUST NOT be flagged.
export function noiseTokenRegex(value: string): boolean {
  const ACCESS_TOKEN = "noise";
  return new RegExp(`^${ACCESS_TOKEN}$`).test(value);
}
