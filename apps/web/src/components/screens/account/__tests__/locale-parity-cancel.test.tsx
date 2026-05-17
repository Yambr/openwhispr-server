// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-11d — REVIEW web HI-02 (partial close).
// `<AlertDialogCancel>Cancel</AlertDialogCancel>` literals were
// shipping in 7 client components: even for a `lng=ru` session the
// Cancel button rendered in English, breaking locale parity. The
// existing `common.action.cancel.label` key is now wired through
// `t("common:common.action.cancel.label")` so the button respects the
// active locale. Remaining HI-02 sites (titles, "(untitled)",
// yes/no, error-boundary) require new locale keys and stay open.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = resolve(__dirname, "../../../../..");

const SITES = [
  "src/components/screens/account/DeleteAccountDialog.tsx",
  "src/components/screens/notes/NotesListClient.tsx",
  "src/components/screens/notes/NoteDetailClient.tsx",
  "src/components/screens/transcriptions/TranscriptionDetailClient.tsx",
  "src/components/screens/transcriptions/TranscriptionsListClient.tsx",
  "src/components/screens/conversations/ConversationsListClient.tsx",
  "src/components/screens/conversations/ConversationDetailClient.tsx",
];

describe("Plan 51-11d — AlertDialogCancel locale wiring (HI-02)", () => {
  it.each(SITES)("%s uses t('common:common.action.cancel.label')", (rel) => {
    const src = readFileSync(resolve(WEB_ROOT, rel), "utf8");
    expect(src).toMatch(
      /<AlertDialogCancel>\s*\{\s*t\(\s*"common:common\.action\.cancel\.label"\s*\)\s*\}\s*<\/AlertDialogCancel>/,
    );
  });

  it.each(SITES)("%s no longer ships literal `>Cancel<`", (rel) => {
    const src = readFileSync(resolve(WEB_ROOT, rel), "utf8");
    expect(src).not.toMatch(/<AlertDialogCancel>\s*Cancel\s*<\/AlertDialogCancel>/);
  });

  it("both locales define common.action.cancel.label", () => {
    const en = JSON.parse(
      readFileSync(resolve(WEB_ROOT, "src/locales/en/common.json"), "utf8"),
    ) as { common?: { action?: { cancel?: { label?: string } } } };
    const ru = JSON.parse(
      readFileSync(resolve(WEB_ROOT, "src/locales/ru/common.json"), "utf8"),
    ) as { common?: { action?: { cancel?: { label?: string } } } };
    expect(en.common?.action?.cancel?.label).toBe("Cancel");
    // ru label is non-empty and different from en (English-only check
    // forbids inline cyrillic literals; assert by structural shape).
    expect(ru.common?.action?.cancel?.label).toBeTypeOf("string");
    expect(ru.common?.action?.cancel?.label?.length).toBeGreaterThan(0);
    expect(ru.common?.action?.cancel?.label).not.toBe("Cancel");
  });
});
