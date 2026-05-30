// SPDX-License-Identifier: FSL-1.1-ALv2
// tests/e2e/cleanup-norephrase-live.test.ts
//
// #17 (B) — nightly LIVE cleanup no-rephrase e2e against the REAL OpenRouter
// instruct checkpoint through the FULL production chain:
//
//   POST https://api.localhost/api/reason   (cleanup shape: text only)
//     → Traefik websecure entrypoint
//     → Fastify api /api/reason route (cleanup persona + thinking-off/temp:0)
//     → LiteLLM (chat) — live-cleanup config — pointed at OpenRouter
//     → OpenRouter (real provider, qwen3-30b-a3b-instruct-2507)
//
// WHAT THIS CATCHES (the MODEL/PROVIDER drift axis):
//   "the instruct checkpoint started paraphrasing" / "OpenRouter swapped
//   behavior under the same id". The complementary axis — regression of the
//   OPERATOR's deployed litellm config — is a future variant ("A") that hits
//   the in-cluster stage litellm and needs a scoped kubeconfig.
//
// COST / SECURITY DISCIPLINE:
//   Runs ONLY in .github/workflows/nightly-cleanup-norephrase.yml, gated to
//   scheduled / tag / workflow_dispatch (PRs/forks cannot read
//   OPENROUTER_API_KEY nor trigger the live overlay). One short completion
//   (~40-token transcript) — a fraction of a cent per run. Local dev without
//   OPENROUTER_API_KEY skips the describe via skipIf() — no accidental spend.
//
// FLAKY-TOLERANT / NON-REQUIRED:
//   Like the realtime soak, this is empirical and NOT in
//   scripts/branch-protection.json — a provider-side hiccup must never gate
//   main. The per-PR cleanup guarantee is the hermetic contract test
//   (apps/api/tests/unit/routes/reason.test.ts: cleanup-shape returns model
//   output VERBATIM) + the unit no-rephrase resolver tests.
//
// CLAUDE.md `no mocks of internal logic`: every hop is real. OpenRouter is a
// third-party SaaS process boundary.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

const LIVE_ENABLED = Boolean(process.env.OPENROUTER_API_KEY) && process.env.E2E === "1";

const ReasonResponse = z.object({
  text: z.string().min(1),
  model: z.string(),
  provider: z.string(),
  promptMode: z.string(),
  matchType: z.string(),
});

// The operator's proven golden dirty transcript (validated live 2026-05-30):
// fillers (um / like / you know), a duplicated word ("the the"), no
// punctuation/capitalization. The cleanup INVARIANT the real model must
// satisfy: fillers + duplicates removed, punctuation/capitalization added,
// meaning + word ORDER preserved verbatim — NOT paraphrased/reordered.
const DIRTY =
  "um so yeah i was like thinking that uh we should maybe you know ship the the thing on friday but um idk if the tests are gonna pass by then so like maybe monday is safer i guess";

// Content words that MUST survive (meaning preserved). Fillers are NOT here.
const MUST_KEEP = ["ship", "friday", "tests", "pass", "monday", "safer"];
// Fillers / artifacts that a correct cleanup MUST remove.
const MUST_DROP = ["um ", " uh ", "idk", "gonna", "the the"];

describe.skipIf(!LIVE_ENABLED)(
  "e2e LIVE — /api/reason cleanup does NOT rephrase (real OpenRouter)",
  () => {
    it("cleans fillers/dups without paraphrasing or reordering", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const res = await jar.fetch(`${BACKEND_URL}/api/reason`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Cleanup shape: text only (no model/agentName/systemPrompt).
        body: JSON.stringify({ text: DIRTY }),
      });
      expect(res.status).toBe(200);
      const parsed = ReasonResponse.parse(await res.json());
      const out = parsed.text;
      const lower = out.toLowerCase();

      // Routed to the cleanup-class model.
      expect(parsed.model).toBe("qwen3.6-cleanup");

      // (1) NOT an echo of the dirty input.
      expect(out).not.toBe(DIRTY);

      // (2) Fillers / artifacts removed.
      for (const drop of MUST_DROP) {
        expect(lower).not.toContain(drop);
      }

      // (3) Meaning preserved — content words survive.
      for (const keep of MUST_KEEP) {
        expect(lower).toContain(keep);
      }

      // (4) Word ORDER preserved (NOT reordered/paraphrased): the content
      //     anchors appear in the same relative order as the source.
      const positions = MUST_KEEP.map((w) => lower.indexOf(w));
      const sorted = [...positions].sort((a, b) => a - b);
      expect(positions).toEqual(sorted);

      // (5) Cleanup is a TIGHTENING, not an expansion — a paraphrase/summary
      //     tends to balloon or collapse length. Allow generous bounds
      //     (punctuation + capitalization add a little) but flag a rewrite.
      expect(out.length).toBeGreaterThan(DIRTY.length * 0.4);
      expect(out.length).toBeLessThan(DIRTY.length * 1.3);

      // (6) Punctuation/capitalization actually applied (cleanup did work).
      expect(/[.!?]/.test(out)).toBe(true);
      expect(/[A-Z]/.test(out)).toBe(true);
    });
  },
);
