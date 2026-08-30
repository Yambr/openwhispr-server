// SPDX-License-Identifier: FSL-1.1-ALv2
// GET /api/me/spaces — the account-scope guard the desktop calls on every
// sign-in.
//
// WHY THIS EXISTS AT ALL. Upstream OpenWhispr 1.9.x added team spaces (shared
// note folders inside an org workspace, with team-based roles). We do not
// implement that feature and do not intend to. But the desktop does not use
// this endpoint to render a list — it uses it as a DATA-ISOLATION GUARD:
// SyncService.verifyTeamSpacesForAccount asks the server which spaces the
// account may access, then DESTRUCTIVELY purges every locally cached team space
// missing from that answer, so a different account's content can never survive
// a sign-in. The check is deliberately fail-closed: if the server does not
// answer, the client refuses to validate the session at all.
//
// Against a backend without the route that means a 404 → thrown → the session
// never validates → the desktop hangs on its loading screen forever, retrying
// every 30s. Observed in production on 2026-08-30 after the 1.9.3 client
// rollout, with the api logging a steady stream of NotFoundError for this path.
//
// An EMPTY list is the semantically correct answer here, not a placeholder:
// this account genuinely belongs to no team space, because no team space can
// exist on this deployment. The client then finds nothing to purge (there is no
// local team content either) and proceeds to sign in. Personal notes are
// untouched — the purge only considers rows whose kind is "team".
import { drizzle } from "drizzle-orm/node-postgres";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { buildMeSpacesRoutes } from "../../../src/routes/me-spaces.js";
import { getSharedRoutePool } from "../../support/shared-route-pool.js";

const USER = { id: "22222222-2222-2222-2222-222222222222", email: "a@example.com" };
const TENANT = "00000000-0000-0000-0000-000000000000";

// The route reads the space tables now, so it runs against real Postgres.
// The assertions below are unchanged: an account in no team still belongs to no
// space, and that empty list is the answer that lets sign-in proceed.
let pool: Pool;
async function buildApp(opts: { authed: boolean }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // The real app registers this first; without it an AuthError surfaces as a
  // bare 500 and the 401 contract below would be testing the harness, not the
  // route.
  registerErrorHandler(app);
  app.addHook("preHandler", async (req) => {
    if (opts.authed) {
      (req as { user?: unknown }).user = USER;
      // A string, as the auth hook sets it. This fixture used to hand over
      // `{ id: TENANT }`, which only ever passed because the route checked the
      // value for truthiness and never used it; the moment it reached
      // withTenant() the mismatch surfaced as a 500.
      (req as { tenant?: unknown }).tenant = TENANT;
    }
  });
  await app.register(buildMeSpacesRoutes({ db: drizzle(pool) }));
  await app.ready();
  return app;
}

let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
});

beforeAll(async () => {
  pool = await getSharedRoutePool();
}, 180_000);

describe("GET /api/me/spaces", () => {
  beforeEach(() => {
    // each test builds its own app
  });

  it("answers a signed-in caller with an empty space list", async () => {
    app = await buildApp({ authed: true });
    const res = await app.inject({ method: "GET", url: "/api/me/spaces" });

    expect(res.statusCode).toBe(200);
    // The desktop reads `res.data` (DataWrap<MySpace[]>) and maps over it, so
    // the array must be present and iterable — `{}` or `null` would throw in
    // the client exactly where the 404 does today.
    expect(res.json()).toEqual({ data: [] });
  });

  it("rejects an anonymous caller instead of leaking a well-formed answer", async () => {
    // Same defensive 401 the other account-scoped routes use: the global
    // dualAuthHook should already have rejected this, but the route must not
    // depend on that to avoid answering unauthenticated callers.
    app = await buildApp({ authed: false });
    const res = await app.inject({ method: "GET", url: "/api/me/spaces" });

    expect(res.statusCode).toBe(401);
  });
});
