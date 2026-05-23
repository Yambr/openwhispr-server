// SPDX-License-Identifier: FSL-1.1-ALv2
// Fixture for tools/lint-secret-shape-in-error.test.ts.
// A plain DTO class (does NOT extend Error). The locker must skip it
// entirely even though it carries a dangerous-named string field.
export class HttpResponseDto {
  public bodyText: string;

  constructor(bodyText: string) {
    this.bodyText = bodyText;
  }
}
