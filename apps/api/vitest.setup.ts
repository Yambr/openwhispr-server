// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 / Plan 01 / Task 02 — vitest 4 setupFiles entry for apps/api.
//
// Installs SIGINT/SIGTERM handlers that prune leaked testcontainers when a
// vitest run is interrupted (Ctrl-C, kill -TERM, IDE stop button). Without
// this hook, testcontainers' Ryuk reaper does not fire on SIGINT and leaves
// orphan postgres containers + 30 GB+ of dangling volumes
// (`.planning/deferred-items.md §1`).
//
// `installSignalHook()` is module-scoped idempotent; re-invocations from
// other setup files are safe no-ops.
import { installSignalHook } from "../../tools/global-vitest-teardown";

installSignalHook();
