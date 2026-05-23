// SPDX-License-Identifier: FSL-1.1-ALv2
// Fixture for tools/lint-secret-shape-in-error.test.ts.
// A class extending `Error` with a public `responseBody: string` field that
// is NOT truncated. Expected finding: LOCKER-05-LEAK on `responseBody`.
export class YError extends Error {
  public responseBody: string;

  constructor(responseBody: string) {
    super("upstream failure");
    this.responseBody = responseBody;
  }
}
