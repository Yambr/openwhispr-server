// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * @openwhispr/wire-schemas — barrel export.
 *
 * Phase 5 / Plan 01 — Zod schemas for every Phase 5 wire surface,
 * mirroring the upstream OpenWhispr desktop client TS interfaces in
 * `~/openwhispr/src/services/*.ts` byte-for-byte (CONTEXT D-22).
 */

export * from "./agent.js";
export * from "./api-keys.js";
export * from "./check-user.js";
export * from "./conversations.js";
export * from "./delete-account.js";
export * from "./diarization.js";
export * from "./folders.js";
export * from "./input-datetime.js";
export * from "./notes.js";
export * from "./openai-realtime-token.js";
export * from "./reason.js";
export * from "./settings.js";
export * from "./streaming-usage.js";
export * from "./test-only-seed-tenant.js";
export * from "./transcriptions.js";
export * from "./verification-status.js";
export * from "./web-search.js";
