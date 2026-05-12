# Audit — k6 host-object mutation (Plan 08.1-followup)

**Trigger:** transcribe-flow regression `TypeError: Cannot assign to
property __k6_http_file of a host object` (commit `638c342`, Plan
08.1-01 Task 2). Root cause + fix: commit `3ad3470` on `main`.

**Scope:** every other k6 flow + adapter wrapper in
`tools/load-test/src/` — verify none of them mutate a value returned by
a `k6/http` or `k6/websockets` API. Same failure mode would otherwise
strike any code path doing `Object.assign(<k6-host-object>, ...)`,
`<k6-host-object>.foo = ...`, or `delete <k6-host-object>.bar`.

## Findings

| File | Verdict | Evidence |
| ---- | ------- | -------- |
| `src/flows/transcribe.ts` | **FIXED (G1)** | Body field `file` now holds the FileData reference verbatim (commit `3ad3470`). No mutation. |
| `src/flows/reason.ts` | **CLEAN** | Body is `JSON.stringify({text: prompt})` — a fresh primitive string. The only k6-returned value touched is `response` (read-only access in `updateBearer`). |
| `src/flows/agent-stream.ts` | **CLEAN** | Body is `JSON.stringify({model, messages, stream:true})`. Reads `response.timings.waiting`/`duration` (read-only). `deps.metrics.ttfb.add(...)` mutates a custom Trend, NOT a k6-returned object. |
| `src/flows/realtime-ws.ts` | **CLEAN** | `client.ws(...)` passes a plain literal `{headers, tags}`. Inside the handler, `socket.addEventListener(...)` and `socket.send(...)` / `socket.close(...)` are k6-defined method calls — they invoke the host object, they don't assign properties onto it. `start` is a captured local number. `setTimeout` is a global call. |
| `src/main.ts` `k6Adapter().ws()` wrapper | **CLEAN** | `new WebSocket(url, undefined, params)` — constructs the host object then hands it to the handler. No `Object.assign`, no property writes. |
| `src/setup.ts` `provisionUsers()` + k6 `k6Http` wrapper | **CLEAN** | Reads `r.status`, `r.body`, `r.headers` only. Builds a fresh `{status, body: parsed, headers}` plain object as the return value. `new HttpAny.CookieJar()` constructed and passed to `http.post` — no property writes after construction. |

## Negative-search evidence

```
$ grep -rn 'Object.assign' tools/load-test/src/
(no matches — Object.assign no longer appears in src/)

$ grep -rn '\b\(fd\|response\|r\|socket\)\.\w\+\s*=' tools/load-test/src/
src/flows/transcribe.ts: (only deps/body local writes — no k6-object writes)
src/utils/auth.ts: user.token = ... (mutates plain user object, not a k6 return)
```

`user.token = newToken` in `updateBearer` is mutating the
caller-supplied `User` (a plain object built in `setup.ts`), not a k6
host object. **Safe.**

## Conclusion

Plan 08.1-01 Task 2's `Object.assign` on FileData was the **only**
host-object mutation in the load-test harness. Sibling flows are
clean by construction (they JSON-stringify their bodies or rely on
read-only access to k6 return values). The regression test added in
commit `3ad3470`
(`tools/load-test/src/utils/http-client.test.ts`'s
`k6HttpFile() host-object safety (regression)` describe block)
freezes the faux FileData so any future regression that re-introduces
mutation fails synchronously under vitest — no live k6 run needed.

## Future hardening

The runtime gap that allowed this regression to ship: vitest mocked
`http.file` with a plain JS object, so `Object.assign` succeeded in
CI. The structural fix is the new k6-smoke gate (G3), which boots a
real k6 + real api stack for 30 s before the 30-min plateau. Under
that gate the buggy code would have aborted within seconds with the
exact TypeError observed in plan 08.1-followup.

— Plan 08.1-followup
