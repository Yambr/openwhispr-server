// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-05b / BUG-55-05-SETUP-ADMIN-ROUTE-UNWIRED — buildApp must
// thread `setupAdmin` through to buildAllRoutes so /api/setup/admin is
// actually registered in production.
//
// Background (deferred-items.md BUG-55-05):
// `BuildAppOptions` did not declare a `setupAdmin` field, and the
// production bootstrap in apps/api/src/index.ts never constructed an
// owner pool + signUpEmail adapter — so `buildAllRoutes` (which only
// registers setup-admin when `deps.setupAdmin` is truthy) silently
// dropped the route. Every prod boot 404'd POST /api/setup/admin and
// the wizard's submit step was fully dead-ended.
//
// This file follows the same shape as
// `build-app-diarization-wiring.test.ts` (the canonical CR-01 wiring
// regression). When supplied with `setupAdmin`, buildApp() MUST
// register the route; when omitted, the route MUST be absent.

import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { buildApp } from "../../../src/index.js";
import type { AuthLike } from "../../../src/middleware/dual-auth.js";
import type {
  SetupAdminSignUpCall,
  SetupAdminSignUpEmail,
  SetupAdminSignUpResult,
} from "../../../src/routes/setup-admin.js";

function fakeDb(): TransactionalDb<ExecutableTx> {
  return {
    async transaction<T>(cb: (tx: ExecutableTx) => Promise<T>): Promise<T> {
      return cb({
        async execute() {
          return { rows: [] } as unknown as never;
        },
      } as unknown as ExecutableTx);
    },
  } as unknown as TransactionalDb<ExecutableTx>;
}

function fakeAuth(): AuthLike {
  return {
    api: { getSession: async () => null },
    handler: async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  } as unknown as AuthLike;
}

// Stub Pool — `printRoutes()` does not invoke `.query()`, so a bare
// object satisfies the structural type for registration-time assertions.
function fakeOwnerPool(): Pool {
  return {
    query: async () => ({ rows: [] }),
  } as unknown as Pool;
}

const fakeSignUpEmail: SetupAdminSignUpEmail = async (
  _call: SetupAdminSignUpCall,
): Promise<SetupAdminSignUpResult> => ({
  data: { user: { id: "fake-id", email: "fake@example.test" } },
  error: null,
});

describe("buildApp — BUG-55-05 setup-admin wiring", () => {
  it("registers POST /api/setup/admin in the route tree when setupAdmin is supplied", async () => {
    const app = await buildApp({
      db: fakeDb(),
      auth: fakeAuth(),
      setupAdmin: {
        ownerPool: fakeOwnerPool(),
        signUpEmail: fakeSignUpEmail,
      },
    });
    try {
      const tree = app.printRoutes({ commonPrefix: false });
      expect(tree).toContain("/api/setup/admin");
    } finally {
      await app.close();
    }
  });

  it("does NOT register /api/setup/admin when setupAdmin is omitted", async () => {
    const app = await buildApp({
      db: fakeDb(),
      auth: fakeAuth(),
    });
    try {
      const tree = app.printRoutes({ commonPrefix: false });
      expect(tree).not.toContain("/api/setup/admin");
    } finally {
      await app.close();
    }
  });
});
