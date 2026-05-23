// SPDX-License-Identifier: FSL-1.1-ALv2
// Fixture for tools/lint-secret-shape-in-error.test.ts.
// `bodyText` field is `private readonly`, which the linter treats as the
// preferred Phase 37 / CR-9 mitigation (combined with a custom `toJSON()`).
// No finding should be emitted even though the constructor does not
// explicitly truncate via `.slice(...)`.
export class PrivateOkError extends Error {
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: fixture exists to exercise lint-secret-shape-in-error
  private readonly bodyText: string;

  constructor(bodyText: string) {
    super("upstream failure");
    this.bodyText = bodyText;
  }

  toJSON(): { name: string; message: string } {
    return { name: this.name, message: this.message };
  }
}
