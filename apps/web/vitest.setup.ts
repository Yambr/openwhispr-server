// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 04 — Vitest global setup.
//
// @testing-library/react auto-cleanup between tests. React 19's concurrent
// rendering keeps the previous tree around longer than React 18 did, so the
// explicit cleanup matters more (without it, queries cross test boundaries).
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
