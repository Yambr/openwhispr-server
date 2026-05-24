// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick-task 260524-u00 / Task A5 — POST /api/locale wire shapes.
//
// The frontend language switcher (web/src/.../layout-*.js) posts the
// chosen locale to /api/locale; chart 1.0.5 + image v1.0.3 returned
// 404 because only the GET sibling existed (apps/api/src/routes/locale.ts).
//
// Two-line contract:
//   POST /api/locale  body: { locale: 'en' | 'ru' }  -> 200 { locale }
//   Side effects: Set-Cookie i18next=<locale>; if session: UPDATE users.locale.
//
// `.strict()` rejects extra fields per the wire-schemas house-rule
// (T-02-03-07). Two-element enum mirrors the SUPPORTED const at
// apps/api/src/routes/locale.ts:33 and packages/data users.locale
// CHECK constraint (en|ru only in v1).
import { z } from "zod";

export const LocaleSetRequest = z
  .object({
    locale: z.enum(["en", "ru"]),
  })
  .strict();
export type LocaleSetRequest = z.infer<typeof LocaleSetRequest>;

export const LocaleSetResponse = z.object({ locale: z.enum(["en", "ru"]) });
export type LocaleSetResponse = z.infer<typeof LocaleSetResponse>;
