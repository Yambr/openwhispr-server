// Phase 05 / Plan 03 / Task 2 — Yandex adapter (pending stub) tests.
//
// The Yandex adapter currently ships as a wire-shape stub. The reference
// Python implementation is sandboxed in the user's ~/Downloads folder;
// the user chose 'skip-yandex' at Plan 03's Task-1 checkpoint. These
// tests pin the stub behavior so that:
//   * The registry still exposes a 'yandex' provider (route 503-stub
//     surface remains stable for the wire contract).
//   * isConfigured() returns false by default — operator cannot
//     accidentally route traffic to the stub.
//   * search() always throws YandexSearchPendingError so the route can
//     emit the canonical "provider pending" 503 envelope.
//
// When the reference lands, these tests will be replaced with the
// happy-path / upstream-error / timeout matrix that mirrors tavily.test.ts.

import { afterEach, describe, expect, it } from "vitest";
import { webSearchRegistry } from "../registry.js";
import { YandexAdapter } from "../yandex-adapter.js";
import { YandexSearchPendingError } from "../types.js";

const origKey = process.env.YANDEX_SEARCH_API_KEY;
const origFolder = process.env.YANDEX_FOLDER_ID;
const origEnabled = process.env.YANDEX_SEARCH_ENABLED;

afterEach(() => {
  if (origKey === undefined) delete process.env.YANDEX_SEARCH_API_KEY;
  else process.env.YANDEX_SEARCH_API_KEY = origKey;
  if (origFolder === undefined) delete process.env.YANDEX_FOLDER_ID;
  else process.env.YANDEX_FOLDER_ID = origFolder;
  if (origEnabled === undefined) delete process.env.YANDEX_SEARCH_ENABLED;
  else process.env.YANDEX_SEARCH_ENABLED = origEnabled;
});

describe("YandexAdapter (pending stub)", () => {
  it("is registered in webSearchRegistry under name 'yandex'", () => {
    expect(webSearchRegistry.get("yandex")).toBeInstanceOf(YandexAdapter);
  });

  it("name property is 'yandex'", () => {
    expect(new YandexAdapter().name).toBe("yandex");
  });

  it("isConfigured() returns false by default (no env set)", () => {
    delete process.env.YANDEX_SEARCH_API_KEY;
    delete process.env.YANDEX_FOLDER_ID;
    delete process.env.YANDEX_SEARCH_ENABLED;
    expect(new YandexAdapter().isConfigured()).toBe(false);
  });

  it("isConfigured() returns false even when YANDEX_SEARCH_API_KEY + YANDEX_FOLDER_ID are set but YANDEX_SEARCH_ENABLED is not 'true'", () => {
    process.env.YANDEX_SEARCH_API_KEY = "stub-key";
    process.env.YANDEX_FOLDER_ID = "stub-folder";
    delete process.env.YANDEX_SEARCH_ENABLED;
    expect(new YandexAdapter().isConfigured()).toBe(false);
  });

  it("isConfigured() returns false when YANDEX_SEARCH_ENABLED='true' but key/folder missing", () => {
    delete process.env.YANDEX_SEARCH_API_KEY;
    delete process.env.YANDEX_FOLDER_ID;
    process.env.YANDEX_SEARCH_ENABLED = "true";
    expect(new YandexAdapter().isConfigured()).toBe(false);
  });

  it("isConfigured() returns true only with key + folder + YANDEX_SEARCH_ENABLED='true' (forward compatibility for hot-swap)", () => {
    process.env.YANDEX_SEARCH_API_KEY = "stub-key";
    process.env.YANDEX_FOLDER_ID = "stub-folder";
    process.env.YANDEX_SEARCH_ENABLED = "true";
    expect(new YandexAdapter().isConfigured()).toBe(true);
  });

  it("search() throws YandexSearchPendingError with the operator-actionable message", async () => {
    const adapter = new YandexAdapter();
    await expect(adapter.search("anything", 3)).rejects.toBeInstanceOf(
      YandexSearchPendingError,
    );
    await expect(adapter.search("anything", 3)).rejects.toThrow(
      /pending|reference implementation/i,
    );
  });

  it("search() throws YandexSearchPendingError even when env is fully configured (gate enforces stub-status until reference lands)", async () => {
    process.env.YANDEX_SEARCH_API_KEY = "k";
    process.env.YANDEX_FOLDER_ID = "f";
    process.env.YANDEX_SEARCH_ENABLED = "true";
    const adapter = new YandexAdapter();
    await expect(adapter.search("q", 1)).rejects.toBeInstanceOf(
      YandexSearchPendingError,
    );
  });
});
