// Fixture for tools/lint-secret-shape-in-error.test.ts.
// `bodyText` is truncated in the constructor via `.slice(...)`. Linter
// must NOT emit any finding.
export class OkError extends Error {
  public readonly bodyText: string;

  constructor(bodyText: string) {
    super("upstream failure");
    this.bodyText = bodyText.slice(0, 200);
  }
}
