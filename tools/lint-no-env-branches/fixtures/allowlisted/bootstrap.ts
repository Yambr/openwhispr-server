// SPDX-License-Identifier: FSL-1.1-ALv2
//
// Fixture: allowlisted/bootstrap.ts — contains a forbidden NODE_ENV read
// that must NOT be flagged because the IGNORE list excludes the
// `bootstrap.ts` basename (canonical boundary path where NODE_ENV may be
// read once before injecting the resolved mode through DI).
export const mode: string = process.env.NODE_ENV ?? "development";
