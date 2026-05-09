// Phase 2 / Plan 06 — tough-cookie@5 jar wrapper around globalThis.fetch.
//
// Each describe block that needs cookie-auth instantiates one CookieJar
// via `makeJarFetch()`. Set-Cookie headers from responses are stored;
// outbound requests automatically attach matching cookies.
//
// We use the `setCookieSync`/`getCookieStringSync` synchronous API for
// simplicity; tough-cookie@5 supports both. Domain/path scoping follows
// RFC 6265 — for split-host topology tests the eTLD+1 cookie crosses
// subdomains as long as `Domain=.example.test` is on the Set-Cookie.
import { CookieJar } from "tough-cookie";

export interface JarFetch {
  jar: CookieJar;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

export function makeJarFetch(): JarFetch {
  const jar = new CookieJar();
  const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers ?? undefined);
    const cookieHeader = await jar.getCookieString(url);
    if (cookieHeader.length > 0) {
      // Preserve any caller-supplied Cookie by concatenation; tough-cookie
      // owns the canonical form here.
      const existing = headers.get("cookie");
      headers.set("cookie", existing ? `${existing}; ${cookieHeader}` : cookieHeader);
    }
    const res = await fetch(url, { ...init, headers, redirect: init?.redirect ?? "manual" });
    // Capture every Set-Cookie. fetch's Headers object collapses
    // duplicates in some runtimes; undici exposes getSetCookie().
    const setCookies =
      typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
        : res.headers.get("set-cookie")
          ? [res.headers.get("set-cookie") as string]
          : [];
    for (const sc of setCookies) {
      try {
        await jar.setCookie(sc, url, { ignoreError: true });
      } catch {
        // tough-cookie throws on invalid Domain — swallow to keep the
        // contract test focused on what the server emits.
      }
    }
    return res;
  };
  return { jar, fetch: fetcher };
}
