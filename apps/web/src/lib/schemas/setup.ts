// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-03 / Task 3 — Zod schema for the setup wizard.
//
// Mirrors the API-side schema in apps/api/src/routes/setup-admin.ts
// `setupAdminInput`. The shape is intentionally identical so the same
// validation rules fire client-side (per-field UICONF-03 errors) and
// server-side (defense-in-depth):
//
//   * email        — `.email()`
//   * password     — min 12, max 200, with character-class rules per the
//                    D-14 policy (RESEARCH §7). Stricter than the
//                    Better Auth default min(8) since the admin claim
//                    is a one-shot bootstrap surface.
//   * name         — display name; 1..100 chars
//   * workspace    — tenant name; 1..100 chars (RESEARCH Q1 — UPDATEd
//                    onto the singleton tenants.name)
//   * timezone     — IANA zone string (Intl.supportedValuesOf), 1+ char;
//                    accepted by the API but NOT persisted (deferred —
//                    no users.timezone column; CONTEXT.md <deferred_ideas>)
//
// Localized error messages flow through `zod-i18n.ts`'s `z.config({
// customError })` map; this file defines the rules only.
import { z } from "zod";

export const setupSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(12)
    .max(200)
    // Combined character-class refine: a single failure across the
    // upper/lower/digit requirement surfaces as one issue with
    // `params.kind === "mixed_classes"`. The zod-i18n bridge dispatches
    // on that kind to emit the localized `password.mixed_classes` copy.
    // Using `.refine` (not three separate `.regex(re, msg)` calls) lets
    // `customError` fire — Zod 4 short-circuits the customError when
    // .regex carries an inline message.
    .refine((v) => /[A-Z]/.test(v) && /[a-z]/.test(v) && /[0-9]/.test(v), {
      params: { kind: "password.mixed_classes" },
    }),
  name: z.string().min(1).max(100),
  workspace: z.string().min(1).max(100),
  timezone: z.string().min(1),
});

export type SetupInput = z.infer<typeof setupSchema>;
