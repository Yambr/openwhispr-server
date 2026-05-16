// Fixture for tools/lint-shell-credential-interpolation.test.ts.
// `regex.exec(value)` is the RegExp method, NOT child_process.exec.
// The linter MUST NOT flag this even though the identifier `exec` is
// present.
const BEARER_RE = /^Bearer\s+(.+)$/;
const TOKEN = "ey...";

const match = BEARER_RE.exec(TOKEN);

export { match };
