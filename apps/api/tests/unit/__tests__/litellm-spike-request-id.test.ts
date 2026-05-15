// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 3 / Plan 02 / Task 2 — D-08 / RESEARCH A4 spike.
//
// Confirms that the `x-litellm-spend-logs-metadata` JSON header
// `{"openwhispr_request_id":"<uuid>"}` we attach on every outbound
// chat-completions / transcription request to LiteLLM lands in
// `LiteLLM_SpendLogs.metadata` (jsonb column) with our key intact.
//
// Plan 08 (spend ingest worker) extracts `metadata->>'openwhispr_request_id'`
// to correlate LiteLLM spend rows with our usage_ledger rows. If the
// shape diverges (e.g. metadata text-encoded, key dropped) the dump
// printed by this test is the authoritative reference Plan 08 reads.
//
// AUTO-SKIPS in CI when LITELLM_BASE_URL/LITELLM_MASTER_KEY/
// LITELLM_DATABASE_URL are unset (default vitest run). The spike is
// invoked explicitly by `make contract-test`-equivalent infra in Plan 02
// or by an operator running a live stack:
//
//   LITELLM_CONFIG_FILE=litellm_config.contract.yaml \
//     docker compose --profile default --profile contract-test up -d --wait litellm postgres
//   LITELLM_BASE_URL=http://localhost:4000 \
//   LITELLM_MASTER_KEY=$(grep ^LITELLM_MASTER_KEY .env | cut -d= -f2) \
//   LITELLM_DATABASE_URL=postgres://owner:pwd@localhost:5432/litellm \
//     pnpm vitest run apps/api/src/__tests__/litellm-spike-request-id.test.ts

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const liveEnvPresent =
  Boolean(process.env.LITELLM_BASE_URL) &&
  Boolean(process.env.LITELLM_MASTER_KEY) &&
  Boolean(process.env.LITELLM_DATABASE_URL);

const itLive = liveEnvPresent ? it : it.skip;

describe("LiteLLM x-litellm-spend-logs-metadata propagation (D-08 spike)", () => {
  let pool: Pool | null = null;

  beforeAll(() => {
    if (liveEnvPresent) {
      pool = new Pool({
        connectionString: process.env.LITELLM_DATABASE_URL,
      });
    }
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  itLive(
    "openwhispr_request_id round-trips into LiteLLM_SpendLogs.metadata",
    async () => {
      const ourRid = randomUUID();
      const baseUrl = process.env.LITELLM_BASE_URL!;
      const masterKey = process.env.LITELLM_MASTER_KEY!;

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${masterKey}`,
          "content-type": "application/json",
          "x-litellm-spend-logs-metadata": JSON.stringify({
            openwhispr_request_id: ourRid,
          }),
        },
        body: JSON.stringify({
          model: "qwen3.6-plus",
          messages: [{ role: "user", content: "spike" }],
          user: "spike-user-1",
        }),
      });
      expect(res.status).toBe(200);
      // Drain the body so the connection releases cleanly.
      await res.text();

      // Wait for the async spend-log writer to flush. LiteLLM batches
      // spend log inserts every ~1s by default; 3s leaves headroom.
      await new Promise((r) => setTimeout(r, 3000));

      const { rows } = await pool?.query(
        `SELECT request_id, "end_user", metadata
           FROM "LiteLLM_SpendLogs"
          WHERE metadata->>'openwhispr_request_id' = $1`,
        [ourRid],
      );

      expect(rows.length).toBe(1);
      expect(rows[0].metadata.openwhispr_request_id).toBe(ourRid);
      expect(rows[0].end_user).toBe("spike-user-1");
    },
    15_000,
  );

  it("audio fixture exists with valid RIFF/WAVE header", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    // Resolve relative to this test file so the assertion does not depend on
    // process.cwd() (vitest runs per-package = apps/api; the fixture lives at
    // the repo root). Walk up from apps/api/src/__tests__/ to repo root.
    const here = dirname(fileURLToPath(import.meta.url));
    // Δ-1 (Phase 18.1.2-04-02): post Phase 15-02 `migrate-tests` codemod the
    // test file moved from apps/api/src/__tests__/ → apps/api/tests/unit/__tests__/
    // — 1 directory deeper, so the walk to repo root is 5 ups, not 4. The
    // fixture file `tests/fixtures/audio/sample-1s.wav` EXISTS at repo root;
    // CONTEXT D-08 originally framed this as "missing fixture" which Δ-1
    // corrected to "path-depth bug". No file creation, no rename.
    const repoRoot = join(here, "..", "..", "..", "..", "..");
    const fixturePath = join(repoRoot, "tests/fixtures/audio/sample-1s.wav");
    expect(existsSync(fixturePath)).toBe(true);
    const buf = readFileSync(fixturePath);
    // Bytes 0-3 = "RIFF", bytes 8-11 = "WAVE"
    expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(buf.subarray(8, 12).toString("ascii")).toBe("WAVE");
  });
});
