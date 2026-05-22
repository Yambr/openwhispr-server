// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 5 / Plan 01 — RED-then-GREEN test suite for @openwhispr/wire-schemas.
 * Phase 39 — augmented with HIGH-sweep property tests: `.strict()` rejects
 * unknown keys; UUID, ISO-8601 datetime, URL refinements bite on bad input;
 * non-negative integer counts reject negatives + floats + NaN/Infinity;
 * note_type / status / provider / audio-format enums symmetric.
 *
 * Each describe block exercises one resource family. For every Zod schema:
 *   1. A canonical valid example matches the upstream TS interface verbatim.
 *   2. A deliberately broken example must fail safeParse() so we catch
 *      drift the moment a future contributor relaxes a required field.
 */
import { describe, expect, it } from "vitest";
import {
  ApiKeySchema,
  CloudConversationSchema,
  CloudConversationWithMessagesSchema,
  CloudFolderSchema,
  CloudMessageSchema,
  CloudNoteSchema,
  CloudTranscriptionSchema,
  ConversationInputSchema,
  CreateApiKeyOptionsSchema,
  CreateApiKeyResponseSchema,
  FolderInputSchema,
  NoteInputSchema,
  NoteRecordingConfigResponseSchema,
  NoteTypeSchema,
  SearchResultSchema,
  StreamingUsageBodySchema,
  SttConfigResponseSchema,
  TranscriptionInputSchema,
  TranscriptionStatusSchema,
  V1CreateApiKeyResponseSchema,
  V1Failure,
  V1ListApiKeysResponseSchema,
  V1Response,
  V1Success,
  WebSearchRequestSchema,
  WebSearchResponseSchema,
  WebSearchResultSchema,
} from "../../../src/index.js";

const T = "2026-01-01T00:00:00Z";
const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";

describe("notes schemas", () => {
  it("NoteInput accepts a minimal payload (all fields optional)", () => {
    expect(NoteInputSchema.parse({})).toEqual({});
  });

  it("NoteInput accepts the canonical client-id-bearing payload", () => {
    const input = { title: "x", content: "y", client_note_id: "cid-1" };
    expect(NoteInputSchema.parse(input)).toMatchObject(input);
  });

  it("NoteInput rejects a wrong-typed title (number, not string)", () => {
    expect(NoteInputSchema.safeParse({ title: 42 }).success).toBe(false);
  });

  it("NoteInput rejects unknown keys (strict)", () => {
    expect(NoteInputSchema.safeParse({ title: "x", sneaky: "value" }).success).toBe(false);
  });

  it("NoteInput rejects an unknown note_type", () => {
    expect(NoteInputSchema.safeParse({ note_type: "bogus" }).success).toBe(false);
  });

  it("NoteInput rejects negative + non-integer expected_speaker_count", () => {
    expect(NoteInputSchema.safeParse({ expected_speaker_count: -1 }).success).toBe(false);
    expect(NoteInputSchema.safeParse({ expected_speaker_count: 1.5 }).success).toBe(false);
  });

  it("NoteInput rejects diarization_enabled outside {0,1}", () => {
    expect(NoteInputSchema.safeParse({ diarization_enabled: 42 }).success).toBe(false);
    expect(NoteInputSchema.parse({ diarization_enabled: 1 }).diarization_enabled).toBe(1);
  });

  it("NoteInput rejects oversize content", () => {
    const bigContent = "x".repeat(256 * 1024 + 1);
    expect(NoteInputSchema.safeParse({ content: bigContent }).success).toBe(false);
  });

  it("CloudNote accepts the canonical full row shape", () => {
    const cloud = {
      id: UUID,
      client_note_id: "cid-1",
      title: "x",
      content: "y",
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
      created_at: T,
      updated_at: T,
    };
    expect(() => CloudNoteSchema.parse(cloud)).not.toThrow();
  });

  it("CloudNote rejects a non-UUID id", () => {
    expect(
      CloudNoteSchema.safeParse({
        id: "not-a-uuid",
        client_note_id: null,
        title: null,
        content: "",
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
        created_at: T,
        updated_at: T,
      }).success,
    ).toBe(false);
  });

  it("CloudNote rejects a non-ISO created_at", () => {
    expect(
      CloudNoteSchema.safeParse({
        id: UUID,
        client_note_id: null,
        title: null,
        content: "",
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
        created_at: "yesterday",
        updated_at: T,
      }).success,
    ).toBe(false);
  });

  it("CloudNote rejects free-string note_type (enum-symmetric)", () => {
    expect(
      CloudNoteSchema.safeParse({
        id: UUID,
        client_note_id: null,
        title: null,
        content: "",
        enhanced_content: null,
        note_type: "bogus",
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
        created_at: T,
        updated_at: T,
      }).success,
    ).toBe(false);
  });

  it("CloudNote rejects a row missing the required id", () => {
    expect(CloudNoteSchema.safeParse({ title: "x" }).success).toBe(false);
  });

  it("SearchResult accepts a CloudNote shape extended with score", () => {
    const cloud = {
      id: UUID,
      client_note_id: null,
      title: null,
      content: "",
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
      created_at: T,
      updated_at: T,
      score: 0.5,
    };
    expect(() => SearchResultSchema.parse(cloud)).not.toThrow();
  });

  it("NoteTypeSchema is exported with the canonical three-value enum", () => {
    expect(NoteTypeSchema.options).toEqual(["personal", "meeting", "upload"]);
  });
});

describe("folders schemas", () => {
  it("FolderInput requires a name", () => {
    expect(FolderInputSchema.safeParse({}).success).toBe(false);
    expect(FolderInputSchema.parse({ name: "n", client_folder_id: "cf-1" })).toMatchObject({
      name: "n",
    });
  });

  it("FolderInput rejects unknown keys (strict)", () => {
    expect(FolderInputSchema.safeParse({ name: "n", color: "red" }).success).toBe(false);
  });

  it("FolderInput rejects negative sort_order + non-integer", () => {
    expect(FolderInputSchema.safeParse({ name: "n", sort_order: -1 }).success).toBe(false);
    expect(FolderInputSchema.safeParse({ name: "n", sort_order: 1.5 }).success).toBe(false);
  });

  it("CloudFolder accepts the canonical full row shape", () => {
    const folder = {
      id: UUID,
      client_folder_id: "cf-1",
      name: "n",
      is_default: false,
      sort_order: 0,
      deleted_at: null,
      created_at: T,
      updated_at: T,
    };
    expect(() => CloudFolderSchema.parse(folder)).not.toThrow();
  });

  it("CloudFolder rejects a non-UUID id", () => {
    expect(
      CloudFolderSchema.safeParse({
        id: "not-a-uuid",
        client_folder_id: null,
        name: "n",
        is_default: false,
        sort_order: 0,
        deleted_at: null,
        created_at: T,
        updated_at: T,
      }).success,
    ).toBe(false);
  });

  it("CloudFolder rejects a non-ISO datetime", () => {
    expect(
      CloudFolderSchema.safeParse({
        id: UUID,
        client_folder_id: null,
        name: "n",
        is_default: false,
        sort_order: 0,
        deleted_at: null,
        created_at: "not-a-date",
        updated_at: T,
      }).success,
    ).toBe(false);
  });

  it("CloudFolder rejects a row missing tenant-visible fields", () => {
    expect(CloudFolderSchema.safeParse({ name: "n" }).success).toBe(false);
  });
});

describe("conversations + messages schemas", () => {
  it("ConversationInput accepts a payload with optional client_conversation_id and inline messages", () => {
    const input = {
      client_conversation_id: "cc-1",
      title: "t",
      messages: [{ role: "user" as const, content: "hi" }],
    };
    expect(() => ConversationInputSchema.parse(input)).not.toThrow();
  });

  it("ConversationInput rejects an unknown role", () => {
    expect(
      ConversationInputSchema.safeParse({
        messages: [{ role: "tool", content: "x" }],
      }).success,
    ).toBe(false);
  });

  it("ConversationInput rejects unknown top-level keys (strict)", () => {
    expect(ConversationInputSchema.safeParse({ title: "t", extra: "no" }).success).toBe(false);
  });

  it("ConversationInput rejects unknown keys on nested messages (strict)", () => {
    expect(
      ConversationInputSchema.safeParse({
        messages: [{ role: "user", content: "hi", forbidden: 1 }],
      }).success,
    ).toBe(false);
  });

  it("ConversationInput rejects oversize metadata (>4 KB stringified)", () => {
    const big = "x".repeat(1024);
    const bigMeta: Record<string, string> = {};
    for (let i = 0; i < 10; i++) bigMeta[`k${i}`] = big;
    expect(
      ConversationInputSchema.safeParse({
        messages: [{ role: "user", content: "hi", metadata: bigMeta }],
      }).success,
    ).toBe(false);
  });

  it("ConversationInput rejects unbounded value types in metadata (no nested objects)", () => {
    expect(
      ConversationInputSchema.safeParse({
        messages: [{ role: "user", content: "hi", metadata: { nested: { evil: true } } }],
      }).success,
    ).toBe(false);
  });

  it("CloudConversation accepts the canonical full row shape", () => {
    const conv = {
      id: UUID,
      client_conversation_id: null,
      title: "t",
      archived_at: null,
      deleted_at: null,
      created_at: T,
      updated_at: T,
    };
    expect(() => CloudConversationSchema.parse(conv)).not.toThrow();
  });

  it("CloudConversation rejects non-UUID id and non-ISO created_at", () => {
    expect(
      CloudConversationSchema.safeParse({
        id: "x",
        client_conversation_id: null,
        title: "t",
        archived_at: null,
        deleted_at: null,
        created_at: T,
        updated_at: T,
      }).success,
    ).toBe(false);
    expect(
      CloudConversationSchema.safeParse({
        id: UUID,
        client_conversation_id: null,
        title: "t",
        archived_at: null,
        deleted_at: null,
        created_at: "x",
        updated_at: T,
      }).success,
    ).toBe(false);
  });

  it("CloudMessage accepts the canonical row shape with metadata jsonb", () => {
    const msg = {
      id: UUID,
      conversation_id: UUID2,
      role: "assistant" as const,
      content: "hello",
      metadata: { latency_ms: 123 },
      created_at: T,
    };
    expect(() => CloudMessageSchema.parse(msg)).not.toThrow();
  });

  it("CloudMessage rejects non-UUID conversation_id", () => {
    expect(
      CloudMessageSchema.safeParse({
        id: UUID,
        conversation_id: "no",
        role: "user",
        content: "x",
        metadata: null,
        created_at: T,
      }).success,
    ).toBe(false);
  });

  it("CloudConversationWithMessages accepts a conversation + nested messages", () => {
    const conv = {
      id: UUID,
      client_conversation_id: null,
      title: "t",
      archived_at: null,
      deleted_at: null,
      created_at: T,
      updated_at: T,
      messages: [
        {
          id: UUID2,
          conversation_id: UUID,
          role: "user" as const,
          content: "hi",
          metadata: null,
          created_at: T,
        },
      ],
    };
    expect(() => CloudConversationWithMessagesSchema.parse(conv)).not.toThrow();
  });
});

describe("transcriptions schemas", () => {
  it("TranscriptionInput requires text", () => {
    expect(TranscriptionInputSchema.safeParse({}).success).toBe(false);
    expect(() =>
      TranscriptionInputSchema.parse({
        text: "hello",
        client_transcription_id: "ct-1",
      }),
    ).not.toThrow();
  });

  it("TranscriptionInput rejects unknown keys (strict)", () => {
    expect(TranscriptionInputSchema.safeParse({ text: "hi", evil: 1 }).success).toBe(false);
  });

  // R35 (quick-task 20260522) — the transcription INPUT `status` is now a
  // tolerant bounded free-text string (the immutable client's local SQLite
  // `status` is unconstrained TEXT). The strict 4-value enum is enforced
  // only on the `CloudTranscription` RESPONSE (see line ~493). The route
  // normalizes an unknown input status to a canonical value before insert.
  it("TranscriptionInput accepts a free-text status (R35 — input is tolerant)", () => {
    expect(TranscriptionInputSchema.safeParse({ text: "x", status: "pwned" }).success).toBe(true);
  });

  it("TranscriptionInput still rejects an oversize status string (>256)", () => {
    expect(TranscriptionInputSchema.safeParse({ text: "x", status: "z".repeat(257) }).success).toBe(
      false,
    );
  });

  it("TranscriptionInput rejects negative + non-integer audio_duration_ms", () => {
    expect(TranscriptionInputSchema.safeParse({ text: "x", audio_duration_ms: -1 }).success).toBe(
      false,
    );
    expect(TranscriptionInputSchema.safeParse({ text: "x", audio_duration_ms: 1.5 }).success).toBe(
      false,
    );
  });

  it("CloudTranscription accepts the canonical full row shape", () => {
    const tx = {
      id: UUID,
      client_transcription_id: null,
      text: "hello",
      raw_text: null,
      word_count: 1,
      source: "upload",
      provider: null,
      model: null,
      language: null,
      audio_duration_ms: null,
      status: "completed",
      deleted_at: null,
      created_at: T,
      updated_at: T,
    };
    expect(() => CloudTranscriptionSchema.parse(tx)).not.toThrow();
  });

  it("CloudTranscription rejects non-UUID id, non-ISO created_at, bad status", () => {
    const base = {
      id: UUID,
      client_transcription_id: null,
      text: "x",
      raw_text: null,
      word_count: 0,
      source: "upload",
      provider: null,
      model: null,
      language: null,
      audio_duration_ms: null,
      status: "completed" as const,
      deleted_at: null,
      created_at: T,
      updated_at: T,
    };
    expect(CloudTranscriptionSchema.safeParse({ ...base, id: "x" }).success).toBe(false);
    expect(CloudTranscriptionSchema.safeParse({ ...base, created_at: "nope" }).success).toBe(false);
    expect(CloudTranscriptionSchema.safeParse({ ...base, status: "weird" }).success).toBe(false);
    expect(CloudTranscriptionSchema.safeParse({ ...base, word_count: -1 }).success).toBe(false);
  });

  it("TranscriptionStatusSchema enumerates the canonical four", () => {
    expect(TranscriptionStatusSchema.options).toEqual([
      "pending",
      "processing",
      "completed",
      "failed",
    ]);
  });
});

describe("api-keys schemas", () => {
  it("ApiKey rejects a clear-text `key` field on the list-shape (strict)", () => {
    const listShape = {
      id: UUID,
      name: "my-key",
      key_prefix: "pak_abcdef",
      scopes: ["read"],
      last_used_at: null,
      expires_at: null,
      created_at: T,
      key: "pak_should-not-be-here",
    };
    expect(ApiKeySchema.safeParse(listShape).success).toBe(false);
  });

  it("ApiKey accepts the canonical list-shape (no clear-text key)", () => {
    const listShape = {
      id: UUID,
      name: "my-key",
      key_prefix: "pak_abcdef",
      scopes: ["read"],
      last_used_at: null,
      expires_at: null,
      created_at: T,
    };
    expect(() => ApiKeySchema.parse(listShape)).not.toThrow();
  });

  it("ApiKey rejects non-UUID id, non-ISO created_at", () => {
    const base = {
      id: UUID,
      name: "n",
      key_prefix: "pak_abc",
      scopes: ["read"],
      last_used_at: null,
      expires_at: null,
      created_at: T,
    };
    expect(ApiKeySchema.safeParse({ ...base, id: "no" }).success).toBe(false);
    expect(ApiKeySchema.safeParse({ ...base, created_at: "no" }).success).toBe(false);
  });

  it("CreateApiKeyResponse REQUIRES `key` (clear-text) plus key_prefix", () => {
    const resp = {
      id: UUID,
      name: "my-key",
      key_prefix: "pak_abcdef",
      scopes: ["read"],
      last_used_at: null,
      expires_at: null,
      created_at: T,
      key: "pak_clearText",
    };
    expect(() => CreateApiKeyResponseSchema.parse(resp)).not.toThrow();
    // Missing `key` -> reject
    const { key: _omit, ...withoutKey } = resp;
    void _omit;
    expect(CreateApiKeyResponseSchema.safeParse(withoutKey).success).toBe(false);
  });

  it("CreateApiKeyOptions accepts optional expiresInDays", () => {
    expect(() =>
      CreateApiKeyOptionsSchema.parse({ name: "x", scopes: ["read"], expiresInDays: 30 }),
    ).not.toThrow();
    expect(() => CreateApiKeyOptionsSchema.parse({ name: "x", scopes: ["read"] })).not.toThrow();
  });

  it("CreateApiKeyOptions rejects unknown keys (strict)", () => {
    expect(
      CreateApiKeyOptionsSchema.safeParse({
        name: "x",
        scopes: [],
        evil: true,
      }).success,
    ).toBe(false);
  });

  // Phase 56-06 D-3 — V1Response envelope flipped to a discriminated
  // union of success/failure variants. The old `{ data: T }` literal
  // form is REJECTED — clients must branch on `success` first.

  it("V1Success<T> requires { success: true, data: T } (strict)", () => {
    const Wrapped = V1Success(ApiKeySchema);
    const ok = {
      success: true,
      data: {
        id: UUID,
        name: "n",
        key_prefix: "pak_abcdef",
        scopes: [],
        last_used_at: null,
        expires_at: null,
        created_at: T,
      },
    };
    expect(() => Wrapped.parse(ok)).not.toThrow();
    // Missing success flag — REJECTED (legacy `{data:T}` no longer valid).
    expect(Wrapped.safeParse({ data: ok.data }).success).toBe(false);
    // success:false in a success-variant schema — REJECTED.
    expect(Wrapped.safeParse({ ...ok, success: false }).success).toBe(false);
    // Stray top-level keys — REJECTED.
    expect(Wrapped.safeParse({ ...ok, error: "no" }).success).toBe(false);
  });

  it("V1Failure has { success: false, error: string, code?: string } (strict)", () => {
    expect(() => V1Failure.parse({ success: false, error: "boom" })).not.toThrow();
    expect(() =>
      V1Failure.parse({ success: false, error: "boom", code: "UNAUTHORIZED" }),
    ).not.toThrow();
    // Empty error string — REJECTED.
    expect(V1Failure.safeParse({ success: false, error: "" }).success).toBe(false);
    // success:true in failure schema — REJECTED.
    expect(V1Failure.safeParse({ success: true, error: "x" }).success).toBe(false);
    // Stray `data` key on the failure shape — REJECTED.
    expect(V1Failure.safeParse({ success: false, error: "x", data: {} }).success).toBe(false);
  });

  it("V1Response<T> is a discriminated union of success/failure variants", () => {
    const Wrapped = V1Response(ApiKeySchema);
    const apiKey = {
      id: UUID,
      name: "n",
      key_prefix: "pak_abcdef",
      scopes: [],
      last_used_at: null,
      expires_at: null,
      created_at: T,
    };
    // Success branch parses.
    expect(() => Wrapped.parse({ success: true, data: apiKey })).not.toThrow();
    // Failure branch parses (with or without code).
    expect(() => Wrapped.parse({ success: false, error: "boom" })).not.toThrow();
    expect(() => Wrapped.parse({ success: false, error: "boom", code: "NOT_FOUND" })).not.toThrow();
    // Legacy plain `{ data: T }` (no success discriminator) — REJECTED.
    expect(Wrapped.safeParse({ data: apiKey }).success).toBe(false);
    // Empty envelope — REJECTED.
    expect(Wrapped.safeParse({}).success).toBe(false);
  });

  it("V1ListApiKeysResponse exposes { success: true, data: { keys: ApiKey[] } }", () => {
    const ok = { success: true, data: { keys: [] } };
    expect(() => V1ListApiKeysResponseSchema.parse(ok)).not.toThrow();
    // Failure variant also parses.
    expect(() =>
      V1ListApiKeysResponseSchema.parse({
        success: false,
        error: "unauthorized",
        code: "UNAUTHORIZED",
      }),
    ).not.toThrow();
    // Legacy `{ data: { keys: [] } }` — REJECTED.
    expect(V1ListApiKeysResponseSchema.safeParse({ data: { keys: [] } }).success).toBe(false);
  });

  it("V1CreateApiKeyResponse exposes { success: true, data: CreateApiKeyResponse } including `key`", () => {
    const ok = {
      success: true,
      data: {
        id: UUID,
        name: "n",
        key_prefix: "pak_abcdef",
        scopes: ["read"],
        last_used_at: null,
        expires_at: null,
        created_at: T,
        key: "pak_clearText",
      },
    };
    expect(() => V1CreateApiKeyResponseSchema.parse(ok)).not.toThrow();
    // Failure variant also parses.
    expect(() =>
      V1CreateApiKeyResponseSchema.parse({
        success: false,
        error: "duplicate",
        code: "CONFLICT",
      }),
    ).not.toThrow();
    // Legacy `{ data: T }` — REJECTED.
    expect(V1CreateApiKeyResponseSchema.safeParse({ data: ok.data }).success).toBe(false);
  });
});

describe("streaming-usage schema", () => {
  it("StreamingUsageBody requires sessionId + audioDurationSeconds", () => {
    expect(StreamingUsageBodySchema.safeParse({}).success).toBe(false);
    expect(StreamingUsageBodySchema.safeParse({ sessionId: "s" }).success).toBe(false);
    expect(
      StreamingUsageBodySchema.safeParse({ sessionId: "s", audioDurationSeconds: -1 }).success,
    ).toBe(false);
  });

  it("StreamingUsageBody rejects unknown keys (strict)", () => {
    expect(
      StreamingUsageBodySchema.safeParse({
        sessionId: "s",
        audioDurationSeconds: 1,
        evil: 1,
      }).success,
    ).toBe(false);
  });

  it("StreamingUsageBody rejects NaN/Infinity audioDurationSeconds", () => {
    expect(
      StreamingUsageBodySchema.safeParse({
        sessionId: "s",
        audioDurationSeconds: Number.NaN,
      }).success,
    ).toBe(false);
    expect(
      StreamingUsageBodySchema.safeParse({
        sessionId: "s",
        audioDurationSeconds: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false);
  });

  it("StreamingUsageBody rejects negative + non-integer sttProcessingMs", () => {
    expect(
      StreamingUsageBodySchema.safeParse({
        sessionId: "s",
        audioDurationSeconds: 1,
        sttProcessingMs: -1,
      }).success,
    ).toBe(false);
    expect(
      StreamingUsageBodySchema.safeParse({
        sessionId: "s",
        audioDurationSeconds: 1,
        sttProcessingMs: 1.5,
      }).success,
    ).toBe(false);
  });

  it("StreamingUsageBody accepts all 14 fields", () => {
    const full = {
      sessionId: "s",
      audioDurationSeconds: 3.14,
      text: "t",
      clientType: "desktop",
      appVersion: "1.0.0",
      clientVersion: "2.0.0",
      sttProvider: "openai",
      sttModel: "whisper-1",
      sttProcessingMs: 500,
      sttLanguage: "en",
      audioSizeBytes: 1024,
      audioFormat: "webm",
      clientTotalMs: 1234,
      sendLogs: true,
    };
    const parsed = StreamingUsageBodySchema.parse(full);
    expect(parsed.sendLogs).toBe(true);
  });

  it("StreamingUsageBody defaults sendLogs to false when absent", () => {
    const parsed = StreamingUsageBodySchema.parse({
      sessionId: "s",
      audioDurationSeconds: 1,
    });
    expect(parsed.sendLogs).toBe(false);
  });
});

describe("web-search schemas", () => {
  it("WebSearchRequest requires a non-empty, <=256-char query", () => {
    expect(WebSearchRequestSchema.safeParse({}).success).toBe(false);
    expect(WebSearchRequestSchema.safeParse({ query: "" }).success).toBe(false);
    expect(WebSearchRequestSchema.safeParse({ query: "x".repeat(257) }).success).toBe(false);
  });

  it("WebSearchRequest rejects unknown keys (strict)", () => {
    expect(WebSearchRequestSchema.safeParse({ query: "x", evil: 1 }).success).toBe(false);
  });

  it("WebSearchRequest defaults numResults to 5; rejects > 10", () => {
    const parsed = WebSearchRequestSchema.parse({ query: "test" });
    expect(parsed.numResults).toBe(5);
    expect(WebSearchRequestSchema.safeParse({ query: "x", numResults: 11 }).success).toBe(false);
    expect(WebSearchRequestSchema.safeParse({ query: "x", numResults: 0 }).success).toBe(false);
  });

  it("WebSearchResult rejects non-URL url", () => {
    expect(
      WebSearchResultSchema.safeParse({
        title: "T",
        url: "not a url",
        snippet: "S",
      }).success,
    ).toBe(false);
  });

  it("WebSearchResponse accepts a list of {title,url,snippet}", () => {
    expect(() =>
      WebSearchResponseSchema.parse({
        results: [{ title: "T", url: "https://example.com", snippet: "S" }],
      }),
    ).not.toThrow();
  });
});

describe("settings schemas", () => {
  it("SttConfigResponse accepts the canonical shape", () => {
    expect(() =>
      SttConfigResponseSchema.parse({
        defaultModel: "whisper-1",
        defaultLanguage: "auto",
        availableProviders: ["openai"],
      }),
    ).not.toThrow();
  });

  it("SttConfigResponse rejects an unknown provider in availableProviders (enum)", () => {
    expect(
      SttConfigResponseSchema.safeParse({
        defaultModel: "whisper-1",
        defaultLanguage: "auto",
        availableProviders: ["my-rolled-own"],
      }).success,
    ).toBe(false);
  });

  it("SttConfigResponse rejects missing fields", () => {
    expect(SttConfigResponseSchema.safeParse({ defaultModel: "x" }).success).toBe(false);
  });

  it("NoteRecordingConfigResponse accepts the canonical shape", () => {
    expect(() =>
      NoteRecordingConfigResponseSchema.parse({
        maxDurationSeconds: 7200,
        sampleRateHz: 16000,
        allowedFormats: ["webm"],
        diarizationEnabled: true,
      }),
    ).not.toThrow();
  });

  it("NoteRecordingConfigResponse rejects unknown audio format", () => {
    expect(
      NoteRecordingConfigResponseSchema.safeParse({
        maxDurationSeconds: 7200,
        sampleRateHz: 16000,
        allowedFormats: ["xyz"],
        diarizationEnabled: true,
      }).success,
    ).toBe(false);
  });

  it("NoteRecordingConfigResponse rejects negative + non-integer durations", () => {
    expect(
      NoteRecordingConfigResponseSchema.safeParse({
        maxDurationSeconds: -1,
        sampleRateHz: 16000,
        allowedFormats: ["webm"],
        diarizationEnabled: true,
      }).success,
    ).toBe(false);
    expect(
      NoteRecordingConfigResponseSchema.safeParse({
        maxDurationSeconds: 7200.5,
        sampleRateHz: 16000,
        allowedFormats: ["webm"],
        diarizationEnabled: true,
      }).success,
    ).toBe(false);
  });
});
