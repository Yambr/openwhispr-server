---
quick_id: 260606-hrg
slug: purge-pyannote-litellm
date: 2026-06-06
status: in-progress
---

# Quick 260606-hrg — Purge dead pyannote from litellm-client + observability

## Goal

Server diarization was removed (quick 260606-g90). pyannote is now DEAD — no consumer.
Owner: "pyannote если не используешь выпили / из litellm тоже нахер мусор". Remove every
pyannote ref from litellm-client + observability + their test assertions. Also remove the
now-dead `SPEACHES_DIARIZATION_API_KEY` from the redact list (260606-g90 deleted the env but
left this redaction entry). No version bump, no release.

## Exhaustive ref map (orchestrator-verified; grep to confirm CURRENT lines)
litellm-client:
- src/index.ts:136 — `pyannote: "PYANNOTE_API_KEY"` (provider→env map entry)
- src/config.ts:39 — `pyannote: string | undefined;` (LitellmProviderKeys field)
- src/config.ts:404 — `pyannote: env.PYANNOTE_API_KEY ? ... : undefined,` (resolver)
- src/model-aliases.ts:30 — `KNOWN_PROVIDER_PREFIXES = ["openrouter","groq","pyannote"]` → drop "pyannote"
- src/model-aliases-yaml-test-seam.ts:24 — same array → drop "pyannote"
- src/errors.ts:6 — comment "...GROQ_API_KEY / PYANNOTE_API_KEY in .env" → drop PYANNOTE_API_KEY
observability:
- src/redact.ts:76 — `"PYANNOTE_API_KEY",` → remove
- src/redact.ts:88 — `"*.PYANNOTE_API_KEY",` → remove
- src/redact.ts (SPEACHES_DIARIZATION_API_KEY + *.SPEACHES_DIARIZATION_API_KEY) — ALSO remove
  (dead since 260606-g90 dropped the env; executor missed it). grep to confirm both lines.
test assertions to update (NOT just delete — keep the suites green, drop the pyannote dimension):
- packages/litellm-client/tests/unit/config.test.ts:22,48,52,60,64 — remove the pyannote
  provider-key assertions + the PYANNOTE_API_KEY env fixtures.
- packages/litellm-client/tests/unit/index.test.ts:37,175,190,213,232 — remove `pyannote:` from
  the providerKeys fixtures (the interface no longer has the field).
- packages/litellm-client/tests/unit/{auth-headers,chat-completions-stream-error-drain,r24-injected-request-seam}.test.ts
  — grep pyannote; if a providerKeys literal includes `pyannote:`, drop that key.
- packages/observability/tests/unit/redact.test.ts:75,81,132 — remove PYANNOTE_API_KEY +
  SPEACHES_DIARIZATION_API_KEY from the redaction assertions/fixtures.
bootstrap.ts:11 — comment mentions "pyannote.ai" as an example of a user-URL SSRF target. This is
a GENERIC SSRF-guard comment, NOT a pyannote dependency. LEAVE IT (or reword to drop the example
only if trivial) — do not treat as a dependency.

## Constraints
- After edits: `pnpm --filter @openwhispr/litellm-client typecheck` + `--filter @openwhispr/observability typecheck` clean. Removing the `pyannote` field from LitellmProviderKeys is a TYPE change — the compiler will flag every literal still carrying it; fix all (incl. tests).
- Re-run: litellm-client unit suite (config.test, index.test, auth-headers, etc.) + observability redact.test — all GREEN.
- KNOWN_PROVIDER_PREFIXES drops to ["openrouter","groq"] in BOTH model-aliases.ts AND the test-seam — keep them identical (there may be a self-test asserting they match).
- No type-suppression. English-only. commitlint header ≤100, body ≤100. No --no-verify.
- NO version bump / tag / release. Land atomic commit on main locally; orchestrator handles
  test:all evidence + push.

## Done when
- `grep -rn "pyannote\|PYANNOTE" packages/litellm-client/src packages/observability/src` → 0
  (bootstrap.ts generic SSRF comment may remain if reworded-or-left; everything else gone).
- `grep -rn "SPEACHES_DIARIZATION" packages` → 0 (the redact leftover purged).
- litellm-client + observability typecheck clean; their unit suites GREEN.
