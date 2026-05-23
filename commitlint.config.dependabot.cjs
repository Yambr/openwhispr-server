// SPDX-License-Identifier: FSL-1.1-ALv2
// Relaxed commitlint config used ONLY for the dependabot[bot] author.
//
// Dependabot generates long body lines (advisory URLs, release notes,
// dependency-tree dumps) and group-update subjects that trip the default
// config-conventional `body-max-line-length: 100` and `subject-case:
// lower-case-only` rules. Relaxing both lets dependency bumps merge cleanly.
//
// The DOCS-09 Cyrillic ban inherits from the strict config at level 2 and
// applies universally — bot and human commits alike.
//
// CI selection lives in `.github/workflows/ci.yml` `commitlint` job:
//   configFile: ${{ github.actor == 'dependabot[bot]'
//                   && 'commitlint.config.dependabot.cjs'
//                   || 'commitlint.config.cjs' }}
// Lefthook's local `commit-msg` hook continues to use the strict default.
const strict = require("./commitlint.config.cjs");

module.exports = {
  ...strict,
  rules: {
    ...strict.rules,
    "body-max-line-length": [0, "always"],
    "subject-case": [0, "always"],
  },
};
