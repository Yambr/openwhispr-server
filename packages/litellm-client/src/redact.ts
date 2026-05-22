// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase litellm-patterns A2 — shape-based secret redaction.
//
// Strengthens LOCKER-05 (Error subclasses truncate body-shaped string
// fields at construction). Truncation alone is insufficient: a
// credential-shaped token sitting in the FIRST 200 chars of an upstream
// error body survives `bodyText.slice(0, 200)` into `Error.message`.
//
// `redactSecretShapes` is a PURE function that replaces credential-shape
// substrings with the literal `[redacted]` BEFORE truncation runs. It is
// shape-based (matches the visual structure of a credential), not a
// dictionary of known secrets — so an unknown provider key of the right
// shape is still caught.
//
// LOCKER-03 note: the patterns below are DETECTION regexes built from
// character classes, NOT literal full secrets. No complete `sk-…` /
// `AKIA…` / JWT literal exists in this file.

interface SecretShape {
  /** Human label — kept for grep-ability; not used at runtime. */
  readonly label: string;
  readonly re: RegExp;
}

/**
 * Credential-shape detection patterns. Each `re` carries the global flag
 * so a single body containing several secrets is fully redacted.
 */
const SECRET_SHAPES: readonly SecretShape[] = [
  {
    // OpenAI / Anthropic style: `sk-` (optionally `sk-ant-`, `sk-proj-`)
    // followed by >=16 base62-ish chars. The optional `[a-z]+-` segment
    // absorbs the `ant-` / `proj-` infix.
    label: "openai-anthropic-api-key",
    re: /sk-(?:[a-z]+-)?[A-Za-z0-9_-]{16,}/g,
  },
  {
    // Google API key: `AIza` + 35 url-safe base64 chars.
    label: "google-api-key",
    re: /AIza[A-Za-z0-9_-]{35}/g,
  },
  {
    // AWS access key id: `AKIA` + 16 uppercase alphanumerics.
    label: "aws-access-key-id",
    re: /AKIA[A-Z0-9]{16}/g,
  },
  {
    // Bearer JWT: the literal `Bearer ` then a JWT (`eyJ…` header,
    // dot-separated base64url segments).
    label: "bearer-jwt",
    re: /Bearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  },
  {
    // PEM private-key block — any `BEGIN … PRIVATE KEY` / `END … PRIVATE
    // KEY` pair and everything between (newlines included via `[\s\S]`).
    label: "pem-private-key",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
];

/**
 * Replace every credential-shape substring in `s` with the literal
 * `[redacted]`. Pure — never mutates input, never throws. A string with
 * no credential shapes is returned unchanged.
 */
export function redactSecretShapes(s: string): string {
  let out = s;
  for (const { re } of SECRET_SHAPES) {
    // `re` carries `g`; `String.prototype.replace` resets `lastIndex`
    // itself on each call, so reuse of the shared RegExp is safe here.
    out = out.replace(re, "[redacted]");
  }
  return out;
}
