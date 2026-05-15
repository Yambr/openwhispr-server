// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 18.1.1 / Plan 03 / Task D-08 — apps/api vitest 4 setupFiles entry.
//
// Re-exports the shared tools/testcontainer-reaper-setup helper that
// installs SIGINT/SIGTERM testcontainer-reaper handlers (formerly inlined
// here, now extracted for apps/worker + packages/data reuse).
//
// `installSignalHook()` is module-scoped idempotent; re-invocations from
// other setup files are safe no-ops.

// Phase 18.1.2 / Plan 02 / D-03 + pitfall §1 — opt-in to the testcontainers
// `withReuse()` daemon-side label hash. MUST be set BEFORE any testcontainer
// module loads (the setting is read once at @testcontainers/postgresql import
// time). Test-only scope: setting it in package.json would leak into the
// app runtime; here it lives only inside vitest workers.
process.env.TESTCONTAINERS_REUSE_ENABLE = "true";

import "../../tools/testcontainer-reaper-setup";
