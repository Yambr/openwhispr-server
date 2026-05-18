// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 52 / Plan 52-04b — pin the cascade of fixes revealed after the
// 52-01..52-08 plans landed. The first-tsc-error short-circuit had
// masked these on `main` pre-Phase-52.
//
//   client-id-upsert.ts (7 cascading TS2344) — generic constraint was
//   `T extends Record<string, unknown>` but every caller passed a
//   typed-property-bag (CloudConversationRow etc.) that doesn't
//   auto-satisfy the index-signature rule. Constraint relaxed to
//   `T extends object` — purely cosmetic, function never indexes T.
//
//   locale.ts (TS2345) — `String.split()[0]` is `string | undefined`
//   under `noUncheckedIndexedAccess`. Default to `""` so
//   `isSupported("")` returns false (fall-through to `"en"`).
//
//   realtime.ts (TS2769) — `@fastify/http-proxy` 11.4.4 dropped
//   `wsClientOptions.rewriteRequestHeaders` from its types. Runtime
//   honors the field; type ignored via `@ts-expect-error issue-52:`
//   per Phase 08.5 e2e proof.
//
//   tokens/_call-provider.ts (TS2379) — `exactOptionalPropertyTypes:
//   true` refuses `body: undefined` in RequestInit. Conditional
//   spread.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../src");

describe("Plan 52-04b — api routes cascade typecheck", () => {
  it("client-id-upsert relaxes generic constraint to `object`", () => {
    const src = readFileSync(resolve(SRC, "lib/client-id-upsert.ts"), "utf8");
    expect(src).toMatch(/createOrReturnExisting<T\s+extends\s+object>/);
    // Pre-fix Record-constraint must not return.
    expect(src).not.toMatch(/createOrReturnExisting<T\s+extends\s+Record<string,\s*unknown>>/);
  });

  it("locale.ts defaults split[0] to empty string", () => {
    const src = readFileSync(resolve(SRC, "routes/locale.ts"), "utf8");
    expect(src).toMatch(/split\(\/\[-_\]\/\)\[0\]\s*\?\?\s*""/);
  });

  it("realtime.ts encodes the fastify-http-proxy ws-types drift via a typed LegacyWsClientOptions extension (NOT a blanket @ts-expect-error)", () => {
    const src = readFileSync(resolve(SRC, "routes/realtime.ts"), "utf8");
    // Plan 53 superseded the Plan 52 `@ts-expect-error issue-52:`
    // approach with a localized typed extension — LOCKER-02 prefers a
    // narrow `as` cast on a typed extension over a sprawling
    // suppression. The runtime contract (closure shape `(headers,
    // request) => newHeaders`) is unchanged from Phase 08.5 e2e proof;
    // only the static typing approach evolved.
    expect(src).toMatch(/type\s+LegacyWsClientOptions\s*=/);
    expect(src).toMatch(/rewriteRequestHeaders\?:\s*\(/);
    // The legacy `@ts-expect-error issue-52:` MUST NOT return — it
    // would mask a future genuine wsClientOptions API regression.
    expect(src).not.toMatch(/@ts-expect-error\s+issue-52:/);
  });

  it("tokens/_call-provider conditionally spreads body to comply with exactOptionalPropertyTypes", () => {
    const src = readFileSync(resolve(SRC, "routes/tokens/_call-provider.ts"), "utf8");
    expect(src).toMatch(
      /\.\.\.\(opts\.body\s*!==\s*undefined\s*\?\s*\{\s*body:\s*opts\.body\s*\}\s*:\s*\{\}\)/,
    );
    // Pre-fix direct `body: opts.body` must not return.
    expect(src).not.toMatch(/^\s*body:\s*opts\.body\s*,\s*$/m);
  });
});
