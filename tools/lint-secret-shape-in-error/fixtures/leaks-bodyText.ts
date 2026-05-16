// Fixture for tools/lint-secret-shape-in-error.test.ts.
// A class extending `Error` with a public `bodyText: string` field that is
// NOT truncated in the constructor. The linter must emit a single
// LOCKER-05-LEAK finding on the field declaration line.
export class XError extends Error {
  public readonly bodyText: string;

  constructor(bodyText: string) {
    super("upstream failure");
    this.bodyText = bodyText;
  }
}
