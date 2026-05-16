// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 / Plan 02 / Task 13-02-03 — @cjm-6.* locale switch step bindings.
// Phase 19b / SR-19b.3 — @cjm-traefik-host-split[+web] step bodies turned
// from stubs into real undici probes against the live compose stack.

import { Agent, fetch as undiciFetch } from "undici";
import { Given, Then, When } from "../support/world";

interface ScenarioState {
  lastStatus?: number;
  lastContentType?: string;
  lastBody?: string;
  lastJson?: unknown;
}

const state = new Map<string, ScenarioState>();

function stateFor(tenantId: string): ScenarioState {
  let s = state.get(tenantId);
  if (!s) {
    s = {};
    state.set(tenantId, s);
  }
  return s;
}

// Phase 19b — Traefik fronts api.localhost / web.localhost via the
// mkcert-provisioned dev cert. The harness must not enforce strict TLS
// when talking to *.localhost (the dev CA is local-only); mirror the
// localhostDispatcher pattern from tests/e2e-cjm/support/fixtures.ts.
function localhostDispatcher(url: string): Agent | undefined {
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host.endsWith(".localhost")) {
      return new Agent({ connect: { rejectUnauthorized: false } });
    }
  } catch {
    /* unreachable in tests */
  }
  return undefined;
}

// Phase 19.4 / Plan 01 — @cjm-6.1 real bindings against the live web +
// api stack via Traefik. The flow exercises the wire-level localization
// chain: GET public sign-up (proves web shell reachable), POST web's
// /api/locale to flip the NEXT_LOCALE cookie (Phase 10 / Plan 02 —
// apps/web/src/app/api/locale/route.ts), then re-fetch sign-up with
// the new cookie and assert Russian copy via the unicode Cyrillic
// regex. We do NOT spin a browser — the wire-level chain is the
// minimal evidence the LanguageSwitcher contract holds.
Given("the user is on the public sign-up page", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  const url = "https://web.localhost/sign-up";
  const res = await undiciFetch(url, { method: "GET", dispatcher: localhostDispatcher(url) });
  s.lastStatus = res.status;
  s.lastContentType = res.headers.get("content-type") ?? "";
  s.lastBody = await res.text();
  if (res.status !== 200) {
    throw new Error(
      `precondition: GET ${url} expected 200, got ${res.status}: ${s.lastBody?.slice(0, 200)}`,
    );
  }
});

When("the user switches the locale to {string}", async ({ tenantId }, locale: string) => {
  const s = stateFor(tenantId);
  const url = "https://web.localhost/api/locale";
  const res = await undiciFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ locale }),
    dispatcher: localhostDispatcher(url),
  });
  s.lastStatus = res.status;
  s.lastContentType = res.headers.get("content-type") ?? "";
  const setCookieHeader =
    (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  s.lastBody = setCookieHeader.join("\n");
});

Then(
  "a NEXT_LOCALE cookie is set to {string} and the next render serves Russian copy",
  async ({ tenantId }, value: string) => {
    const s = stateFor(tenantId);
    if (s.lastStatus !== 204) {
      throw new Error(
        `expected POST /api/locale to return 204, got ${s.lastStatus}: ${s.lastBody?.slice(0, 200)}`,
      );
    }
    const cookies = s.lastBody ?? "";
    const expected = `NEXT_LOCALE=${value}`;
    if (!cookies.includes(expected)) {
      throw new Error(
        `expected Set-Cookie to contain "${expected}"; got: ${cookies.slice(0, 400)}`,
      );
    }
    const url = "https://web.localhost/sign-up";
    const res = await undiciFetch(url, {
      method: "GET",
      headers: { cookie: `NEXT_LOCALE=${value}` },
      dispatcher: localhostDispatcher(url),
    });
    if (res.status !== 200) {
      throw new Error(
        `GET ${url} with cookie NEXT_LOCALE=${value} expected 200, got ${res.status}`,
      );
    }
    const body = await res.text();
    // Cyrillic detector — U+0410..U+044F + U+0401/U+0451 Yo. Source
    // stays ASCII via unicode escapes per english-only lint.
    const CYRILLIC_RE = /[\u0410-\u044F\u0401\u0451]/;
    if (!CYRILLIC_RE.test(body)) {
      throw new Error(
        `subsequent GET with NEXT_LOCALE=${value} produced English-only body — locale not steering RSC render. First 300 chars: ${body.slice(0, 300)}`,
      );
    }
  },
);

// Phase 19.4 / Plan 01 — @cjm-6.2 routing assertion. Identical to the
// more specific @cjm-traefik-host-split scenario (Phase 19b) but kept
// here for the @cjm-6.* locale-coverage cohort.
When("a GET to \\/api\\/locale on api.localhost is issued", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  const url = "https://api.localhost/api/locale";
  const res = await undiciFetch(url, { method: "GET", dispatcher: localhostDispatcher(url) });
  s.lastStatus = res.status;
  s.lastContentType = res.headers.get("content-type") ?? "";
  s.lastBody = await res.text();
  try {
    s.lastJson = JSON.parse(s.lastBody);
  } catch {
    s.lastJson = undefined;
  }
});

Then("the host-split routing returns 200 and a JSON locale body", ({ tenantId }) => {
  const s = stateFor(tenantId);
  if (s.lastStatus !== 200) {
    throw new Error(
      `expected 200, got ${s.lastStatus}: body=${s.lastBody?.slice(0, 200)}; ct=${s.lastContentType}`,
    );
  }
  if (!s.lastContentType?.includes("application/json")) {
    throw new Error(`expected content-type application/json, got "${s.lastContentType}"`);
  }
  const locale = (s.lastJson as { locale?: string } | undefined)?.locale;
  if (typeof locale !== "string") {
    throw new Error(
      `expected JSON body with string "locale" field; got ${s.lastBody?.slice(0, 200)}`,
    );
  }
});

// Phase 15 / Plan 02 / Task 1 — @cjm-traefik-host-split scenarios.
// Phase 19b / SR-19b.3 — bodies now issue real probes against the live
// stack via Traefik. The Phase-15 STRUCT-05 host-split is restored:
// api.localhost reaches the Fastify api container; web.localhost reaches
// the Next.js web container. Both routes go through Traefik on :443
// with the mkcert dev cert.

When(
  "a GET to \\/api\\/locale on api.localhost is issued with Accept-Language {string}",
  async ({ tenantId }, lang: string) => {
    const s = stateFor(tenantId);
    const url = "https://api.localhost/api/locale";
    const res = await undiciFetch(url, {
      method: "GET",
      headers: { "accept-language": lang },
      dispatcher: localhostDispatcher(url),
    });
    s.lastStatus = res.status;
    s.lastContentType = res.headers.get("content-type") ?? "";
    s.lastBody = await res.text();
    try {
      s.lastJson = JSON.parse(s.lastBody);
    } catch {
      s.lastJson = undefined;
    }
  },
);

Then(
  "the response is 200 with content-type application\\/json and a locale of {string}",
  ({ tenantId }, expected: string) => {
    const s = stateFor(tenantId);
    if (s.lastStatus !== 200) {
      throw new Error(`expected 200, got ${s.lastStatus}: ${s.lastBody?.slice(0, 200)}`);
    }
    if (!s.lastContentType?.includes("application/json")) {
      throw new Error(
        `expected content-type application/json, got "${s.lastContentType}"; body=${s.lastBody?.slice(0, 200)}`,
      );
    }
    const locale = (s.lastJson as { locale?: string } | undefined)?.locale;
    if (locale !== expected) {
      throw new Error(`expected locale "${expected}", got "${locale}"`);
    }
  },
);

When("a GET to \\/ on web.localhost is issued", async ({ tenantId }) => {
  const s = stateFor(tenantId);
  const url = "https://web.localhost/";
  const res = await undiciFetch(url, {
    method: "GET",
    dispatcher: localhostDispatcher(url),
  });
  s.lastStatus = res.status;
  s.lastContentType = res.headers.get("content-type") ?? "";
  s.lastBody = await res.text();
});

Then(
  "the response is 200 with content-type text\\/html and the body contains the web app shell marker",
  ({ tenantId }) => {
    const s = stateFor(tenantId);
    if (s.lastStatus !== 200) {
      throw new Error(`expected 200, got ${s.lastStatus}: ${s.lastBody?.slice(0, 200)}`);
    }
    if (!s.lastContentType?.includes("text/html")) {
      throw new Error(
        `expected content-type text/html, got "${s.lastContentType}"; body=${s.lastBody?.slice(0, 200)}`,
      );
    }
    // The Next.js shell consistently emits `<!DOCTYPE html>` + the
    // OpenWhispr <title>; we match either marker (case-insensitive) so a
    // template-level reword in either layer doesn't break the host-split
    // assertion.
    const body = s.lastBody ?? "";
    if (!/<!doctype html>/i.test(body) && !/openwhispr/i.test(body)) {
      throw new Error(
        `body missing web-shell markers (<!doctype html> / "OpenWhispr"); first 200 chars: ${body.slice(0, 200)}`,
      );
    }
  },
);
