// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 5 / Plan 01 — Wire schemas for /api/v1/keys/* family.
 * Mirrors ~/openwhispr/src/services/ApiKeysService.ts byte-for-byte (D-22).
 *
 * V1Response<T> envelope per D-28: { data: T }. Distinct from the global
 * legacy non-/v1 surface which returns the payload directly.
 *
 * The list-shape `ApiKey` deliberately OMITS the clear-text `key` field —
 * only `key_prefix` is surfaced after creation. `CreateApiKeyResponse` is
 * the only place the clear-text key appears (D-29).
 *
 * Phase 39 — HIGH sweep: `.strict()` on inputs, tightened primitives on
 * outputs (UUID + ISO-8601 datetime). Bounded scopes string length.
 */
import { z } from "zod";

const ISO_DATETIME = z.string().datetime({ offset: true });
const SCOPE = z.string().min(1).max(64);

export const ApiKeySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(256),
    key_prefix: z.string().min(1).max(64),
    scopes: z.array(SCOPE).max(64),
    last_used_at: ISO_DATETIME.nullable(),
    expires_at: ISO_DATETIME.nullable(),
    created_at: ISO_DATETIME,
  })
  .strict(); // strict() rejects accidental clear-text `key` in list shape
export type ApiKey = z.infer<typeof ApiKeySchema>;

export const CreateApiKeyResponseSchema = ApiKeySchema.extend({
  key: z.string().min(1).max(512),
}).strict();
export type CreateApiKeyResponse = z.infer<typeof CreateApiKeyResponseSchema>;

export const CreateApiKeyOptionsSchema = z
  .object({
    name: z.string().min(1).max(256),
    scopes: z.array(SCOPE).max(64),
    expiresInDays: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();
export type CreateApiKeyOptions = z.infer<typeof CreateApiKeyOptionsSchema>;

/** Generic V1Response envelope per D-28: `{ data: T }`. */
export const V1Response = <T extends z.ZodTypeAny>(inner: T) => z.object({ data: inner });
export type V1Response<T> = { data: T };

export const V1ListApiKeysResponseSchema = V1Response(z.object({ keys: z.array(ApiKeySchema) }));
export type V1ListApiKeysResponse = z.infer<typeof V1ListApiKeysResponseSchema>;

export const V1CreateApiKeyResponseSchema = V1Response(CreateApiKeyResponseSchema);
export type V1CreateApiKeyResponseT = z.infer<typeof V1CreateApiKeyResponseSchema>;
