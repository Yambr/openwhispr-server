// SPDX-License-Identifier: Apache-2.0
// tests/e2e — vitest globalSetup.
//
// Brings the docker-compose stack up ONCE for the whole e2e suite,
// runs it through every test file, then tears down + drops volumes
// regardless of pass/fail. The compose stack is the unit of e2e
// fixture; spinning it up per-test would make the suite take an hour.
//
// Self-signed Traefik dev cert: the test process disables TLS
// verification for its OWN fetch calls. Production TLS chain
// validation is exercised by the actual desktop client; this gate
// exists so the e2e test agent can dial https://api.localhost without
// trusting `compose/traefik/certs/local.crt` system-wide.

import { bringStackDown, bringStackUp, waitForApiHealth } from "./compose-helper.js";

export default async function globalSetup(): Promise<() => Promise<void>> {
  // Self-signed cert handling — scope to the test process only.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  if (process.env.E2E !== "1") {
    // Defensive: vitest.config.ts already filters tests on E2E=1, but
    // a direct `pnpm vitest tests/e2e` invocation skips the include
    // gate. Bail loudly so nobody accidentally runs `compose up` from
    // an unrelated test runner.
    console.log("[e2e/setup] E2E env flag not set — skipping compose stack-up.");
    return async () => {
      /* no-op teardown */
    };
  }

  console.log("[e2e/setup] Bringing docker compose stack up (default + contract-test)...");
  await bringStackUp();
  console.log("[e2e/setup] Compose up complete; probing api health via Traefik...");
  await waitForApiHealth(120_000);
  console.log("[e2e/setup] Stack ready at https://api.localhost.");

  return async () => {
    console.log("[e2e/setup] Tearing stack down (down -v)...");
    await bringStackDown();
  };
}
