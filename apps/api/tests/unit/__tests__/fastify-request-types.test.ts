// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 19 / Plan 01 / Task 01 — SR-19.2 typecheck contract (RED).
//
// Background (SERVER-ERRORS.md Entry 2, CONTEXT.md D-07):
//   `req.user` and `req.tenant` are populated by `dualAuthHook` at runtime
//   on every authenticated route. The Fastify type system has no way to
//   know this — decorators set at runtime do NOT change the static type of
//   `FastifyRequest` without an explicit `declare module 'fastify'` block.
//
// Phase 19-01 mandates a **dedicated, canonical** ambient module
// augmentation at `apps/api/src/types/fastify.d.ts`. Originally the
// `req.user` / `req.tenant` augmentations lived inline in middleware
// files; consumers (route handlers) had to transitively import those
// modules to pick up the types. The canonical `.d.ts` file is loaded
// by tsc via `include: src/**/*.ts` without any consumer needing to
// import a middleware file — closing the Phase 14-04 typecheck-deferral
// root cause (deferred-items §14-04). (Phase 34 retired the
// `tenantPlugin` and its inline `req.tenantId: string` augmentation;
// only the `req.user` / `req.tenant` shapes remain.)
//
// RED proof (this test file at HEAD = 866c514):
//   1. `apps/api/src/types/fastify.d.ts` does NOT exist on disk — the
//      `existsSync` assertion below fails.
//   2. No GREEN sibling has yet centralized the contract; the inline
//      augmentations remain the only source of `req.user`/`req.tenant`
//      types — this test exists to drive the GREEN landing in 19-01-02.
//
// GREEN target (19-01-02): the dedicated `.d.ts` file exists with the
// canonical `FastifyRequest { user?, tenant? }` interface extension
// using types sourced from `apps/api/src/middleware/dual-auth.ts`
// (`SessionResult["user"]`) — same shape as inline, but extracted to
// a single canonical location that every route handler picks up
// automatically via the package-wide `include: src/**/*.ts`.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyRequest } from "fastify";
import { describe, expect, expectTypeOf, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FASTIFY_DTS_PATH = path.resolve(__dirname, "..", "..", "..", "src", "types", "fastify.d.ts");

describe("SR-19.2 FastifyRequest user/tenant typecheck contract", () => {
  it("canonical apps/api/src/types/fastify.d.ts exists (D-07)", () => {
    expect(
      existsSync(FASTIFY_DTS_PATH),
      `Expected canonical Fastify module augmentation at ${FASTIFY_DTS_PATH} per CONTEXT.md D-07 / SERVER-ERRORS Entry 2.`,
    ).toBe(true);
  });

  it("canonical .d.ts file contains declare module 'fastify' with FastifyRequest interface (D-07)", () => {
    if (!existsSync(FASTIFY_DTS_PATH)) {
      // Defer the structural assertion to GREEN; the existsSync test
      // above is the RED gate. Without short-circuiting here vitest
      // would throw ENOENT and obscure the contract-test signal.
      throw new Error(`canonical .d.ts missing (see prior test); RED`);
    }
    const src = readFileSync(FASTIFY_DTS_PATH, "utf8");
    expect(src).toMatch(/declare module ["']fastify["']/);
    expect(src).toMatch(/interface FastifyRequest/);
    expect(src).toMatch(/user\?:/);
    expect(src).toMatch(/tenant\?:/);
  });

  it("FastifyRequest['user'] is typed (optional auth user shape) — D-07 contract", () => {
    // expectTypeOf validates the contract is reachable from a fresh
    // FastifyRequest import without first importing a middleware
    // module. The inline augmentations in dual-auth.ts/tenant.ts
    // contribute to this contract today; the GREEN landing of
    // apps/api/src/types/fastify.d.ts makes the contract canonical.
    expectTypeOf<FastifyRequest["user"]>().toMatchTypeOf<
      { id: string; email: string } | undefined
    >();
  });

  it("FastifyRequest['tenant'] is typed (optional tenant identifier) — D-07 contract", () => {
    expectTypeOf<FastifyRequest["tenant"]>().toMatchTypeOf<string | undefined>();
  });
});
