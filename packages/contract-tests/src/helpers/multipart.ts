// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 / Plan 04 / Task 2 — multipart body helper for contract tests.
// Phase 68 / Plan 68-01 — REVIEW byok HIGH HI-05.
//
// Reads a fixture audio file (default: the bundled
// `packages/contract-tests/fixtures/audio/sample-1s.wav`) and wraps it in
// a single-part multipart/form-data envelope. The boundary is
// timestamp-suffixed so concurrent test runs don't collide on a static
// boundary string.
//
// HI-05: the fixture is bundled INSIDE this package (and shipped via the
// `package.json` `files:` allowlist) — the helper previously resolved a
// repo-root `tests/fixtures/audio/` path that is absent from any
// published tarball, so an external consumer of the helper would crash.
//
// The contract suite POSTs the resulting body + content-type as a `Buffer`
// payload — Node 24's `fetch` accepts `BodyInit` including `Buffer`, and
// the api-side `@fastify/multipart` (registered at buildApp level by Plan
// 03 Wave 1, attachFieldsToBody=false) parses the boundary correctly.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AudioMultipartBody {
  body: Buffer;
  contentType: string;
}

export function audioMultipartBody(filename = "sample-1s.wav"): AudioMultipartBody {
  const boundary = `----openwhispr-test-boundary-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  // HI-05: resolve the package-bundled fixture.
  // packages/contract-tests/src/helpers -> ../../fixtures/audio.
  const fileBytes = readFileSync(resolve(__dirname, "../../fixtures/audio", filename));
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    body: Buffer.concat([head, fileBytes, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
