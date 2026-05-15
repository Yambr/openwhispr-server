// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * testcontainer-reaper-setup.ts — Phase 18.1.1 / Plan 03 / Task D-08.
 *
 * Shared `vitest.config.ts → test.setupFiles` entry that installs
 * SIGINT/SIGTERM handlers pruning leaked testcontainers when a vitest run
 * is interrupted. Extracted from apps/api/vitest.setup.ts so apps/worker
 * and packages/data can reuse the same import-time side effect.
 *
 * Without this hook, testcontainers' Ryuk reaper does not fire on SIGINT
 * and leaves orphan postgres containers + 30 GB+ of dangling volumes
 * (`.planning/deferred-items.md §1` — memory: testcontainers cleanup audit).
 *
 * `installSignalHook()` is module-scoped idempotent; importing this file
 * multiple times across overlapping vitest workers is safe.
 */
import { installSignalHook } from "./global-vitest-teardown.js";

installSignalHook();
