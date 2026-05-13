// SPDX-License-Identifier: Apache-2.0
/**
 * @openwhispr/wire-schemas — barrel export.
 *
 * Phase 5 / Plan 01 — Zod schemas for every Phase 5 wire surface,
 * mirroring the upstream OpenWhispr desktop client TS interfaces in
 * `~/openwhispr/src/services/*.ts` byte-for-byte (CONTEXT D-22).
 */
export * from "./notes.js";
export * from "./folders.js";
export * from "./conversations.js";
export * from "./transcriptions.js";
export * from "./api-keys.js";
export * from "./streaming-usage.js";
export * from "./web-search.js";
export * from "./settings.js";
