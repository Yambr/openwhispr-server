// SPDX-License-Identifier: FSL-1.1-ALv2
// R35 (quick-task 20260522) — RED→GREEN regression for cloud-sync POST
// endpoints rejecting the immutable desktop client's body with 400.
//
// DEFECT 1 — datetime format. The client stores created_at/updated_at in
// SQLite `DATETIME` columns that yield the SPACE-SEPARATED form
// "2026-05-22 16:05:11" (no `T`, no offset). The INPUT schemas used Zod
// `.datetime({ offset: true })` which requires RFC-3339 `T`-form, so the
// client's value 400s. FIX: a lenient `INPUT_DATETIME` validator accepting
// BOTH the SQLite space form AND RFC-3339, normalizing to canonical ISO.
//
// DEFECT 2 — status enum (transcriptions only). The client's local SQLite
// `transcriptions.status` is unconstrained free TEXT; the INPUT schema
// pinned it to the strict 4-value enum, so `status:"synced"` 400s. FIX:
// the transcription INPUT status widens to `z.string().max(256)`.
//
// The asymmetry is intentional: the `Cloud*` RESPONSE schemas stay strict
// (RFC-3339 datetime, 4-value status enum). This file pins that asymmetry.
import { describe, expect, it } from "vitest";
import {
  CloudNoteSchema,
  CloudTranscriptionSchema,
  ConversationInputSchema,
  NoteInputSchema,
  TranscriptionInputSchema,
} from "../../../src/index.js";
import { INPUT_DATETIME } from "../../../src/input-datetime.js";

describe("R35 — INPUT_DATETIME accepts SQLite + RFC-3339 forms", () => {
  it("accepts the SQLite space form", () => {
    expect(INPUT_DATETIME.safeParse("2026-05-22 16:05:11").success).toBe(true);
  });

  it("accepts the RFC-3339 T-form", () => {
    expect(INPUT_DATETIME.safeParse("2026-05-22T16:05:11.000Z").success).toBe(true);
  });

  it("accepts fractional seconds on the SQLite form", () => {
    expect(INPUT_DATETIME.safeParse("2026-05-22 16:05:11.123").success).toBe(true);
  });

  it("accepts a trailing offset on the SQLite form", () => {
    expect(INPUT_DATETIME.safeParse("2026-05-22 16:05:11+02:00").success).toBe(true);
  });

  it("accepts a trailing offset on the T-form", () => {
    expect(INPUT_DATETIME.safeParse("2026-05-22T16:05:11-05:00").success).toBe(true);
  });
});

describe("R35 — INPUT_DATETIME normalizes to canonical RFC-3339", () => {
  it("normalizes the SQLite space form to ...T...Z", () => {
    const r = INPUT_DATETIME.safeParse("2026-05-22 16:05:11");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("2026-05-22T16:05:11Z");
  });

  it("keeps an explicit offset untouched (does not append Z)", () => {
    const r = INPUT_DATETIME.safeParse("2026-05-22 16:05:11+02:00");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("2026-05-22T16:05:11+02:00");
  });

  it("leaves an already-canonical T-form unchanged", () => {
    const r = INPUT_DATETIME.safeParse("2026-05-22T16:05:11.000Z");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("2026-05-22T16:05:11.000Z");
  });
});

describe("R35 — INPUT_DATETIME rejects structural garbage", () => {
  it('rejects "not a date"', () => {
    expect(INPUT_DATETIME.safeParse("not a date").success).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(INPUT_DATETIME.safeParse("").success).toBe(false);
  });

  it("rejects whitespace-only (post-trim empty)", () => {
    expect(INPUT_DATETIME.safeParse("   ").success).toBe(false);
  });

  it("rejects a date with no time component", () => {
    expect(INPUT_DATETIME.safeParse("2026-05-22").success).toBe(false);
  });
});

describe("R35 — INPUT_DATETIME rejects impossible calendar dates", () => {
  it("rejects month 13", () => {
    expect(INPUT_DATETIME.safeParse("2026-13-99 00:00:00").success).toBe(false);
  });

  it('rejects the roll-over case "2026-02-30 12:00:00" (Feb 30 — JS would roll to Mar 2)', () => {
    // A bare !Number.isNaN(Date.parse(...)) check WRONGLY accepts this:
    // Date.parse("2026-02-30T12:00:00Z") returns a valid number because JS
    // rolls Feb 30 -> Mar 2. The round-trip component check rejects it.
    expect(INPUT_DATETIME.safeParse("2026-02-30 12:00:00").success).toBe(false);
  });
});

describe("R35 — three INPUT schemas accept the SQLite datetime form", () => {
  it("TranscriptionInputSchema accepts SQLite-form created_at", () => {
    expect(
      TranscriptionInputSchema.safeParse({ text: "x", created_at: "2026-05-22 16:05:11" }).success,
    ).toBe(true);
  });

  it("NoteInputSchema accepts SQLite-form created_at + updated_at", () => {
    expect(
      NoteInputSchema.safeParse({
        created_at: "2026-05-22 16:05:11",
        updated_at: "2026-05-22 16:05:11",
      }).success,
    ).toBe(true);
  });

  it("ConversationInputSchema accepts SQLite-form created_at + updated_at", () => {
    expect(
      ConversationInputSchema.safeParse({
        created_at: "2026-05-22 16:05:11",
        updated_at: "2026-05-22 16:05:11",
      }).success,
    ).toBe(true);
  });
});

describe("R35 — TranscriptionInputSchema tolerates a free-text status", () => {
  it('accepts status:"synced" (the live-proven failing case)', () => {
    expect(TranscriptionInputSchema.safeParse({ text: "x", status: "synced" }).success).toBe(true);
  });

  it('accepts status:"completed" (a known enum value — regression)', () => {
    expect(TranscriptionInputSchema.safeParse({ text: "x", status: "completed" }).success).toBe(
      true,
    );
  });

  it("accepts an arbitrary future client state", () => {
    expect(
      TranscriptionInputSchema.safeParse({ text: "x", status: "some-future-client-state" }).success,
    ).toBe(true);
  });

  it("still rejects an oversize status string (>256)", () => {
    expect(TranscriptionInputSchema.safeParse({ text: "x", status: "z".repeat(257) }).success).toBe(
      false,
    );
  });
});

describe("R35 — Cloud* RESPONSE schemas stay strict (asymmetry pin)", () => {
  const validCloudRow = {
    id: "11111111-1111-1111-1111-111111111111",
    client_transcription_id: "client-1",
    text: "hello",
    raw_text: null,
    word_count: 1,
    source: "desktop",
    provider: null,
    model: null,
    language: null,
    audio_duration_ms: null,
    status: "completed",
    deleted_at: null,
    created_at: "2026-05-22T16:05:11.000Z",
    updated_at: "2026-05-22T16:05:11.000Z",
  };

  it('CloudTranscriptionSchema rejects status:"synced" (non-enum)', () => {
    expect(CloudTranscriptionSchema.safeParse({ ...validCloudRow, status: "synced" }).success).toBe(
      false,
    );
  });

  it("CloudTranscriptionSchema rejects the SQLite space form in created_at", () => {
    expect(
      CloudTranscriptionSchema.safeParse({ ...validCloudRow, created_at: "2026-05-22 16:05:11" })
        .success,
    ).toBe(false);
  });

  it("CloudNoteSchema rejects the SQLite space form in created_at", () => {
    const validNoteRow = {
      id: "22222222-2222-2222-2222-222222222222",
      client_note_id: "client-note-1",
      title: null,
      content: "hello",
      enhanced_content: null,
      note_type: "personal",
      enhancement_prompt: null,
      source_file: null,
      audio_duration_seconds: null,
      folder_id: null,
      transcript: null,
      enhanced_at_content_hash: null,
      participants: null,
      calendar_event_id: null,
      diarization_enabled: null,
      expected_speaker_count: null,
      deleted_at: null,
      created_at: "2026-05-22 16:05:11",
      updated_at: "2026-05-22T16:05:11.000Z",
    };
    expect(CloudNoteSchema.safeParse(validNoteRow).success).toBe(false);
  });
});
