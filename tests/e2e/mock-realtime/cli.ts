// SPDX-License-Identifier: Apache-2.0
// Phase 04 / Plan 07 / Task 1 — CLI entrypoint for the mock-realtime
// container. Boots `startMockRealtimeServer` on `PORT` (default 8765),
// host 0.0.0.0 so peer compose services can reach it.
//
// Excluded from coverage in vitest.config.ts: this file is bootstrap
// glue with no branches the test suite can exercise without spawning
// a child process. The behavior covered here (port binding, URL
// construction) is exhaustively tested through `server.ts` directly.

import { startMockRealtimeServer } from "./server.js";

const port = Number(process.env.PORT ?? 8765);

startMockRealtimeServer({ port, host: "0.0.0.0" })
  .then((handle) => {
    // eslint-disable-next-line no-console
    console.log(`mock-realtime listening on ${handle.url}`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("mock-realtime failed to start:", err);
    process.exit(1);
  });
