// SPDX-License-Identifier: FSL-1.1-ALv2
// commitlint config for openwhispr-server
// Extends Conventional Commits and adds custom Cyrillic-ban rules (DOCS-09).
// Cyrillic ranges:
//   U+0400-U+04FF (basic Cyrillic block)
//   U+0500-U+052F (Cyrillic Supplement)
// The regex is built from a string literal that uses backslash-u escapes only,
// so this source file remains ASCII-only (verifiable via tools/lint-english.ts).
// A regex literal would require Cyrillic codepoints in this source file, which
// is exactly what DOCS-09 forbids — hence the RegExp-constructor-with-\u-escapes form.
// biome-ignore lint/complexity/useRegexLiterals: literal would embed Cyrillic codepoints, violating DOCS-09
const CYRILLIC = new RegExp("[\\u0400-\\u04FF\\u0500-\\u052F]", "u");

module.exports = {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "subject-no-cyrillic": ({ subject }) => [
          !subject || !CYRILLIC.test(subject),
          "commit subject must not contain Cyrillic characters (DOCS-09)",
        ],
        "body-no-cyrillic": ({ body }) => [
          !body || !CYRILLIC.test(body),
          "commit body must not contain Cyrillic characters (DOCS-09)",
        ],
      },
    },
  ],
  rules: {
    "subject-no-cyrillic": [2, "always"],
    "body-no-cyrillic": [2, "always"],
    // Dependabot generates long body lines (advisory URLs, release notes,
    // dependency-tree dumps) and group-update subjects that trip the
    // default config-conventional `body-max-line-length: 100` and
    // `subject-case: lower-case-only` rules. Relax both so dependency
    // bumps merge cleanly; our own commits stay constrained by the
    // habit + editor hints — the Cyrillic ban above stays strict for
    // every commit (the actual DOCS-09 contract). Net safety unchanged.
    "body-max-line-length": [0, "always"],
    "subject-case": [0, "always"],
  },
};
