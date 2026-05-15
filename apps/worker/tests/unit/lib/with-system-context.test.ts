// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 Plan 06-07 — GREEN tests for withSystemContext (D-W2).
import type { Job } from "bullmq";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { SYSTEM_TENANT_SENTINEL, withSystemContext } from "../../../src/lib/with-system-context.js";
import { getTenantContext, tenantAls } from "../../../src/lib/with-tenant-context.js";

function fakeJob(data: unknown, queueName = "system-queue", id = "sys-1"): Job {
  return { data, queueName, id } as unknown as Job;
}

describe("withSystemContext (D-W2)", () => {
  it("invokes handler with parsed data when a schema is provided", async () => {
    const schema = z.object({ since: z.string() });
    const handler = vi.fn(async () => {});
    const wrapped = withSystemContext(schema, handler);
    await wrapped(fakeJob({ since: "2026-01-01T00:00:00Z" }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toEqual({ since: "2026-01-01T00:00:00Z" });
  });

  it("rejects on bad payload when schema is provided", async () => {
    const schema = z.object({ since: z.string() });
    const handler = vi.fn();
    const wrapped = withSystemContext(schema, handler);
    await expect(wrapped(fakeJob({ since: 123 }))).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("supports null schema for empty-payload jobs (partman-maintenance)", async () => {
    let observed: unknown = "unset";
    const wrapped = withSystemContext(null, async (data) => {
      observed = data;
    });
    await wrapped(fakeJob({}));
    expect(observed).toEqual({});
  });

  it("sets AsyncLocalStorage mode='system' with the sentinel tenant id", async () => {
    let seen: { tenantId: string; mode: string } | undefined;
    const wrapped = withSystemContext(null, async () => {
      const store = getTenantContext();
      if (store) seen = { tenantId: store.tenantId, mode: store.mode };
    });
    await wrapped(fakeJob({}));
    expect(seen).toEqual({ tenantId: SYSTEM_TENANT_SENTINEL, mode: "system" });
  });

  it("attaches pino MDC tag mode: 'system' to the handler's failure log line", async () => {
    const lines: Array<Record<string, unknown>> = [];
    const captureLogger = pino(
      { level: "trace" },
      {
        write: (chunk: string) => {
          for (const ln of chunk.split("\n").filter(Boolean)) {
            try {
              lines.push(JSON.parse(ln));
            } catch {
              /* ignore */
            }
          }
        },
      },
    );
    const wrapped = withSystemContext(
      null,
      async () => {
        throw new Error("nope");
      },
      { logger: captureLogger },
    );
    await expect(wrapped(fakeJob({}, "q", "sys-42"))).rejects.toThrow("nope");
    const errLine = lines.find((l) => l.msg === "system job failed");
    expect(errLine).toBeTruthy();
    expect(errLine?.mode).toBe("system");
    expect(errLine?.job_id).toBe("sys-42");
  });

  it("does NOT execute SELECT set_config('app.tenant_id', ...) — verified by source contract", async () => {
    // red-baseline: 2026-05-15 (Phase 18.1 F2) — see commit body for failure output
    // The HOF source is deterministic; we assert no GUC is bound by reading
    // its source and confirming the absence of set_config('app.tenant_id'...).
    const fs = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(
      new URL("../../../src/lib/with-system-context.ts", import.meta.url),
    );
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`source-contract path moved: ${sourcePath}`);
    }
    const src = await fs.promises.readFile(sourcePath, "utf8");
    // POSITIVE — prove the file was actually loaded (no silent empty-string pass).
    expect(src).toMatch(/withSystemContext/);
    // NEGATIVE — the prod invariant (T-04): never bind app.tenant_id GUC.
    expect(src).not.toMatch(/set_config\('app\.tenant_id'/);
  });

  it("ALS context is cleared after the handler returns", async () => {
    const wrapped = withSystemContext(null, async () => {});
    await wrapped(fakeJob({}));
    expect(tenantAls.getStore()).toBeUndefined();
  });

  it("rethrows handler errors after recording the span exception", async () => {
    const boom = new Error("system-boom");
    const wrapped = withSystemContext(null, async () => {
      throw boom;
    });
    await expect(wrapped(fakeJob({}))).rejects.toBe(boom);
  });

  it("falls back to 'unknown' job_id when job.id is undefined", async () => {
    let seenJobId: string | undefined;
    const wrapped = withSystemContext(null, async () => {
      const store = getTenantContext();
      seenJobId = store?.jobId;
    });
    await wrapped({ data: {}, queueName: "q" } as unknown as Job);
    expect(seenJobId).toBe("unknown");
  });

  it("returns the handler's return value (generic R)", async () => {
    const wrapped = withSystemContext(null, async () => 42 as const);
    const r = await wrapped(fakeJob({}));
    expect(r).toBe(42);
  });

  it("substitutes {} when job.data is undefined and the schema is provided", async () => {
    const schema = z.object({}).strict();
    const wrapped = withSystemContext(schema, async (data) => {
      expect(data).toEqual({});
    });
    await wrapped({ queueName: "q", id: "j" } as unknown as Job);
  });
});
