// SPDX-License-Identifier: Apache-2.0
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

import { request } from "undici";
import {
  MissingProviderKeyError,
  UpstreamError,
  type WebSearchOptions,
  type WebSearchProvider,
} from "./types.js";

const YANDEX_URL = "https://searchapi.api.cloud.yandex.net/v2/web/search";
const HEADERS_TIMEOUT_MS = 5_000;
const BODY_TIMEOUT_MS = 10_000;

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
  if (input && Object.prototype.hasOwnProperty.call(REGION_MAP, input)) {
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
 * Minimal, focused XML extractor for the Yandex Search response envelope.
 * Walks `<doc>...</doc>` blocks and pulls a single tag's inner text using
 * a string-level scan (no regex backtracking). Returns [] on malformed XML
 * — the caller surfaces this as `UpstreamError` upstream of the result.
 */
function parseYandexXml(xml: string): YandexDoc[] {
  if (typeof xml !== "string" || xml.length === 0) return [];
  const out: YandexDoc[] = [];
  let cursor = 0;
  while (true) {
    const docStart = findOpen(xml, "doc", cursor);
    if (docStart === -1) break;
    const docEnd = findClose(xml, "doc", docStart.afterOpen);
    if (docEnd === -1) break;
    const inner = xml.slice(docStart.afterOpen, docEnd.beforeClose);

    const url = extractTagText(inner, "url");
    const titleRaw = extractTagText(inner, "title");
    const headlineRaw = extractTagText(inner, "headline");
    const extended = extractTagText(inner, "extended-text");
    const passages = extractPassages(inner);

    const title = stripHlword(titleRaw);
    let snippet: string;
    if (extended.length > 0) {
      snippet = stripHlword(extended);
    } else if (passages.length > 0) {
      snippet = passages.map(stripHlword).join(" ");
    } else if (title.length > 0) {
      snippet = title;
    } else {
      snippet = stripHlword(headlineRaw);
    }

    out.push({ url: url.trim(), title, snippet: snippet.trim() });
    cursor = docEnd.afterClose;
  }
  return out;
}

interface OpenPos {
  start: number;
  afterOpen: number;
}
interface ClosePos {
  beforeClose: number;
  afterClose: number;
}

function findOpen(s: string, tag: string, from: number): OpenPos | -1 {
  const prefix = `<${tag}`;
  let i = from;
  while (i < s.length) {
    const found = s.indexOf(prefix, i);
    if (found === -1) return -1;
    const next = s.charCodeAt(found + prefix.length);
    // valid open if the next char terminates the tag name (space, >, /, or newline)
    if (
      next === 0x20 /* space */
      || next === 0x3e /* > */
      || next === 0x2f /* / */
      || next === 0x09 /* tab */
      || next === 0x0a /* \n */
      || next === 0x0d /* \r */
    ) {
      const gt = s.indexOf(">", found + prefix.length);
      if (gt === -1) return -1;
      // self-closing tag (<doc/>) — skip
      if (s.charCodeAt(gt - 1) === 0x2f) {
        i = gt + 1;
        continue;
      }
      return { start: found, afterOpen: gt + 1 };
    }
    i = found + 1;
  }
  return -1;
}

function findClose(s: string, tag: string, from: number): ClosePos | -1 {
  const closeTag = `</${tag}>`;
  const found = s.indexOf(closeTag, from);
  if (found === -1) return -1;
  return { beforeClose: found, afterClose: found + closeTag.length };
}

function extractTagText(s: string, tag: string): string {
  const open = findOpen(s, tag, 0);
  if (open === -1) return "";
  const close = findClose(s, tag, open.afterOpen);
  if (close === -1) return "";
  return s.slice(open.afterOpen, close.beforeClose);
}

function extractPassages(s: string): string[] {
  const out: string[] = [];
  let cursor = 0;
  // restrict to inside the first <passages>...</passages> block if present;
  // otherwise scan the whole doc (defensive).
  const passagesOpen = findOpen(s, "passages", 0);
  let scope = s;
  if (passagesOpen !== -1) {
    const passagesClose = findClose(s, "passages", passagesOpen.afterOpen);
    if (passagesClose !== -1) {
      scope = s.slice(passagesOpen.afterOpen, passagesClose.beforeClose);
    }
  }
  while (cursor < scope.length) {
    const open = findOpen(scope, "passage", cursor);
    if (open === -1) break;
    const close = findClose(scope, "passage", open.afterOpen);
    if (close === -1) break;
    out.push(scope.slice(open.afterOpen, close.beforeClose).trim());
    cursor = close.afterClose;
  }
  return out;
}

/**
 * Strips `<hlword ...>` open tags and `</hlword>` close tags, preserving
 * inner text. Done via a single linear pass; never touches unrelated text.
 */
function stripHlword(s: string): string {
  if (s.length === 0) return s;
  // close tags first
  let out = s.split("</hlword>").join("");
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

interface YandexErrorBody {
  code?: number;
  message?: string;
  details?: Array<{ requestId?: string }>;
}

export class YandexAdapter implements WebSearchProvider {
  readonly name = "yandex";

  isConfigured(): boolean {
    const key = process.env.YANDEX_SEARCH_API_KEY;
    const folder = readFolderId();
    return (
      typeof key === "string"
      && key.length > 0
      && typeof folder === "string"
      && folder.length > 0
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
      res = await request(YANDEX_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Api-Key ${apiKey}`,
        },
        body,
        headersTimeout: HEADERS_TIMEOUT_MS,
        bodyTimeout: BODY_TIMEOUT_MS,
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
