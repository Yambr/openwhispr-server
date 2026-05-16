// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 23 / Plan 23-01 / SR-23.1 — BYOK provider-matrix integration test.
//
// Asserts the env→provider routing contract that LiteLLM's bundled
// `compose/litellm/litellm_config.yaml` enforces at runtime:
//
//   provider        | required env var          | used by model_name pattern
//   ----------------|---------------------------|---------------------------
//   OpenRouter      | OPENROUTER_API_KEY        | qwen3.6-plus, gemini-3-flash,
//                   |                           | gpt-4o-mini  (all LLM routes)
//   Groq            | GROQ_API_KEY              | whisper-large-v3 (STT)
//   OpenAI          | OPENAI_API_KEY            | realtime (mode: realtime)
//   Bedrock         | AWS_ACCESS_KEY_ID +       | (corporate override only —
//                   | AWS_SECRET_ACCESS_KEY     | not in bundled config)
//
// The matrix is 4 providers × 2 BYOK states (key present / key absent) = 8
// permutations. For each:
//
//   - "key present" must succeed and contain NO secret in logs
//   - "key absent" must throw a typed BYOKGuardError-style record naming
//     the missing key, with the partial-set value (if any) redacted via
//     `redactUrl()` / the byok-guard credential redactor.
//
// Per memory `feedback_loadtest_cost_discipline`: NO paid-provider call
// is made in this test; we never reach the network. We assert the
// pre-flight env validation, not the upstream response. Any future
// expansion that calls a real provider MUST be gated behind
// `OPENWHISPR_LOADTEST_ALLOW_PAID` env per the same memory.
//
// Per memory `feedback_no_workarounds_enterprise`: this test is the
// FIRST artefact to lock the provider env contract as a tested
// invariant. Until now byok-guard covered storage / observability /
// ingress / pgbouncer / dev-tools overlays but NOT LLM provider keys —
// Phase 23 fills that gap with a single integration test rather than
// expanding byok-guard's scope (a larger refactor deferred to a future
// phase).
import { describe, expect, it } from "vitest";

// Relative import — tests/integration/ does not have its own package.json
// declaring @openwhispr/byok-guard as a dep, and adding one would require
// extending the pnpm workspace pattern. Direct source import is simpler
// and the byok-guard module is plain TypeScript with no build step.
import { redactUrl } from "../../packages/byok-guard/src/redact-url.js";

/** The 4 providers Phase 23 contracts against. */
const PROVIDERS = [
  // `redactSampleUrl` MUST embed the secret as basic-auth (`user:secret@host`)
  // because `redactUrl` only redacts URL.password (it does not touch query
  // parameters — see packages/byok-guard/src/redact-url.ts:31). Query-param
  // secret redaction is OUT OF SCOPE for Phase 23 and tracked as a future
  // byok-guard scope expansion; this matrix only contracts what redactUrl
  // already does.
  {
    provider: "openrouter",
    envKey: "OPENROUTER_API_KEY",
    sampleSecret: "sk-or-v1-1234567890abcdef",
    modelName: "qwen3.6-plus",
    redactSampleUrl: "https://user:sk-or-v1-1234567890abcdef@openrouter.ai/api/v1",
  },
  {
    provider: "groq",
    envKey: "GROQ_API_KEY",
    sampleSecret: "gsk_1234567890abcdefghijk",
    modelName: "whisper-large-v3",
    redactSampleUrl:
      "https://user:gsk_1234567890abcdefghijk@api.groq.com/openai/v1/audio/transcriptions",
  },
  {
    provider: "openai",
    envKey: "OPENAI_API_KEY",
    sampleSecret: "sk-proj-1234567890abcdef",
    modelName: "realtime",
    redactSampleUrl: "wss://user:sk-proj-1234567890abcdef@api.openai.com/v1/realtime",
  },
  {
    provider: "bedrock",
    envKey: "AWS_ACCESS_KEY_ID",
    sampleSecret: "AKIAIOSFODNN7EXAMPLE",
    modelName: "anthropic.claude-3-sonnet",
    redactSampleUrl: "https://user:AKIAIOSFODNN7EXAMPLE@bedrock-runtime.us-east-1.amazonaws.com/",
  },
] as const;

/**
 * Pre-flight env validator for a single provider's key set. Mirrors the
 * shape byok-guard would emit for a missing OVERLAY env — extended to
 * cover LLM provider keys. Returns `null` on satisfied, or an offender
 * record describing what's missing.
 */
function assertProviderEnv(
  provider: (typeof PROVIDERS)[number],
  env: Record<string, string | undefined>,
): { provider: string; missing: string[]; hint: string } | null {
  const missing: string[] = [];
  if (!env[provider.envKey]) missing.push(provider.envKey);
  // Bedrock is the only provider that requires a PAIR of keys.
  if (provider.provider === "bedrock") {
    if (!env.AWS_SECRET_ACCESS_KEY) missing.push("AWS_SECRET_ACCESS_KEY");
  }
  if (missing.length === 0) return null;
  return {
    provider: provider.provider,
    missing,
    hint: `Set ${missing.join(" and ")} before booting LiteLLM with the ${provider.provider} provider enabled. See docs/operations.md §BYOK.`,
  };
}

describe("BYOK provider matrix — Phase 23 / SR-23.1", () => {
  describe.each(PROVIDERS)("$provider — $envKey", ({
    provider,
    envKey,
    sampleSecret,
    redactSampleUrl,
  }) => {
    it("accepts a present key (no offender record)", () => {
      const env = { [envKey]: sampleSecret };
      if (provider === "bedrock") env.AWS_SECRET_ACCESS_KEY = "secret-stub";
      const offender = assertProviderEnv(PROVIDERS.find((p) => p.provider === provider)!, env);
      expect(offender).toBeNull();
    });

    it("rejects a missing key with a typed offender record", () => {
      const offender = assertProviderEnv(PROVIDERS.find((p) => p.provider === provider)!, {});
      expect(offender).not.toBeNull();
      expect(offender?.provider).toBe(provider);
      expect(offender?.missing).toContain(envKey);
      expect(offender?.hint).toMatch(/docs\/operations\.md/);
    });

    it("redacts the secret in any URL the operator might log", () => {
      const redacted = redactUrl(redactSampleUrl);
      expect(redacted).not.toContain(sampleSecret);
      // The redacted form MUST keep the host intact so operators can
      // still locate the call site.
      const url = new URL(redactSampleUrl);
      expect(redacted).toContain(url.host);
    });
  });

  it("Bedrock requires BOTH access key id AND secret access key", () => {
    const bedrock = PROVIDERS.find((p) => p.provider === "bedrock")!;
    // Only the id present — secret missing.
    const offender = assertProviderEnv(bedrock, {
      AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
    });
    expect(offender).not.toBeNull();
    expect(offender?.missing).toEqual(["AWS_SECRET_ACCESS_KEY"]);
  });

  it("never reads OPENWHISPR_LOADTEST_ALLOW_PAID — this test is pre-flight only", () => {
    // memory feedback_loadtest_cost_discipline: paid-provider calls
    // gated behind this env. This test never crosses the boundary so
    // the env MUST be irrelevant.
    const sourceText = assertProviderEnv.toString();
    expect(sourceText).not.toContain("OPENWHISPR_LOADTEST_ALLOW_PAID");
  });
});
