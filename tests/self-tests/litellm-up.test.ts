// SPDX-License-Identifier: Apache-2.0
/**
 * Phase 03 / Plan 01 / Task 2 — LiteLLM smoke test (LITELLM-01).
 *
 * Asserts the bundled LiteLLM sidecar boots healthy under the default
 * compose profile and answers /health/liveliness over the internal
 * network. Skipped when docker is not available — the orchestrator
 * runs full validation post-wave with docker.
 *
 * Source-of-record:
 *   - compose/litellm/litellm_config.yaml (bundled config)
 *   - docker-compose.yml `litellm` service
 *   - .planning/phases/03-litellm-integration-bundled-oss-models/03-01-PLAN.md
 *
 * Pattern reference:
 *   tests/self-tests/api-container-healthy.test.ts (Phase 02.1) — invoke
 *   `docker compose --profile default up -d --wait <svc>` then poll the
 *   service's healthcheck endpoint via `docker compose exec`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function dockerAvailable(): boolean {
  const r = spawnSync("docker", ["info"], { stdio: "ignore" });
  return r.status === 0;
}

const SKIP_REASON =
  "Skipped: docker not available in this environment. CI / orchestrator runs the full smoke.";

describe("litellm sidecar — smoke (LITELLM-01)", () => {
  it.skipIf(!dockerAvailable())(
    "boots healthy and answers /health/liveliness on the internal network",
    () => {
      // The orchestrator brings the stack up with bootstrap.sh-generated .env;
      // this test assumes the same precondition. We do NOT bring the stack up
      // here to keep the run cheap — `docker compose ps litellm --format '{{.Health}}'`
      // is the canonical readiness check.
      const ps = execFileSync(
        "docker",
        ["compose", "--profile", "default", "ps", "litellm", "--format", "{{.Health}}"],
        { encoding: "utf8" },
      ).trim();

      // If the operator has not started the stack yet, expect an empty result;
      // surface a clear actionable error rather than a misleading assertion.
      if (ps.length === 0) {
        throw new Error(
          "litellm container not running. Run `make up` (or `docker compose --profile default up -d --wait litellm`) before this smoke test.",
        );
      }
      expect(ps).toBe("healthy");

      // Probe /health/liveliness from inside the network via the api container.
      const probe = execFileSync(
        "docker",
        [
          "compose",
          "exec",
          "-T",
          "api",
          "wget",
          "--quiet",
          "--tries=1",
          "--spider",
          "http://litellm:4000/health/liveliness",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      // wget --spider exits 0 on 2xx; failure throws.
      expect(probe).toBeDefined();
    },
    180_000,
  );

  it("[guard] config.yaml omits pyannote and pass_through_endpoints (D-07 REVISED, T-03-01-06)", async () => {
    const fs = await import("node:fs");
    const yaml = await import("yaml");
    const raw = fs.readFileSync("compose/litellm/litellm_config.yaml", "utf8");
    const parsed = yaml.parse(raw) as Record<string, unknown>;

    // Comment block at top is allowed to mention pyannote / pass_through_endpoints
    // (operator-guidance commentary). The PARSED YAML — i.e. the keys/values
    // LiteLLM will load — must contain neither.
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toMatch(/pyannote/i);
    expect(serialized).not.toMatch(/pass_through_endpoints/i);

    // model_list contains ≥7 entries (3 OpenRouter LLMs + Groq STT + 3 OpenAI realtime).
    const modelList = (parsed as { model_list?: unknown[] }).model_list ?? [];
    expect(modelList.length).toBeGreaterThanOrEqual(7);
  });

  it("[guard] docker-compose.yml does NOT forward PYANNOTE_API_KEY into the litellm container (T-03-01-06)", async () => {
    const fs = await import("node:fs");
    const raw = fs.readFileSync("docker-compose.yml", "utf8");
    // Slice to the litellm service block (litellm: through the next top-level service).
    const m = raw.match(/\n  litellm:\n[\s\S]+?(?=\n  [a-z][a-z0-9_-]*:\n)/);
    expect(m, "litellm: service block not found in docker-compose.yml").toBeTruthy();
    const block = m?.[0] ?? "";
    expect(block).not.toMatch(/PYANNOTE_API_KEY:\s/);
  });
});
