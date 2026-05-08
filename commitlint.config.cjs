// commitlint config for openwhispr-server
// Extends Conventional Commits and adds custom Cyrillic-ban rules (DOCS-09).
// Cyrillic ranges:
//   U+0400-U+04FF (basic Cyrillic block)
//   U+0500-U+052F (Cyrillic Supplement)
// The regex literal uses \u escapes so this source file remains ASCII-only.
const CYRILLIC = /[Ѐ-ӿԀ-ԯ]/u;

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
  },
};
