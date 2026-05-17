// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 52 / Plan 52-03 — pin the worker typecheck fixes.
//
// Pre-fix:
//   - typed-queue.ts:52/56 wrapped `Promise<>` around
//     `ReturnType<Queue["add"]>` (which is itself `Promise<Job>`),
//     producing `Promise<Promise<Job>>` and tripping TS2322 against the
//     interface that BullMQ 5.x types now expose.
//   - with-tenant-context.ts:114/133 passed `data.tenant_id` (typed
//     `unknown` since the schema is `z.ZodTypeAny`) directly into the
//     OTel `AttributeValue` slot and the ALS `TenantContext.tenantId:
//     string` slot, tripping TS2322 + TS2769.
//
// Post-fix:
//   - `Awaited<ReturnType<Queue["add"]>>` unwraps the inner promise.
//   - `String(data.tenant_id)` coerces to string at the seam.
//
// Source-pattern test per Phase 51 precedent.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../src/lib");

describe("Plan 52-03 — worker typed-queue + with-tenant-context", () => {
  it("typed-queue.ts wraps return types in `Awaited<>` to unwrap BullMQ's Promise<Job>", () => {
    const src = readFileSync(resolve(SRC, "typed-queue.ts"), "utf8");
    expect(src).toMatch(/Promise<Awaited<ReturnType<Queue\["add"\]>>>/);
    expect(src).toMatch(/Promise<Awaited<ReturnType<Queue\["upsertJobScheduler"\]>>>/);
    // The pre-fix shape must not return.
    expect(src).not.toMatch(/Promise<ReturnType<Queue\["add"\]>>;/);
    expect(src).not.toMatch(/Promise<ReturnType<Queue\["upsertJobScheduler"\]>>;/);
  });

  it("with-tenant-context.ts coerces tenant_id to string at the seam", () => {
    const src = readFileSync(resolve(SRC, "with-tenant-context.ts"), "utf8");
    expect(src).toMatch(/const\s+tenantId:\s*string\s*=\s*String\(data\.tenant_id\)/);
    // Pre-fix direct-use form must not return.
    expect(src).not.toMatch(/const\s+tenantId\s*=\s*data\.tenant_id;/);
  });
});
