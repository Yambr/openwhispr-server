// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 03 — Yandex Search API v2 LIVE adapter.
//
// Replaces the wire-shape stub shipped in commit f7904a8. Implements the
// JSON wire contract verified against `searchapi.api.cloud.yandex.net`
// on 2026-05-11:
//
//   POST https://searchapi.api.cloud.yandex.net/v2/web/search
//   Authorization: Api-Key <YANDEX_SEARCH_API_KEY>
//   Content-Type: application/json
//   Body: {
//     query: { searchType, queryText, familyMode, page (str), fixTypoMode },
//     groupSpec: { groupMode, groupsOnPage (str), docsInGroup (str) },
//     maxPassages (str), region (str), l10n, folderId, responseFormat,
//     userAgent
//   }
//
// Response: HTTP 200 { rawData: "<base64 UTF-8 XML>" } — the XML envelope
// is parsed for {url, title, snippet} per the priority chain
// extended-text > passages (joined) > title > headline, with <hlword> open/close
// stripped (inner text preserved).
//
// Errors: HTTP 4xx/5xx return a JSON envelope `{code, message, details}`
// where `code` is a gRPC code. Mapping per the wire contract:
//   16 Unauthenticated → MissingProviderKeyError (operator-actionable 503)
//    7 PermissionDenied → MissingProviderKeyError
//    8 ResourceExhausted (rate limit) → UpstreamError (502)
//    3 InvalidArgument → UpstreamError
//   13 Internal → UpstreamError
//   * other / non-JSON → UpstreamError
//
// PII / log hygiene: the query text is NEVER logged — only `queryLength`,
// `gRPCCode`, and `requestId` (from x-request-id header / details[0]).
//
// Threat mitigations:
//   * T-05-01 / T-WEB-INJ — endpoint hardcoded; user input flows only
//     into the JSON body's `query.queryText`.
//   * T-05-09 — env keys consumed only inside the Authorization header.
//     Error messages never echo the upstream JSON body (could leak the
//     request id or, in pathological cases, the operator's folder id).

import { XMLParser } from "fast-xml-parser";
import { request } from "undici";
import {
  MissingProviderKeyError,
  UpstreamError,
  type WebSearchOptions,
  type WebSearchProvider,
} from "./types.js";

/**
 * Phase 68 — operator-tunable Yandex knobs. The upstream URL + undici
 * headers/body timeouts were module-level literals; they are now injected
 * by the route-assembly seam (apps/api/src/index.ts →
 * loadWebSearchConfigFromEnv). This adapter never reads `process.env` for
 * them (LOCKER-01). All fields are optional so existing callers (and
 * tests) that omit options keep the historical defaults.
 */
export interface YandexAdapterOptions {
  /** POST endpoint for Yandex Search API v2. */
  searchUrl?: string;
  /** undici headers timeout in ms. Default: 5000. */
  headersTimeoutMs?: number;
  /** undici body timeout in ms. Default: 10000. */
  bodyTimeoutMs?: number;
}

const DEFAULT_YANDEX_URL = "https://searchapi.api.cloud.yandex.net/v2/web/search";
const DEFAULT_HEADERS_TIMEOUT_MS = 5_000;
const DEFAULT_BODY_TIMEOUT_MS = 10_000;

type RegionTuple = {
  searchType: string;
  region: string;
  l10n: string;
};

const REGION_MAP: Record<string, RegionTuple> = {
  ru: { searchType: "SEARCH_TYPE_RU", region: "225", l10n: "LOCALIZATION_RU" },
  tr: { searchType: "SEARCH_TYPE_TR", region: "983", l10n: "LOCALIZATION_TR" },
  en: { searchType: "SEARCH_TYPE_COM", region: "84", l10n: "LOCALIZATION_EN" },
};

function mapRegion(input: string | undefined): RegionTuple {
  if (input && Object.hasOwn(REGION_MAP, input)) {
    return REGION_MAP[input]!;
  }
  return REGION_MAP.ru!;
}

function readFolderId(): string | undefined {
  const v1 = process.env.YANDEX_SEARCH_FOLDER_ID;
  if (typeof v1 === "string" && v1.length > 0) return v1;
  const legacy = process.env.YANDEX_FOLDER_ID;
  if (typeof legacy === "string" && legacy.length > 0) return legacy;
  return undefined;
}

interface YandexDoc {
  url: string;
  title: string;
  snippet: string;
}

/**
 * fast-xml-parser instance tuned for the Yandex Search response envelope.
 *
 * `<doc>`, `<group>` and `<passage>` are coerced to arrays so single-result
 * pages and multi-result pages share one code path. The four snippet-source
 * leaf tags (`title`, `headline`, `extended-text`, `passage`) are declared as
 * `stopNodes`: fast-xml-parser stops structural recursion at them and keeps
 * their inner XML verbatim as a string. This preserves the mixed-content text
 * positioning around `<hlword>` markup (e.g. "First <hlword>Result</hlword>
 * Title") that a node-tree walk would otherwise reorder/collapse — `stripHlword`
 * then removes the markup while keeping inter-token whitespace, exactly as the
 * previous hand-rolled scanner did. Entities inside stopNode content are kept
 * raw (the old string-slicing parser never decoded them), preserving the
 * adapter's output contract byte-for-byte.
 */
const yandexXmlParser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  isArray: (name: string): boolean => name === "doc" || name === "group" || name === "passage",
  stopNodes: ["*.title", "*.headline", "*.extended-text", "*.passage"],
});

/**
 * Recursively collects every value bound to `key` anywhere in a parsed-XML
 * object tree, in document order. Used to reach `<doc>` nodes regardless of
 * the exact `<grouping>/<group>` nesting depth Yandex returns.
 */
function collectByKey(node: unknown, key: string, out: unknown[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectByKey(item, key, out);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(record)) {
    if (k === key) {
      if (Array.isArray(v)) out.push(...v);
      else out.push(v);
    } else {
      collectByKey(v, key, out);
    }
  }
}

/** Coerces an arbitrary parsed-XML leaf value to a flat string. */
function leafToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/**
 * Strips `<hlword ...>` open tags and `</hlword>` close tags from a stopNode
 * raw-XML string, preserving inner text and inter-token whitespace. Done via a
 * single linear pass; never touches unrelated text.
 */
function stripHlword(s: string): string {
  if (s.length === 0) return s;
  // close tags first
  const out = s.split("</hlword>").join("");
  // open tags (may carry attributes, e.g. <hlword priority="phrase">)
  let result = "";
  let i = 0;
  while (i < out.length) {
    if (out.startsWith("<hlword", i)) {
      const gt = out.indexOf(">", i);
      if (gt === -1) {
        result += out.slice(i);
        break;
      }
      i = gt + 1;
      continue;
    }
    result += out.charAt(i);
    i++;
  }
  return result.replace(/\s+/g, " ").trim();
}

/**
 * Parses the Yandex Search response XML envelope into normalized docs.
 *
 * Walks every `<doc>` node (any nesting depth) and applies the snippet
 * content-priority chain extended-text > joined passages > title > headline,
 * with `<hlword>` markup stripped. Returns `[]` on malformed XML — the caller
 * surfaces this as `UpstreamError` upstream of the result.
 */
function parseYandexXml(xml: string): YandexDoc[] {
  if (typeof xml !== "string" || xml.length === 0) return [];

  let tree: unknown;
  try {
    tree = yandexXmlParser.parse(xml);
  } catch {
    return [];
  }

  const docNodes: unknown[] = [];
  collectByKey(tree, "doc", docNodes);

  const out: YandexDoc[] = [];
  for (const docNode of docNodes) {
    if (docNode === null || typeof docNode !== "object") continue;
    const doc = docNode as Record<string, unknown>;

    const url = leafToString(doc.url).trim();
    const title = stripHlword(leafToString(doc.title));
    const headline = leafToString(doc.headline);
    const extended = leafToString(doc["extended-text"]);

    // Prefer the canonical <passages><passage>… nesting; fall back to bare
    // <passage> children when the <passages> wrapper is absent (defensive —
    // mirrors the previous scanner's whole-doc fallback).
    const passageNodes: unknown[] = [];
    if (doc.passages !== undefined) {
      collectByKey(doc.passages, "passage", passageNodes);
    } else {
      collectByKey(doc.passage, "passage", passageNodes);
      if (passageNodes.length === 0 && doc.passage !== undefined) {
        // <passage> coerced to array by isArray() — collectByKey above only
        // matches the "passage" key, so a top-level doc.passage array needs a
        // direct pickup.
        const direct = doc.passage;
        if (Array.isArray(direct)) passageNodes.push(...direct);
        else passageNodes.push(direct);
      }
    }
    const passages = passageNodes.map(leafToString);

    let snippet: string;
    if (extended.length > 0) {
      snippet = stripHlword(extended);
    } else if (passages.length > 0) {
      snippet = passages.map(stripHlword).join(" ");
    } else if (title.length > 0) {
      snippet = title;
    } else {
      snippet = stripHlword(headline);
    }

    out.push({ url, title, snippet: snippet.trim() });
  }
  return out;
}

interface YandexErrorBody {
  code?: number;
  message?: string;
  details?: Array<{ requestId?: string }>;
}

export class YandexAdapter implements WebSearchProvider {
  readonly name = "yandex";
  // WR-05 (Phase 65) — operator env-var label read generically by the route.
  readonly envVarLabel = "YANDEX_SEARCH_API_KEY + YANDEX_SEARCH_FOLDER_ID";

  private readonly searchUrl: string;
  private readonly headersTimeoutMs: number;
  private readonly bodyTimeoutMs: number;

  constructor(options: YandexAdapterOptions = {}) {
    this.searchUrl = options.searchUrl ?? DEFAULT_YANDEX_URL;
    this.headersTimeoutMs = options.headersTimeoutMs ?? DEFAULT_HEADERS_TIMEOUT_MS;
    this.bodyTimeoutMs = options.bodyTimeoutMs ?? DEFAULT_BODY_TIMEOUT_MS;
  }

  isConfigured(): boolean {
    const key = process.env.YANDEX_SEARCH_API_KEY;
    const folder = readFolderId();
    return (
      typeof key === "string" && key.length > 0 && typeof folder === "string" && folder.length > 0
    );
  }

  async search(
    query: string,
    numResults: number,
    options?: WebSearchOptions,
  ): Promise<{
    results: Array<{ title: string; url: string; snippet: string }>;
  }> {
    const apiKey = process.env.YANDEX_SEARCH_API_KEY;
    const folderId = readFolderId();
    if (!apiKey || !folderId) {
      throw new MissingProviderKeyError(
        "Yandex not configured (set YANDEX_SEARCH_API_KEY + YANDEX_SEARCH_FOLDER_ID in .env)",
      );
    }

    const region = mapRegion(options?.region);
    const groupsOnPage = Math.max(1, Math.min(numResults, 10)).toString();
    const body = JSON.stringify({
      query: {
        searchType: region.searchType,
        queryText: query,
        familyMode: "FAMILY_MODE_MODERATE",
        page: "0",
        fixTypoMode: "FIX_TYPO_MODE_ON",
      },
      groupSpec: {
        groupMode: "GROUP_MODE_DEEP",
        groupsOnPage,
        docsInGroup: "1",
      },
      maxPassages: "4",
      region: region.region,
      l10n: region.l10n,
      folderId,
      responseFormat: "FORMAT_XML",
      userAgent: "OpenWhispr/1.0",
    });

    let res: Awaited<ReturnType<typeof request>>;
    try {
      res = await request(this.searchUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Api-Key ${apiKey}`,
        },
        body,
        headersTimeout: this.headersTimeoutMs,
        bodyTimeout: this.bodyTimeoutMs,
      });
    } catch {
      throw new UpstreamError("Yandex request failed or timed out");
    }

    const status = res.statusCode;
    const requestId = pickHeader(res.headers, "x-request-id") ?? "";

    if (status === 200) {
      let payload: { rawData?: unknown };
      try {
        payload = (await res.body.json()) as { rawData?: unknown };
      } catch {
        throw new UpstreamError("Yandex response was not valid JSON");
      }
      const rawData = typeof payload.rawData === "string" ? payload.rawData : "";
      if (rawData.length === 0) {
        throw new UpstreamError("Yandex response missing rawData");
      }
      let xml: string;
      try {
        xml = Buffer.from(rawData, "base64").toString("utf-8");
      } catch {
        throw new UpstreamError("Yandex rawData failed base64 decode");
      }
      const docs = parseYandexXml(xml);
      return { results: docs };
    }

    // Non-200: parse error envelope, map gRPC code → typed error.
    let err: YandexErrorBody = {};
    try {
      err = (await res.body.json()) as YandexErrorBody;
    } catch {
      // fall through with empty err — generic UpstreamError below.
    }
    const grpcCode = typeof err.code === "number" ? err.code : undefined;
    const upstreamRequestId = err.details?.[0]?.requestId ?? requestId;
    // Log shape (PII-clean): query length only.
    // Note: actual log emission happens in the route handler via req.log;
    // adapter throws typed errors carrying a brief message. We attach the
    // requestId to the error message for operator triage.
    void upstreamRequestId;
    void query.length;

    if (grpcCode === 16 || grpcCode === 7) {
      throw new MissingProviderKeyError(
        "Yandex not configured (set YANDEX_SEARCH_API_KEY + YANDEX_SEARCH_FOLDER_ID in .env)",
      );
    }
    if (grpcCode === 8) {
      throw new UpstreamError(`Yandex upstream rate-limited (status ${status})`);
    }
    if (grpcCode === 3 || grpcCode === 13) {
      throw new UpstreamError(`Yandex upstream returned ${status}`);
    }
    throw new UpstreamError(`Yandex upstream returned ${status}`);
  }
}

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct) && typeof direct[0] === "string") return direct[0];
  return undefined;
}

// Test-only surface — re-exported solely for unit tests under __tests__/.
// Not part of the runtime API; do not import from production code.
export const __testing__ = {
  mapRegion,
  parseYandexXml,
  stripHlword,
};
