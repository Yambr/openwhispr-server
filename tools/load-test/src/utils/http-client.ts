// Phase 08 / Plan 06 — Task 1 GREEN: injectable HTTP client interface
// used by the four k6 flow files.
//
// Why an interface at all? k6's `http` and `websockets` globals are only
// available at k6 runtime, so the flow logic must remain testable in
// vitest. Each flow takes an HttpClient as its second argument; in k6
// runtime the flow uses `createK6Adapter()`, and in vitest the test
// passes `createMockAdapter({ request: vi.fn() })`.
//
// The k6 adapter itself wraps `k6/http` and `k6/websockets` with the
// thinnest possible shim. Because those modules are k6 runtime globals
// (not resolvable by Node), this file uses dynamic `import()` so vitest
// can load the module without choking. The adapter's k6 branches are
// excluded from coverage by vitest.config.ts (`createK6Adapter` body).

/** Per-request options the flows pass through to k6. */
export interface RequestOptions {
  headers?: Record<string, string>;
  /** k6 metric tags — surface so `http_req_duration{endpoint:reason}` works. */
  tags?: Record<string, string>;
}

/** Response shape that mirrors a subset of k6's http response object. */
export interface HttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
  timings: { waiting: number; duration: number };
}

/** Params accepted by ws() — headers + cookies for the initial handshake. */
export interface WsParams {
  headers?: Record<string, string>;
  tags?: Record<string, string>;
}

/**
 * The minimal websocket surface our flows use. k6's `k6/websockets`
 * module exposes browser-style `addEventListener`; we type only the
 * shape we need.
 */
export interface WsSocket {
  send(data: string): void;
  addEventListener(
    event: "open" | "message" | "error" | "close",
    cb: (payload?: unknown) => void,
  ): void;
  close(code?: number, reason?: string): void;
}

/** ws() return shape — k6's experimental websockets reports status. */
export interface WsResponse {
  status: number;
}

/**
 * Sentinel returned by `httpFile()` — flows wrap binary multipart fields
 * with this so k6's `http.request` detects a multipart upload (k6 switches
 * the request encoding to multipart/form-data only when at least one body
 * field is an `http.file()` value). In vitest the helper just returns the
 * shape verbatim; the k6 adapter unwraps it at runtime to a real
 * `http.file(bytes, filename, contentType)` call. Plan 08.1-01 Task 2 fix.
 */
export interface HttpFile {
  /** Discriminator — the k6 adapter checks for this to swap in `http.file()`. */
  readonly __k6_http_file: true;
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

/** The interface every flow function consumes. */
export interface HttpClient {
  request(method: string, url: string, body?: unknown, opts?: RequestOptions): HttpResponse;
  ws(url: string, params: WsParams, handler: (socket: WsSocket) => void): WsResponse;
  /**
   * Wrap raw bytes as a multipart file part. The returned value MUST be
   * placed in the body object passed to `request()` — its presence triggers
   * k6's multipart-encoding code path at runtime.
   */
  httpFile(bytes: Uint8Array, filename: string, contentType: string): HttpFile;
}

/**
 * Construct the k6-runtime adapter. This function is only meaningful
 * inside a k6 VM — the body lazily reaches for k6 globals via the
 * `globalThis` namespace populated by k6 at script init.
 *
 * In vitest the adapter is never invoked; this file's tests only
 * verify the returned object satisfies the HttpClient shape (typeof
 * request/ws === 'function'). The function bodies fail loudly if called
 * outside k6 (Node won't expose `k6/http`), which is the desired
 * contract — flows must always pass a mock adapter in tests.
 */
/* c8 ignore start */
function k6Request(
  method: string,
  url: string,
  body: unknown,
  opts: RequestOptions | undefined,
): HttpResponse {
  // Dynamic require so vitest does not try to resolve `k6/http` at
  // module-load time. The k6 VM injects this module synchronously, so
  // even though we use `import(...)` syntax via globalThis lookup, the
  // runtime resolves it immediately.
  const http = (globalThis as unknown as { __k6_http?: unknown }).__k6_http;
  if (!http) {
    throw new Error("createK6Adapter().request invoked outside the k6 runtime");
  }
  const params = {
    headers: opts?.headers ?? {},
    tags: opts?.tags ?? {},
  };
  // k6 http.request signature: request(method, url, body, params)
  return (
    http as {
      request: (m: string, u: string, b: unknown, p: unknown) => HttpResponse;
    }
  ).request(method, url, body, params);
}

function k6Ws(url: string, params: WsParams, handler: (socket: WsSocket) => void): WsResponse {
  const ws = (globalThis as unknown as { __k6_ws?: unknown }).__k6_ws;
  if (!ws) {
    throw new Error("createK6Adapter().ws invoked outside the k6 runtime");
  }
  // k6/websockets exports WebSocket; we use the experimental API where
  // the constructor takes (url, params) and event handlers are attached
  // before the open event fires.
  const W = (ws as { WebSocket: new (u: string, p: WsParams) => WsSocket }).WebSocket;
  const socket = new W(url, params);
  handler(socket);
  return { status: 101 };
}
/* c8 ignore stop */

/* c8 ignore start */
function k6HttpFile(bytes: Uint8Array, filename: string, contentType: string): HttpFile {
  const http = (globalThis as unknown as { __k6_http?: unknown }).__k6_http;
  if (!http) {
    throw new Error("createK6Adapter().httpFile invoked outside the k6 runtime");
  }
  // k6's http.file(data, filename, contentType) returns the FileData
  // descriptor k6 recognises to switch the request to multipart encoding.
  // We tag the returned object with __k6_http_file so test adapters can
  // detect wrapped fields without depending on the k6 runtime.
  const fd = (
    http as { file: (b: Uint8Array, f: string, ct: string) => Record<string, unknown> }
  ).file(bytes, filename, contentType);
  return Object.assign(fd, {
    __k6_http_file: true as const,
    bytes,
    filename,
    contentType,
  });
}
/* c8 ignore stop */

export function createK6Adapter(): HttpClient {
  return {
    request: k6Request,
    ws: k6Ws,
    httpFile: k6HttpFile,
  };
}

/**
 * Construct a mock adapter for vitest. Pass only the methods the test
 * exercises; the others throw if invoked, surfacing test gaps loudly.
 */
export function createMockAdapter(impl: Partial<HttpClient>): HttpClient {
  return {
    request: (method, url, body, opts) => {
      if (!impl.request) {
        throw new Error("createMockAdapter: request() is not mocked");
      }
      return impl.request(method, url, body, opts);
    },
    ws: (url, params, handler) => {
      if (!impl.ws) {
        throw new Error("createMockAdapter: ws() is not mocked");
      }
      return impl.ws(url, params, handler);
    },
    // Default httpFile implementation — tests that don't override get a
    // hermetic, type-safe wrapper. Tests that want to inspect the call
    // pattern can override with a vi.fn() in `impl`.
    httpFile: impl.httpFile
      ? impl.httpFile
      : (bytes, filename, contentType) => ({
          __k6_http_file: true as const,
          bytes,
          filename,
          contentType,
        }),
  };
}
