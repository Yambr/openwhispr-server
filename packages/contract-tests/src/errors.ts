// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 40 / Sub-fix 40.c — typed error for upstream envelope violations.
//
// `fetchAndParse` enforces D-13 / WIRE-17: every non-2xx response body
// MUST parse as the canonical `ErrorEnvelope` shape `{error:string}`.
// Before Phase 40 the helper silently passed when the body was a raw
// string, empty, or invalid JSON — exactly the regression classes the
// helper exists to catch. Phase 40 makes those throw a typed error so
// contract tests fail loudly + observably.
//
// LOCKER-05 (CRIT-FIX-09 pattern): `bodyText` is `private readonly`,
// truncated at construction, declared non-enumerable, and the class
// overrides `toJSON()` to expose only `{name, message, status,
// contentType}` — never the body text.

const MAX_BODY_TEXT_LEN = 200;

export class MalformedUpstreamEnvelopeError extends Error {
  public readonly status: number;
  public readonly contentType: string | null;
  readonly #bodyText: string;

  constructor(args: {
    status: number;
    contentType: string | null;
    bodyText: string;
    reason: string;
  }) {
    const truncated = args.bodyText.slice(0, MAX_BODY_TEXT_LEN);
    super(
      `non-2xx response did not match ErrorEnvelope shape (${args.reason}): status=${args.status} content-type=${args.contentType ?? "(none)"}`,
    );
    this.name = "MalformedUpstreamEnvelopeError";
    this.status = args.status;
    this.contentType = args.contentType;
    this.#bodyText = truncated;
  }

  /**
   * Returns the truncated body text (≤ 200 chars). Intentional accessor
   * rather than a public field — keeps `bodyText` out of JSON.stringify
   * output by default while letting tests + targeted debug paths read it.
   */
  getBodyText(): string {
    return this.#bodyText;
  }

  /** LOCKER-05 — strip the body text from any structured-clone path. */
  toJSON(): { name: string; message: string; status: number; contentType: string | null } {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      contentType: this.contentType,
    };
  }
}
