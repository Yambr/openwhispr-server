// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase r34 / quick — canonical `Then "the response status is {int}"`
// step binding, plus the per-tenant response register the canonical
// handler reads from.
//
// Several CJM step files previously each declared their own copy of this
// step (tenant-settings-override, rls-cross-tenant,
// agent-stream, web-search, session-refresh, byok-key-rotation,
// byok-corporate-litellm). playwright-bdd refuses to load the suite
// with `Error: Multiple definitions matched scenario step`, so the
// entire e2e-cjm CI lane is signal-free.
//
// This file is the SINGLE source of truth for the step. Per-feature
// step files now call `recordLastResponse(tenantId, ...)` from inside
// their existing When handlers — in ADDITION to their local
// `stateFor(tenantId)` writes, which other per-feature Then handlers
// continue to consume. This intentionally avoids the playwright-bdd
// `ctx` / `this` World ambiguity (Playwright-style steps expose the
// world only via `this`, which arrow handlers cannot bind) by keying
// shared response state on the `tenantId` fixture every step already
// destructures.
//
// Per `feedback_cjm_steps_need_unit_tests`: sibling vitest unit coverage
// lives at `__tests__/response-shared.steps.test.ts`.

import { expect, Then } from "../../support/fixtures";

/**
 * Minimal shape captured by every per-feature When handler that issues
 * an HTTP call. Concrete handlers may also record a `body` / `rawText`
 * via their local `stateFor()` map; only the status is required by the
 * canonical Then below.
 */
export interface SharedResponseSnapshot {
  status?: number;
  body?: unknown;
  rawText?: string;
  headers?: Headers;
}

const lastResponseByTenant = new Map<string, SharedResponseSnapshot>();

/**
 * Mirror-write helper called from each per-feature When handler after
 * its existing `s.status = res.status` site. Preserves backwards
 * compatibility with the per-file `stateFor(tenantId).status` reads
 * used by feature-local Then handlers (body shape, code field, raw
 * text scan, etc.).
 */
export function recordLastResponse(tenantId: string, snapshot: SharedResponseSnapshot): void {
  lastResponseByTenant.set(tenantId, snapshot);
}

/**
 * Test-only helper: exposed so the sibling vitest unit can drive the
 * canonical Then without booting playwright-bdd. NOT for production
 * step-file consumption.
 */
export function _getLastResponseForTest(tenantId: string): SharedResponseSnapshot | undefined {
  return lastResponseByTenant.get(tenantId);
}

/**
 * Test-only helper: clears the per-tenant register between unit-test
 * scenarios. NOT for production step-file consumption.
 */
export function _resetForTest(): void {
  lastResponseByTenant.clear();
}

function requireSnapshot(tenantId: string): SharedResponseSnapshot {
  const snap = lastResponseByTenant.get(tenantId);
  if (!snap) {
    throw new Error(
      `step ordering: no response captured for tenant ${tenantId}. ` +
        `Each per-feature When handler MUST call recordLastResponse(tenantId, { status, body, rawText }) ` +
        `after its fetch. See steps/shared/response-shared.steps.ts.`,
    );
  }
  return snap;
}

Then(
  "the response status is {int}",
  async function (this, { tenantId }: { tenantId: string }, expected: number) {
    const snap = requireSnapshot(tenantId);
    if (typeof snap.status !== "number") {
      throw new Error(`recorded snapshot for tenant ${tenantId} has no numeric status`);
    }
    expect(snap.status).toBe(expected);
  },
);

Then(
  /^the body is the typed envelope shape "\{ error: \{ code, message \} \}"$/,
  async function (this, { tenantId }: { tenantId: string }) {
    const snap = requireSnapshot(tenantId);
    // Body MAY be the parsed object, or — when the per-feature handler only
    // mirror-wrote rawText (e.g. NDJSON streaming) — must be parsed from
    // rawText. Mirror the per-file fallback behaviour the dupes implemented.
    let body: unknown = snap.body;
    if (body === undefined && typeof snap.rawText === "string") {
      try {
        body = JSON.parse(snap.rawText);
      } catch {
        body = snap.rawText;
      }
    }
    expect(body).toMatchObject({
      error: expect.objectContaining({
        code: expect.any(String),
        message: expect.any(String),
      }),
    });
  },
);

Then(
  "the body MUST NOT contain a Node.js stack trace",
  async function (this, { tenantId }: { tenantId: string }) {
    const snap = requireSnapshot(tenantId);
    const haystack = snap.rawText ?? (typeof snap.body === "string" ? snap.body : "");
    expect(haystack).not.toMatch(/at Object\.<anonymous>|node_modules\//);
  },
);

Then(
  "the error code matches {string}",
  async function (this, { tenantId }: { tenantId: string }, regex: string) {
    const snap = requireSnapshot(tenantId);
    const code = (snap.body as { error?: { code?: string } } | undefined)?.error?.code ?? "";
    expect(code).toMatch(new RegExp(regex));
  },
);
