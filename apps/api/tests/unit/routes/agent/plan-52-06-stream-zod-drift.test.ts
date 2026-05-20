// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 52 / Plan 52-06 — pin three type-system-only fixes on
// agent/stream.ts that surface under `exactOptionalPropertyTypes: true`.
//
//   stream.ts:153 (TS2375) — explicit body annotation said
//   `model?: string` (bare-optional), but zod's `.optional()` infers
//   `string | undefined`. Drop the annotation; let zod's parse result
//   drive the body type.
//
//   stream.ts:217 → translate-tools.ts (TS2345) — `LegacyTool.description`
//   was bare-optional, mismatching the zod-inferred body shape. Make the
//   `| undefined` explicit on the interface.
//
//   stream.ts:252 (TS2322) — `ChatMessage.content: unknown` (wide
//   wire-shape for future multimodal) was passed directly to the
//   litellm-client interface which narrows to `content: string`. Coerce
//   non-string content via JSON.stringify at the boundary; upstream
//   OpenAI / LiteLLM accepts both string and parts-array forms.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STREAM = resolve(__dirname, "../../../../src/routes/agent/stream.ts");
const TRANSLATE = resolve(__dirname, "../../../../src/routes/agent/translate-tools.ts");

describe("Plan 52-06 — agent/stream zod drift fixes", () => {
  const stream = readFileSync(STREAM, "utf8");
  const translate = readFileSync(TRANSLATE, "utf8");

  it("stream.ts uses the zod-type-provider-typed req.body (WR-04: no inline re-parse)", () => {
    // WR-04 (Phase 65) — the inline handler-side re-parse is dropped; the
    // declarative `schema.body` + `withTypeProvider` give a typed,
    // already-validated `req.body`.
    const code = stream
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    expect(code).toMatch(/const\s+body\s*=\s*req\.body/);
    expect(code).not.toMatch(/AgentStreamRequestSchema\.parse\(/);
    // Pre-fix annotation form must not return.
    expect(stream).not.toMatch(
      /const\s+body:\s*\{\s*messages:\s*AgentChatMessage\[\];\s*model\?:\s*string;/,
    );
  });

  it("LegacyTool.description carries explicit `| undefined`", () => {
    expect(translate).toMatch(/description\?:\s*string\s*\|\s*undefined/);
  });

  it("stream.ts stringifies non-string content before passing to litellm-client", () => {
    expect(stream).toMatch(
      /typeof\s+m\.content\s*===\s*"string"\s*\?\s*m\.content\s*:\s*JSON\.stringify\(m\.content\)/,
    );
    expect(stream).toMatch(/messages:\s*llmMessages\s*,/);
  });
});
