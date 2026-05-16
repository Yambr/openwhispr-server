// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 31 / Plan 03 — LOCKER-03 clean fixture. No hardcoded localhost,
// loopback IP, port literal, UUID, or secret-shape token.
const URL = process.env.APP_BASE_URL ?? "";
const TIMEOUT_MS = 5_000;

export { TIMEOUT_MS, URL };
