// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 5 / Plan 01 — RED-then-GREEN test suite for @openwhispr/wire-schemas.
 *
 * Each describe block exercises one resource family. For every Zod schema:
 *   1. A canonical valid example matches the upstream TS interface verbatim.
 *   2. A deliberately broken example must fail safeParse() so we catch
 *      drift the moment a future contributor relaxes a required field.
 *
 * The `.parse()` calls run inside `expect(...).not.toThrow()` so we get
 * a useful diff on assertion failure rather than a raw thrown stack.
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
  SearchResultSchema,
  StreamingUsageBodySchema,
  SttConfigResponseSchema,
  TranscriptionInputSchema,
  V1CreateApiKeyResponseSchema,
  V1ListApiKeysResponseSchema,
  V1Response,
  WebSearchRequestSchema,
  WebSearchResponseSchema,
} from "../../../src/index.js";

const T = "2026-01-01T00:00:00Z";
const UUID = "00000000-0000-0000-0000-000000000001";

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
});

describe("folders schemas", () => {
  it("FolderInput requires a name", () => {
    expect(FolderInputSchema.safeParse({}).success).toBe(false);
    expect(FolderInputSchema.parse({ name: "n", client_folder_id: "cf-1" })).toMatchObject({
      name: "n",
    });
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

  it("CloudMessage accepts the canonical row shape with metadata jsonb", () => {
    const msg = {
      id: UUID,
      conversation_id: UUID,
      role: "assistant" as const,
      content: "hello",
      metadata: { latency_ms: 123 },
      created_at: T,
    };
    expect(() => CloudMessageSchema.parse(msg)).not.toThrow();
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
          id: UUID,
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
      status: "complete",
      deleted_at: null,
      created_at: T,
      updated_at: T,
    };
    expect(() => CloudTranscriptionSchema.parse(tx)).not.toThrow();
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

  it("V1Response<T> wraps payloads in { data: T }", () => {
    const Wrapped = V1Response(ApiKeySchema);
    const ok = {
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
    expect(Wrapped.safeParse({}).success).toBe(false);
  });

  it("V1ListApiKeysResponse exposes { data: { keys: ApiKey[] } }", () => {
    const ok = { data: { keys: [] } };
    expect(() => V1ListApiKeysResponseSchema.parse(ok)).not.toThrow();
  });

  it("V1CreateApiKeyResponse exposes { data: CreateApiKeyResponse } including `key`", () => {
    const ok = {
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
  it("WebSearchRequest requires a non-empty, ≤256-char query", () => {
    expect(WebSearchRequestSchema.safeParse({}).success).toBe(false);
    expect(WebSearchRequestSchema.safeParse({ query: "" }).success).toBe(false);
    expect(WebSearchRequestSchema.safeParse({ query: "x".repeat(257) }).success).toBe(false);
  });

  it("WebSearchRequest defaults numResults to 5; rejects > 10", () => {
    const parsed = WebSearchRequestSchema.parse({ query: "test" });
    expect(parsed.numResults).toBe(5);
    expect(WebSearchRequestSchema.safeParse({ query: "x", numResults: 11 }).success).toBe(false);
    expect(WebSearchRequestSchema.safeParse({ query: "x", numResults: 0 }).success).toBe(false);
  });

  it("WebSearchResponse accepts a list of {title,url,snippet}", () => {
    expect(() =>
      WebSearchResponseSchema.parse({
        results: [{ title: "T", url: "https://x", snippet: "S" }],
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
});
