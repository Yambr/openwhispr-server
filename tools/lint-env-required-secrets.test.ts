// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * lint-env-required-secrets.test.ts — TDD contract that `.env.slim.example`
 * seeds every `COMPOSE_REQUIRED_KEYS` the migrate boot gate demands.
 * Regression guard for the contract-test/e2e/load-smoke `migrate exit 1` root
 * cause (fix 260530-rqk).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  missingRequiredKeys,
  parseActiveEnvKeys,
  parseComposeRequiredKeys,
} from "./lint-env-required-secrets.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SLIM = join(REPO_ROOT, ".env.slim.example");
const GATE = join(REPO_ROOT, "apps/api/scripts/check-default-secrets.ts");

describe("pure parsers", () => {
  it("parseComposeRequiredKeys extracts the array entries", () => {
    const src = `const COMPOSE_REQUIRED_KEYS = [\n  "A_PASSWORD",\n  "B_SECRET",\n] as const;`;
    expect(parseComposeRequiredKeys(src)).toEqual(["A_PASSWORD", "B_SECRET"]);
  });

  it("parseActiveEnvKeys ignores commented + blank lines", () => {
    const body = ["# COMMENTED=x", "", "ACTIVE=y", "  # also commented"].join("\n");
    expect([...parseActiveEnvKeys(body)]).toEqual(["ACTIVE"]);
  });

  it("missingRequiredKeys flags a commented-out required key", () => {
    const body = ["A=1", "# B=2"].join("\n");
    expect(missingRequiredKeys(["A", "B"], body)).toEqual(["B"]);
  });

  it("missingRequiredKeys is empty when all required keys are active", () => {
    const body = ["A=1", "B=2"].join("\n");
    expect(missingRequiredKeys(["A", "B"], body)).toEqual([]);
  });
});

describe("live: .env.slim.example covers the migrate boot gate", () => {
  const required = parseComposeRequiredKeys(readFileSync(GATE, "utf8"));
  const slim = readFileSync(SLIM, "utf8");

  it("parses a non-trivial COMPOSE_REQUIRED_KEYS list", () => {
    // Guard against a regex regression silently returning [].
    expect(required.length).toBeGreaterThanOrEqual(10);
    expect(required).toContain("PGBOUNCER_ADMIN_PASSWORD");
    expect(required).toContain("MASTER_KEK");
  });

  it("seeds every COMPOSE_REQUIRED_KEY (else `docker compose up` migrate fails)", () => {
    expect(missingRequiredKeys(required, slim)).toEqual([]);
  });
});
