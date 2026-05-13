// SPDX-License-Identifier: Apache-2.0
// This file is in the i18n fixture allowlist; Cyrillic is permitted here.
// Used by lint-english.test.ts to verify the allowlist is honored.
//
// We use Unicode escapes for ASCII-source consistency, but the directory
// (tests/fixtures/i18n/**) is allowlisted in tools/lint-english.ts so even
// literal Cyrillic would be acceptable in this path.
//
// SAMPLE_RU == "privet" ("hello" in Russian, U+043F U+0440 U+0438 U+0432 U+0435 U+0442)
export const SAMPLE_RU = "\u043F\u0440\u0438\u0432\u0435\u0442";
