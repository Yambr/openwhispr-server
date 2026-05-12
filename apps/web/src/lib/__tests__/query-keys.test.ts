// Phase 07.1 / Plan 06 — query-keys factory unit tests (RED before GREEN).
//
// Mirrors RESEARCH § Pattern 5 query-keys block byte-for-byte. Each factory
// returns a `const`-tuple key whose shape is asserted exactly here so a
// future refactor cannot silently shift any cache-bucket boundary.
import { describe, expect, it } from "vitest";
import { queryKeys } from "../query-keys";

describe("queryKeys factory (Phase 07.1 / Plan 06)", () => {
  it("usage() returns ['usage']", () => {
    expect(queryKeys.usage()).toEqual(["usage"]);
  });

  it("session() returns ['auth','session']", () => {
    expect(queryKeys.session()).toEqual(["auth", "session"]);
  });

  it("sessions() returns ['auth','sessions']", () => {
    expect(queryKeys.sessions()).toEqual(["auth", "sessions"]);
  });

  it("sttConfig() returns ['stt-config']", () => {
    expect(queryKeys.sttConfig()).toEqual(["stt-config"]);
  });

  it("noteRecordingConfig() returns ['note-recording-config']", () => {
    expect(queryKeys.noteRecordingConfig()).toEqual(["note-recording-config"]);
  });

  it("transcriptions.list(cursor) returns ['transcriptions','list',cursor]", () => {
    const cursor = { limit: 20 };
    expect(queryKeys.transcriptions.list(cursor)).toEqual(["transcriptions", "list", cursor]);
  });

  it("transcriptions.detail(id) returns ['transcriptions','detail',id]", () => {
    expect(queryKeys.transcriptions.detail("trx_123")).toEqual([
      "transcriptions",
      "detail",
      "trx_123",
    ]);
  });

  it("notes.list(cursor) returns ['notes','list',cursor]", () => {
    const cursor = { limit: 20, before: "2026-01-01" };
    expect(queryKeys.notes.list(cursor)).toEqual(["notes", "list", cursor]);
  });

  it("notes.detail(id) returns ['notes','detail',id]", () => {
    expect(queryKeys.notes.detail("note_42")).toEqual(["notes", "detail", "note_42"]);
  });

  it("notes.search(q) returns ['notes','search',q]", () => {
    expect(queryKeys.notes.search("hello")).toEqual(["notes", "search", "hello"]);
  });

  it("folders() returns ['folders']", () => {
    expect(queryKeys.folders()).toEqual(["folders"]);
  });

  it("conversations.list(cursor) returns ['conversations','list',cursor]", () => {
    const cursor = { limit: 10 };
    expect(queryKeys.conversations.list(cursor)).toEqual(["conversations", "list", cursor]);
  });

  it("conversations.messages(id,cursor) returns ['conversations','messages',id,cursor]", () => {
    const cursor = { limit: 50 };
    expect(queryKeys.conversations.messages("c_1", cursor)).toEqual([
      "conversations",
      "messages",
      "c_1",
      cursor,
    ]);
  });

  it("conversations.messages(id) without cursor returns ['conversations','messages',id,undefined]", () => {
    expect(queryKeys.conversations.messages("c_2")).toEqual([
      "conversations",
      "messages",
      "c_2",
      undefined,
    ]);
  });

  it("conversations.search(q) returns ['conversations','search',q]", () => {
    expect(queryKeys.conversations.search("foo")).toEqual(["conversations", "search", "foo"]);
  });
});
