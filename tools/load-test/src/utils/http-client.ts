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
 * Logical type for the value returned by `httpFile()`.
 *
 * Two concrete shapes flow through this type at runtime:
 *
 *  1. **k6 path** — the k6 adapter returns the opaque `FileData` produced
 *     by `http.file(bytes, filename, contentType)`. k6 detects multipart
 *     encoding by **runtime type identity** of `FileData` instances in the
 *     body object — NOT by any custom marker. Therefore the k6 adapter
 *     MUST return that host object verbatim and MUST NOT mutate it
 *     (the underlying goja-backed object has non-configurable property
 *     descriptors; `Object.assign` rejects with
 *     `TypeError: Cannot assign to property X of a host object`).
 *     Plan 08.1-followup root-cause fix.
 *
 *  2. **vitest path** — the mock adapter returns a plain JS object
 *     carrying `__k6_http_file: true` plus echo fields so tests can
 *     assert on the descriptor shape without booting k6.
 *
 * Tests should assert via the optional `__k6_http_file` marker only in
 * mock-path code; runtime k6 code must NOT depend on the marker.
 *
 * Plan 08.1-01 Task 2 originally pinned the marker on both paths via
 * `Object.assign`; that was the bug. Plan 08.1-followup separates the
 * two paths cleanly.
 */
export interface HttpFile {
  /**
   * Discriminator present ONLY on the vitest-mock path. The k6-runtime
   * `FileData` object does NOT carry this property; tests that hit the
   * k6 adapter must not require it.
   */
  readonly __k6_http_file?: true;
  bytes?: Uint8Array;
  filename?: string;
  contentType?: string;
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

/**
 * k6-runtime FileData factory. Returns the opaque host object produced by
 * `http.file(...)` UNCHANGED — k6 detects multipart encoding by type
 * identity, and the goja-backed FileData has non-configurable property
 * descriptors. Any `Object.assign` on it throws
 * `TypeError: Cannot assign to property X of a host object` at every VU
 * iteration. Plan 08.1-followup root-cause fix (regression of plan
 * 08.1-01 Task 2).
 *
 * This function is exported so its non-k6 fail-path is unit-testable.
 * The k6-happy-path branch (where `globalThis.__k6_http` IS defined) is
 * covered by `__tests__` that stub the global with a faux FileData
 * factory returning a frozen object — proving we never mutate it.
 */
export function k6HttpFile(bytes: Uint8Array, filename: string, contentType: string): HttpFile {
  const http = (globalThis as unknown as { __k6_http?: unknown }).__k6_http;
  if (!http) {
    throw new Error("createK6Adapter().httpFile invoked outside the k6 runtime");
  }
  // Return the FileData verbatim. k6's http.request detects multipart by
  // runtime type identity of *FileData instances in the body object — it
  // does not need any custom marker. Mutating the host object via
  // Object.assign throws under goja because its properties are
  // non-configurable. The TypeScript HttpFile type is intentionally
  // structural; the FileData is type-asserted at this boundary.
  const fd = (http as { file: (b: Uint8Array, f: string, ct: string) => unknown }).file(
    bytes,
    filename,
    contentType,
  );
  return fd as HttpFile;
}

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
