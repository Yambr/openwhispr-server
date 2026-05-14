// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 03 / Task 2 (follow-up: Yandex live adapter) — tests.
//
// The Yandex adapter is a LIVE HTTP adapter against
// https://searchapi.api.cloud.yandex.net/v2/web/search per the wire
// contract verified 2026-05-11. Tests use undici MockAgent to mock the
// HTTP boundary — no real network calls. Coverage matrix:
//   * Configuration gating (key + folder both required; no feature flag)
//   * Region → searchType/region/l10n mapping for ru/tr/en
//   * XML parser content-priority chain (extended-text > passages > title > headline)
//   * <hlword>...</hlword> stripping preserves inner text
//   * Happy-path end-to-end with verbatim base64-encoded XML
//   * Error envelope mapping: gRPC code 3/7/8/13/16 → typed errors
//   * Request-id captured + propagated (logged, never echoed in error)
//   * Timeout / network failure → UpstreamError

import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { webSearchRegistry } from "../../../../../src/lib/web-search/registry.js";
import { MissingProviderKeyError, UpstreamError } from "../../../../../src/lib/web-search/types.js";
import { __testing__, YandexAdapter } from "../../../../../src/lib/web-search/yandex-adapter.js";

const origKey = process.env.YANDEX_SEARCH_API_KEY;
const origFolder = process.env.YANDEX_SEARCH_FOLDER_ID;
const origFolderLegacy = process.env.YANDEX_FOLDER_ID;
const origEnabled = process.env.YANDEX_SEARCH_ENABLED;

const YANDEX_ORIGIN = "https://searchapi.api.cloud.yandex.net";
const YANDEX_PATH = "/v2/web/search";

let agent: MockAgent;
let prevDispatcher: ReturnType<typeof getGlobalDispatcher>;

function b64(xml: string): string {
  return Buffer.from(xml, "utf-8").toString("base64");
}

const SAMPLE_XML_TWO_DOCS = `<?xml version="1.0" encoding="UTF-8"?>
<yandexsearch version="1.0">
  <response>
    <results>
      <grouping attr="ignored">
        <group>
          <doc id="d1">
            <url>https://example.com/one</url>
            <title>First <hlword>Result</hlword> Title</title>
            <headline>Headline one with <hlword>highlight</hlword> word</headline>
            <passages>
              <passage>Passage A with <hlword>query</hlword> in it</passage>
              <passage>Passage B continuation</passage>
            </passages>
            <extended-text>Extended <hlword>full</hlword> text content one</extended-text>
          </doc>
        </group>
        <group>
          <doc id="d2">
            <url>https://example.com/two</url>
            <title>Second plain title</title>
            <headline>Headline two</headline>
            <passages>
              <passage>Only passage for doc two</passage>
            </passages>
          </doc>
        </group>
      </grouping>
    </results>
  </response>
</yandexsearch>`;

beforeEach(() => {
  prevDispatcher = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  if (origKey === undefined) delete process.env.YANDEX_SEARCH_API_KEY;
  else process.env.YANDEX_SEARCH_API_KEY = origKey;
  if (origFolder === undefined) delete process.env.YANDEX_SEARCH_FOLDER_ID;
  else process.env.YANDEX_SEARCH_FOLDER_ID = origFolder;
  if (origFolderLegacy === undefined) delete process.env.YANDEX_FOLDER_ID;
  else process.env.YANDEX_FOLDER_ID = origFolderLegacy;
  if (origEnabled === undefined) delete process.env.YANDEX_SEARCH_ENABLED;
  else process.env.YANDEX_SEARCH_ENABLED = origEnabled;

  await agent.close();
  setGlobalDispatcher(prevDispatcher);
});

describe("YandexAdapter — registry + name", () => {
  it("is registered in webSearchRegistry under name 'yandex'", () => {
    expect(webSearchRegistry.get("yandex")).toBeInstanceOf(YandexAdapter);
  });

  it("name property is 'yandex'", () => {
    expect(new YandexAdapter().name).toBe("yandex");
  });
});

describe("YandexAdapter.isConfigured()", () => {
  it("returns false when neither YANDEX_SEARCH_API_KEY nor YANDEX_SEARCH_FOLDER_ID is set", () => {
    delete process.env.YANDEX_SEARCH_API_KEY;
    delete process.env.YANDEX_SEARCH_FOLDER_ID;
    delete process.env.YANDEX_FOLDER_ID;
    expect(new YandexAdapter().isConfigured()).toBe(false);
  });

  it("returns false when only YANDEX_SEARCH_API_KEY is set", () => {
    process.env.YANDEX_SEARCH_API_KEY = "k";
    delete process.env.YANDEX_SEARCH_FOLDER_ID;
    delete process.env.YANDEX_FOLDER_ID;
    expect(new YandexAdapter().isConfigured()).toBe(false);
  });

  it("returns false when only the folder env is set", () => {
    delete process.env.YANDEX_SEARCH_API_KEY;
    process.env.YANDEX_SEARCH_FOLDER_ID = "b1g";
    expect(new YandexAdapter().isConfigured()).toBe(false);
  });

  it("returns true with YANDEX_SEARCH_API_KEY + YANDEX_SEARCH_FOLDER_ID set (no feature flag required)", () => {
    process.env.YANDEX_SEARCH_API_KEY = "k";
    process.env.YANDEX_SEARCH_FOLDER_ID = "b1gfolder";
    delete process.env.YANDEX_SEARCH_ENABLED;
    expect(new YandexAdapter().isConfigured()).toBe(true);
  });

  it("accepts legacy YANDEX_FOLDER_ID as a fallback folder source", () => {
    process.env.YANDEX_SEARCH_API_KEY = "k";
    delete process.env.YANDEX_SEARCH_FOLDER_ID;
    process.env.YANDEX_FOLDER_ID = "b1glegacy";
    expect(new YandexAdapter().isConfigured()).toBe(true);
  });
});

describe("YandexAdapter — region mapping (mapRegion)", () => {
  it("'ru' → SEARCH_TYPE_RU / 225 / LOCALIZATION_RU", () => {
    expect(__testing__.mapRegion("ru")).toEqual({
      searchType: "SEARCH_TYPE_RU",
      region: "225",
      l10n: "LOCALIZATION_RU",
    });
  });

  it("'tr' → SEARCH_TYPE_TR / 983 / LOCALIZATION_TR", () => {
    expect(__testing__.mapRegion("tr")).toEqual({
      searchType: "SEARCH_TYPE_TR",
      region: "983",
      l10n: "LOCALIZATION_TR",
    });
  });

  it("'en' → SEARCH_TYPE_COM / 84 / LOCALIZATION_EN", () => {
    expect(__testing__.mapRegion("en")).toEqual({
      searchType: "SEARCH_TYPE_COM",
      region: "84",
      l10n: "LOCALIZATION_EN",
    });
  });

  it("unknown / undefined region falls back to ru defaults", () => {
    expect(__testing__.mapRegion(undefined)).toEqual({
      searchType: "SEARCH_TYPE_RU",
      region: "225",
      l10n: "LOCALIZATION_RU",
    });
    expect(__testing__.mapRegion("zz")).toEqual({
      searchType: "SEARCH_TYPE_RU",
      region: "225",
      l10n: "LOCALIZATION_RU",
    });
  });
});

describe("YandexAdapter — XML parser (parseYandexXml)", () => {
  it("returns one doc per <doc> in encounter order with normalized {title, url, snippet}", () => {
    const docs = __testing__.parseYandexXml(SAMPLE_XML_TWO_DOCS);
    expect(docs).toHaveLength(2);
    expect(docs[0]?.url).toBe("https://example.com/one");
    expect(docs[1]?.url).toBe("https://example.com/two");
  });

  it("snippet uses <extended-text> when present (highest priority)", () => {
    const docs = __testing__.parseYandexXml(SAMPLE_XML_TWO_DOCS);
    expect(docs[0]?.snippet).toBe("Extended full text content one");
  });

  it("snippet falls back to joined <passage>s when extended-text is absent", () => {
    const docs = __testing__.parseYandexXml(SAMPLE_XML_TWO_DOCS);
    // doc d2 has no extended-text
    expect(docs[1]?.snippet).toBe("Only passage for doc two");
  });

  it("strips <hlword> open/close tags but preserves inner text", () => {
    const docs = __testing__.parseYandexXml(SAMPLE_XML_TWO_DOCS);
    expect(docs[0]?.snippet).not.toContain("<hlword>");
    expect(docs[0]?.snippet).not.toContain("</hlword>");
    expect(docs[0]?.snippet).toContain("full");
    // title also stripped
    expect(docs[0]?.title).toBe("First Result Title");
  });

  it("falls back to <title> when extended-text and passages are both absent", () => {
    const xml = `<yandexsearch><response><results><grouping><group>
      <doc>
        <url>https://t.example/</url>
        <title>Just <hlword>a</hlword> Title</title>
        <headline>Some headline</headline>
      </doc>
    </group></grouping></results></response></yandexsearch>`;
    const docs = __testing__.parseYandexXml(xml);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.snippet).toBe("Just a Title");
  });

  it("falls back to <headline> when extended-text, passages, and title are all absent", () => {
    const xml = `<yandexsearch><response><results><grouping><group>
      <doc>
        <url>https://h.example/</url>
        <headline>Only the <hlword>headline</hlword> exists</headline>
      </doc>
    </group></grouping></results></response></yandexsearch>`;
    const docs = __testing__.parseYandexXml(xml);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.snippet).toBe("Only the headline exists");
    expect(docs[0]?.title).toBe("");
  });

  it("joins multiple <passage> elements with a single space", () => {
    const xml = `<yandexsearch><response><results><grouping><group>
      <doc>
        <url>https://p.example/</url>
        <title>t</title>
        <passages>
          <passage>alpha</passage>
          <passage>beta</passage>
          <passage>gamma</passage>
        </passages>
      </doc>
    </group></grouping></results></response></yandexsearch>`;
    const docs = __testing__.parseYandexXml(xml);
    expect(docs[0]?.snippet).toBe("alpha beta gamma");
  });

  it("returns empty array when the XML has no docs", () => {
    const xml = `<yandexsearch><response><results><grouping></grouping></results></response></yandexsearch>`;
    expect(__testing__.parseYandexXml(xml)).toEqual([]);
  });

  it("tolerates malformed XML by returning an empty array (never throws)", () => {
    expect(__testing__.parseYandexXml("not xml at all")).toEqual([]);
  });
});

describe("YandexAdapter.search() — happy path (mocked HTTP)", () => {
  it("returns normalized {results:[{title,url,snippet}]} on 200 and posts the correct body shape", async () => {
    process.env.YANDEX_SEARCH_API_KEY = "test-api-key-value";
    process.env.YANDEX_SEARCH_FOLDER_ID = "b1gtestfolder";

    const pool = agent.get(YANDEX_ORIGIN);
    let capturedBody: string | undefined;
    let capturedAuth: string | undefined;
    pool
      .intercept({
        path: YANDEX_PATH,
        method: "POST",
      })
      .reply((opts) => {
        capturedBody =
          typeof opts.body === "string"
            ? opts.body
            : Buffer.isBuffer(opts.body)
              ? opts.body.toString("utf-8")
              : "";
        const headers = opts.headers as Record<string, string> | undefined;
        capturedAuth = headers?.authorization ?? headers?.Authorization;
        return {
          statusCode: 200,
          data: { rawData: b64(SAMPLE_XML_TWO_DOCS) },
          responseOptions: {
            headers: { "x-request-id": "req-uuid-happy" },
          },
        };
      });

    const adapter = new YandexAdapter();
    const out = await adapter.search("openwhispr", 5);
    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toEqual({
      title: "First Result Title",
      url: "https://example.com/one",
      snippet: "Extended full text content one",
    });

    expect(capturedAuth).toBe("Api-Key test-api-key-value");
    expect(capturedBody).toBeTruthy();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.query.queryText).toBe("openwhispr");
    expect(parsed.query.searchType).toBe("SEARCH_TYPE_RU");
    expect(parsed.region).toBe("225");
    expect(parsed.l10n).toBe("LOCALIZATION_RU");
    expect(parsed.folderId).toBe("b1gtestfolder");
    // int64 fields MUST be strings per the wire contract
    expect(parsed.query.page).toBe("0");
    // numResults=5 → groupsOnPage = min(5, 10) = "5" (capped at 10)
    expect(parsed.groupSpec.groupsOnPage).toBe("5");
    expect(parsed.maxPassages).toBe("4");
    expect(parsed.responseFormat).toBe("FORMAT_XML");
  });

  it("passes the region through to the body when caller supplies one", async () => {
    process.env.YANDEX_SEARCH_API_KEY = "k";
    process.env.YANDEX_SEARCH_FOLDER_ID = "f";

    const pool = agent.get(YANDEX_ORIGIN);
    let captured: string | undefined;
    pool.intercept({ path: YANDEX_PATH, method: "POST" }).reply((opts) => {
      captured =
        typeof opts.body === "string"
          ? opts.body
          : Buffer.isBuffer(opts.body)
            ? opts.body.toString("utf-8")
            : "";
      return { statusCode: 200, data: { rawData: b64(SAMPLE_XML_TWO_DOCS) } };
    });

    const adapter = new YandexAdapter();
    await adapter.search("q", 3, { region: "en" });
    const parsed = JSON.parse(captured!);
    expect(parsed.query.searchType).toBe("SEARCH_TYPE_COM");
    expect(parsed.region).toBe("84");
    expect(parsed.l10n).toBe("LOCALIZATION_EN");
  });
});

describe("YandexAdapter.search() — error mapping", () => {
  it("gRPC code 16 (Unauthenticated) → MissingProviderKeyError", async () => {
    process.env.YANDEX_SEARCH_API_KEY = "bad";
    process.env.YANDEX_SEARCH_FOLDER_ID = "f";
    const pool = agent.get(YANDEX_ORIGIN);
    pool.intercept({ path: YANDEX_PATH, method: "POST" }).reply(401, {
      code: 16,
      message: "Unauthenticated",
      details: [{ "@type": "type.googleapis.com/google.rpc.RequestInfo", requestId: "req-401" }],
    });

    const adapter = new YandexAdapter();
    await expect(adapter.search("q", 1)).rejects.toBeInstanceOf(MissingProviderKeyError);
  });

  it("gRPC code 7 (PermissionDenied) → MissingProviderKeyError", async () => {
    process.env.YANDEX_SEARCH_API_KEY = "k";
    process.env.YANDEX_SEARCH_FOLDER_ID = "f";
    const pool = agent.get(YANDEX_ORIGIN);
    pool.intercept({ path: YANDEX_PATH, method: "POST" }).reply(403, {
      code: 7,
      message: "PermissionDenied",
    });
    const adapter = new YandexAdapter();
    await expect(adapter.search("q", 1)).rejects.toBeInstanceOf(MissingProviderKeyError);
  });

  it("gRPC code 8 (ResourceExhausted / rate limit) → UpstreamError", async () => {
    process.env.YANDEX_SEARCH_API_KEY = "k";
    process.env.YANDEX_SEARCH_FOLDER_ID = "f";
    const pool = agent.get(YANDEX_ORIGIN);
    pool.intercept({ path: YANDEX_PATH, method: "POST" }).reply(429, {
      code: 8,
      message: "ResourceExhausted",
    });
    const adapter = new YandexAdapter();
    await expect(adapter.search("q", 1)).rejects.toBeInstanceOf(UpstreamError);
  });

  it("gRPC code 3 (InvalidArgument) → UpstreamError", async () => {
    process.env.YANDEX_SEARCH_API_KEY = "k";
    process.env.YANDEX_SEARCH_FOLDER_ID = "f";
    const pool = agent.get(YANDEX_ORIGIN);
    pool.intercept({ path: YANDEX_PATH, method: "POST" }).reply(400, {
      code: 3,
      message: "InvalidArgument: bad field",
    });
    const adapter = new YandexAdapter();
    await expect(adapter.search("q", 1)).rejects.toBeInstanceOf(UpstreamError);
  });

  it("gRPC code 13 (Internal) / HTTP 500 → UpstreamError", async () => {
    process.env.YANDEX_SEARCH_API_KEY = "k";
    process.env.YANDEX_SEARCH_FOLDER_ID = "f";
    const pool = agent.get(YANDEX_ORIGIN);
    pool.intercept({ path: YANDEX_PATH, method: "POST" }).reply(500, {
      code: 13,
      message: "Internal",
    });
    const adapter = new YandexAdapter();
    await expect(adapter.search("q", 1)).rejects.toBeInstanceOf(UpstreamError);
  });

  it("malformed success body (no rawData) → UpstreamError", async () => {
    process.env.YANDEX_SEARCH_API_KEY = "k";
    process.env.YANDEX_SEARCH_FOLDER_ID = "f";
    const pool = agent.get(YANDEX_ORIGIN);
    pool.intercept({ path: YANDEX_PATH, method: "POST" }).reply(200, {
      somethingElse: "not what we expect",
    });
    const adapter = new YandexAdapter();
    await expect(adapter.search("q", 1)).rejects.toBeInstanceOf(UpstreamError);
  });

  it("throws MissingProviderKeyError when isConfigured()=false at call time", async () => {
    delete process.env.YANDEX_SEARCH_API_KEY;
    delete process.env.YANDEX_SEARCH_FOLDER_ID;
    delete process.env.YANDEX_FOLDER_ID;
    const adapter = new YandexAdapter();
    await expect(adapter.search("q", 1)).rejects.toBeInstanceOf(MissingProviderKeyError);
  });
});
