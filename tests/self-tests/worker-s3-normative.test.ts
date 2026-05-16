// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 48 / Plan 48-01 / L7 — SR-19a.4 closure self-test.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..");

describe("worker S3 normative wiring (Phase 48 / L7)", () => {
  it("compose/docker-compose.storage.yml has a worker block with S3_* env", () => {
    const body = readFileSync(
      resolve(REPO_ROOT, "compose/docker-compose.storage.yml"),
      "utf8",
    );
    expect(body).toMatch(/^\s+worker:/m);
    const workerBlock = body.split(/^\s+worker:/m)[1] ?? "";
    expect(workerBlock).toMatch(/S3_ENDPOINT/);
    expect(workerBlock).toMatch(/S3_ACCESS_KEY/);
    expect(workerBlock).toMatch(/S3_SECRET_KEY/);
    expect(workerBlock).toMatch(/S3_BUCKET/);
  });

  it("tests/e2e-cjm/compose-overrides.yml no longer carries worker S3_*", () => {
    const body = readFileSync(
      resolve(REPO_ROOT, "tests/e2e-cjm/compose-overrides.yml"),
      "utf8",
    );
    const workerBlock = body.split(/^\s+worker:/m)[1] ?? "";
    expect(workerBlock).not.toMatch(/^\s*S3_ENDPOINT:/m);
    expect(workerBlock).not.toMatch(/^\s*S3_ACCESS_KEY:/m);
    expect(workerBlock).not.toMatch(/^\s*S3_SECRET_KEY:/m);
    expect(workerBlock).not.toMatch(/^\s*S3_BUCKET:/m);
  });

  it("INGRESS_BASE_URL stays in the e2e-cjm overrides (gerund: still e2e-only)", () => {
    const body = readFileSync(
      resolve(REPO_ROOT, "tests/e2e-cjm/compose-overrides.yml"),
      "utf8",
    );
    expect(body).toMatch(/INGRESS_BASE_URL/);
  });
});
