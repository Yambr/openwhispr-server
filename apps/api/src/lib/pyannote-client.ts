// Phase 03 / Plan 06 / Task 1 — pyannote.ai REST client (D-07 REVISED).
//
// Thin undici wrapper over the 4-step pyannote.ai async API:
//
//   1. POST /v1/media/input            → presigned PUT URL + media:// URI
//   2. PUT  <presigned URL>            → upload binary audio bytes
//   3. POST /v1/diarize {url}          → submit job, returns jobId
//   4. GET  /v1/jobs/{jobId}           → poll until status === 'succeeded'
//
// PYANNOTE_API_KEY is consumed HERE — NEVER by the LiteLLM container.
// (D-07 REVISED, 2026-05-10: pyannote pass_through_endpoints removed
// from compose/litellm/litellm_config.yaml because LiteLLM single-hop
// pass-through cannot drive the 4-step async flow.)
//
// Error taxonomy (consumed by the diarization route's mapPyannoteError):
//   - MissingPyannoteKeyError    → factory throws BEFORE first HTTP call.
//                                   Route surfaces 503 + operator-actionable
//                                   message.
//   - PyannoteAuthError (401/403) → Route surfaces 503 (NEVER 401 — Pitfall
//                                   #8: a 401 to the desktop triggers
//                                   tokenStore sign-out).
//   - PyannoteUnavailableError (5xx) → Route surfaces 503 + Retry-After: 30.
//   - PyannoteBadRequestError (4xx other) → Route surfaces 502 (upstream
//                                            rejected our payload).
//   - PyannoteUpstreamError (presigned PUT non-2xx, etc.) → Route surfaces
//                                                            502.

import { request, type Dispatcher } from "undici";

export class MissingPyannoteKeyError extends Error {
  override name = "MissingPyannoteKeyError";
  constructor() {
    super(
      "PYANNOTE_API_KEY is not configured. Set it in .env to enable diarization, or set LITELLM_BASE_URL to a corporate LiteLLM with a single-hop diarization endpoint.",
    );
  }
}

export class PyannoteAuthError extends Error {
  override name = "PyannoteAuthError";
  constructor(public readonly status: number, message?: string) {
    super(message ?? `pyannote auth failed (${status})`);
  }
}

export class PyannoteUnavailableError extends Error {
  override name = "PyannoteUnavailableError";
  constructor(public readonly status: number, message?: string) {
    super(message ?? `pyannote unavailable (${status})`);
  }
}

/**
 * WR-04: keep upstream body OFF the Error message (`.message` may be
 * surfaced via `req.log.warn` or echoed by middleware that doesn't
 * know to redact). Body is parked on a separate `bodyText` field for
 * structured diagnostics.
 */
export class PyannoteBadRequestError extends Error {
  override name = "PyannoteBadRequestError";
  public readonly bodyText: string;
  constructor(
    public readonly status: number,
    bodyText = "",
  ) {
    super(`pyannote ${status}`);
    this.bodyText = bodyText;
  }
}

export class PyannoteUpstreamError extends Error {
  override name = "PyannoteUpstreamError";
  public readonly bodyText: string;
  constructor(
    public readonly status: number,
    bodyText = "",
  ) {
    super(`pyannote ${status}`);
    this.bodyText = bodyText;
  }
}

export type PyannoteJobStatus =
  | "created"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface PyannoteSegment {
  start: number;
  end: number;
  speaker: string;
}

export interface PyannoteJob {
  jobId: string;
  status: PyannoteJobStatus;
  output?: {
    duration: number;
    segments: PyannoteSegment[];
  };
}

export interface PyannoteClient {
  /** POST /v1/media/input → returns presigned PUT URL + media:// URI for /v1/diarize. */
  createMediaInput(): Promise<{ url: string; mediaUri: string }>;
  /** PUT binary bytes to a presigned URL returned by createMediaInput(). */
  uploadToPresignedUrl(
    url: string,
    body: NodeJS.ReadableStream | Buffer,
    contentType: string,
  ): Promise<void>;
  /** POST /v1/diarize {url: mediaUri} → returns jobId. */
  submitDiarize(mediaUri: string): Promise<string>;
  /** GET /v1/jobs/{jobId} → returns full job payload; supports AbortSignal. */
  pollJob(jobId: string, signal?: AbortSignal): Promise<PyannoteJob>;
}

export interface CreatePyannoteClientOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Test seam — defaults to undici's global request (honors setGlobalDispatcher). */
  request?: typeof request;
  dispatcher?: Dispatcher;
}

const DEFAULT_BASE_URL = "https://api.pyannote.ai";

export function createPyannoteClient(
  opts: CreatePyannoteClientOptions = {},
): PyannoteClient {
  const apiKey = opts.apiKey ?? process.env.PYANNOTE_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    throw new MissingPyannoteKeyError();
  }
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const auth = `Bearer ${apiKey}`;
  const doRequest = opts.request ?? request;

  function classify(status: number, body: string): never {
    if (status === 401 || status === 403) {
      throw new PyannoteAuthError(status, `pyannote auth failed (${status})`);
    }
    if (status >= 500) {
      throw new PyannoteUnavailableError(status, `pyannote ${status}`);
    }
    if (status >= 400) {
      // WR-04: bodyText (truncated to 200 chars) is parked on the Error
      // for structured diagnostics; the .message stays generic so any
      // accidental log of err.message can't leak upstream payload.
      throw new PyannoteBadRequestError(status, body.slice(0, 200));
    }
    throw new PyannoteUpstreamError(status, body.slice(0, 200));
  }

  function deriveMediaUri(presignedUrl: string): string {
    // pyannote.ai's /v1/media/input returns a presigned URL whose final
    // path segment is the unique storage key. The /v1/diarize endpoint
    // expects the matching `media://<key>` URI. We extract conservatively;
    // pyannote's documented shape may evolve and a future API revision
    // could return a separate `mediaUri` field — when that lands we read
    // it directly without changing call sites.
    try {
      const u = new URL(presignedUrl);
      const segments = u.pathname.split("/").filter(Boolean);
      const key = segments.length > 0 ? segments[segments.length - 1] : "";
      return `media://${key || "unknown"}`;
    } catch {
      return "media://unknown";
    }
  }

  return {
    async createMediaInput() {
      const reqOpts: Parameters<typeof doRequest>[1] = {
        method: "POST",
        headers: {
          authorization: auth,
          "content-type": "application/json",
        },
        body: "{}",
      };
      if (opts.dispatcher) {
        (reqOpts as { dispatcher?: Dispatcher }).dispatcher = opts.dispatcher;
      }
      const res = await doRequest(`${baseUrl}/v1/media/input`, reqOpts);
      if (res.statusCode >= 300) {
        const text = await res.body.text();
        classify(res.statusCode, text);
      }
      const json = (await res.body.json()) as {
        url: string;
        mediaUri?: string;
      };
      const url = json.url;
      const mediaUri = json.mediaUri ?? deriveMediaUri(url);
      return { url, mediaUri };
    },

    async uploadToPresignedUrl(url, body, contentType) {
      const reqOpts: Parameters<typeof doRequest>[1] = {
        method: "PUT",
        headers: { "content-type": contentType },
        body,
      };
      if (opts.dispatcher) {
        (reqOpts as { dispatcher?: Dispatcher }).dispatcher = opts.dispatcher;
      }
      const res = await doRequest(url, reqOpts);
      if (res.statusCode >= 300) {
        const text = await res.body.text();
        // WR-04: park body text on the Error's bodyText field, not in
        // the user-visible .message — defense against incidental logs.
        throw new PyannoteUpstreamError(res.statusCode, text.slice(0, 200));
      }
      // Drain so the connection can return to the pool.
      try {
        await res.body.text();
      } catch {
        /* best-effort */
      }
    },

    async submitDiarize(mediaUri) {
      const reqOpts: Parameters<typeof doRequest>[1] = {
        method: "POST",
        headers: {
          authorization: auth,
          "content-type": "application/json",
        },
        body: JSON.stringify({ url: mediaUri }),
      };
      if (opts.dispatcher) {
        (reqOpts as { dispatcher?: Dispatcher }).dispatcher = opts.dispatcher;
      }
      const res = await doRequest(`${baseUrl}/v1/diarize`, reqOpts);
      if (res.statusCode >= 300) {
        const text = await res.body.text();
        classify(res.statusCode, text);
      }
      const json = (await res.body.json()) as { jobId: string };
      return json.jobId;
    },

    async pollJob(jobId, signal) {
      if (signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      const reqOpts: Parameters<typeof doRequest>[1] = {
        method: "GET",
        headers: { authorization: auth },
      };
      if (signal) {
        (reqOpts as { signal?: AbortSignal }).signal = signal;
      }
      if (opts.dispatcher) {
        (reqOpts as { dispatcher?: Dispatcher }).dispatcher = opts.dispatcher;
      }
      const res = await doRequest(
        `${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}`,
        reqOpts,
      );
      if (res.statusCode >= 300) {
        const text = await res.body.text();
        classify(res.statusCode, text);
      }
      return (await res.body.json()) as PyannoteJob;
    },
  };
}

export default createPyannoteClient;
