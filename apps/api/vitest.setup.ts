// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 18.1.1 / Plan 03 / Task D-08 — apps/api vitest 4 setupFiles entry.
//
// Re-exports the shared tools/testcontainer-reaper-setup helper that
// installs SIGINT/SIGTERM testcontainer-reaper handlers (formerly inlined
// here, now extracted for apps/worker + packages/data reuse).
//
// `installSignalHook()` is module-scoped idempotent; re-invocations from
// other setup files are safe no-ops.
import "../../tools/testcontainer-reaper-setup";
