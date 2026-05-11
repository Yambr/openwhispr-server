// Phase 05 / Plan 03 / Task 2 — Yandex web-search adapter (pending stub).
//
// STATUS: The Yandex reference Python implementation
// (tools/reference/yandex-search-server.py) is not yet available — the
// reference file is sandboxed in the user's ~/Downloads folder and the
// user has explicitly opted to ship Yandex as a wire-shape stub (the
// "skip-yandex" branch of 05-03-PLAN.md Task 1).
//
// TODO(phase-5.x): Replace stub with real Yandex Search adapter.
// Requires tools/reference/yandex-search-server.py (currently sandboxed
// in user Downloads). Once available, implement the live HTTP call per
// the reference's wire shape (endpoint, auth header format, snippet
// field name).
//
// Why this file exists as a stub rather than being omitted:
//   * The registry contract (D-01: "учти что провайдеров потом может
//     быть больше") commits to a stable wire surface where the desktop
//     client can select 'yandex' via WEB_SEARCH_PROVIDER at any time.
//     Keeping the registry slot occupied means the future drop-in is a
//     pure adapter replacement, not a route/registry change.
//   * CONTRACT-01's negative matrix can enumerate the 503 envelope for
//     `provider='yandex'` deployments (Pitfall #6 — routes register
//     unconditionally).
//
// Operator-facing behavior:
//   * `isConfigured()` returns `false` by default. Even with all Yandex
//     env vars set, the adapter remains disabled unless the operator
//     also sets `YANDEX_SEARCH_ENABLED=true`. That feature flag exists
//     so a future hot-swap of this stub for a live implementation can
//     be staged: the live binary's reference-derived code is gated on
//     the same env var, preventing accidental traffic to a half-wired
//     adapter during rollout.
//   * `search()` throws `YandexSearchPendingError` which the route
//     handler maps to:
//       503 { error: { code: "PROVIDER_UNAVAILABLE",
//                       message: "yandex provider pending" } }
//     The 503 is the correct semantic (operator-config issue) and the
//     code distinguishes from MissingProviderKey (which would suggest
//     the operator just needs to set a key).

import {
  YandexSearchPendingError,
  type WebSearchProvider,
} from "./types.js";

export class YandexAdapter implements WebSearchProvider {
  readonly name = "yandex";

  isConfigured(): boolean {
    // Three conditions required:
    //   1. YANDEX_SEARCH_API_KEY set (the secret).
    //   2. YANDEX_FOLDER_ID set (the Yandex Cloud folder).
    //   3. YANDEX_SEARCH_ENABLED === "true" (operator opt-in to the
    //      not-yet-live adapter).
    // Until the reference lands, condition (3) is the operator's signal
    // that they accept responsibility for any code they've patched in.
    // Default deployments leave the flag unset → adapter stays disabled.
    const key = process.env.YANDEX_SEARCH_API_KEY;
    const folder = process.env.YANDEX_FOLDER_ID;
    const enabled = process.env.YANDEX_SEARCH_ENABLED;
    return (
      typeof key === "string" && key.length > 0
      && typeof folder === "string" && folder.length > 0
      && enabled === "true"
    );
  }

  async search(
    _query: string,
    _numResults: number,
  ): Promise<{
    results: Array<{ title: string; url: string; snippet: string }>;
  }> {
    // Awaited so the function shape stays Promise<...> for the
    // interface; the stub returns synchronously after the throw.
    throw new YandexSearchPendingError(
      "Yandex Search adapter is pending — reference implementation not yet available. "
        + "Set YANDEX_SEARCH_ENABLED=true after providing tools/reference/yandex-search-server.py "
        + "and re-implementing the wire shape.",
    );
  }
}
