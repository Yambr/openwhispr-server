// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick-task 260528-370 — integration test for the `GET /api/health` build
// info widening.
//
// Covers PLAN.md §5.2 (3 cases I1..I3):
//   I1 — explicit buildInfo opts threaded through buildApp; response carries
//        version / commit_sha / image_tag.
//   I2 — no buildInfo opts; parseBuildInfoFromEnv() fallback yields the
//        BUILD_INFO_UNKNOWN triplet.
//   I3 — migrationsCheck returns false alongside buildInfo present (regression
//        check that widening did NOT break migrations_completed).
//
// Mounts ONLY the probes routes onto a bare Fastify instance — no testcontainers,
// no Postgres, no auth, no real registerProbes via buildApp. Matches the existing
// apps/api/tests/unit/routes/probes.test.ts pattern. The buildApp opts-threading
// is exercised by the existing apps/api/tests/unit/index.test.ts harness.

import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { BUILD_INFO_UNKNOWN, parseBuildInfoFromEnv } from "../../src/config/build-info.js";
import { registerProbes } from "../../src/routes/probes.js";

async function makeApp(opts: {
  buildInfo?: { version: string; commitSha: string; imageTag: string };
  migrationsCheck?: () => Promise<boolean>;
}) {
  const app = Fastify({ logger: false });
  await registerProbes(app, {
    ...(opts.buildInfo ? { buildInfo: opts.buildInfo } : {}),
    ...(opts.migrationsCheck ? { migrationsCheck: opts.migrationsCheck } : {}),
  });
  await app.ready();
  return app;
}

describe("/api/health build-info widening (260528-370)", () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("I1: returns 200 with version / commit_sha / image_tag when buildInfo is wired", async () => {
    app = await makeApp({
      buildInfo: {
        version: "1.0.14",
        commitSha: "deadbeefcafebabedeadbeefcafebabedeadbeef",
        imageTag: "v1.0.14",
      },
      migrationsCheck: async () => true,
    });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ok",
      migrations_completed: true,
      version: "1.0.14",
      commit_sha: "deadbeefcafebabedeadbeefcafebabedeadbeef",
      image_tag: "v1.0.14",
    });
  });

  it("I2: returns the BUILD_INFO_UNKNOWN triplet when buildInfo opt is omitted", async () => {
    // Sanity guard: this case asserts that the route handler defaults to
    // BUILD_INFO_UNKNOWN when deps.buildInfo is undefined. The parser
    // fallback at buildApp-level is exercised by parseBuildInfoFromEnv()'s
    // unit-level default-arg smoke check; here we test only the route layer.
    app = await makeApp({
      migrationsCheck: async () => true,
    });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ok",
      migrations_completed: true,
      version: BUILD_INFO_UNKNOWN,
      commit_sha: BUILD_INFO_UNKNOWN,
      image_tag: BUILD_INFO_UNKNOWN,
    });
  });

  it("I3: regression — migrations_completed:false remains accurate alongside build-info widening", async () => {
    app = await makeApp({
      buildInfo: {
        version: "1.0.14",
        commitSha: "deadbeef",
        imageTag: "1.0.14",
      },
      migrationsCheck: async () => false,
    });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ok",
      migrations_completed: false,
      version: "1.0.14",
      commit_sha: "deadbeef",
      image_tag: "1.0.14",
    });
  });

  it("smoke: parseBuildInfoFromEnv() in default-arg form produces a shape suitable for thread-through", () => {
    // Cross-check: the helper used by buildApp at boot returns the same
    // BuildInfo shape registerProbes expects. Defensive against type drift
    // between the parser and the route's `deps.buildInfo` slot.
    const parsed = parseBuildInfoFromEnv({});
    expect(parsed.version).toBe(BUILD_INFO_UNKNOWN);
    expect(parsed.commitSha).toBe(BUILD_INFO_UNKNOWN);
    expect(parsed.imageTag).toBe(BUILD_INFO_UNKNOWN);
  });
});
