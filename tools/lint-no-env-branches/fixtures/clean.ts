// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Fixture: clean.ts — contains no NODE_ENV reads or comparisons.
 * lint-no-env-branches must report zero violations against this file.
 */
export function clean(input: number): number {
  return input * 2;
}
