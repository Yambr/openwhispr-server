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

Given("the user is on the public sign-up page", async ({ tenantId }) => {
  stateFor(tenantId);
  throw new Error("locale UI ships in Phase 15 — @cjm-6.1 stays @expected-red");
});

When("the user switches the locale to {string}", async ({ tenantId }, _locale: string) => {
  void tenantId;
  throw new Error("locale toggle UI ships in Phase 15 — @cjm-6.1 stays @expected-red");
});

Then(
  "a NEXT_LOCALE cookie is set to {string} and the next render serves Russian copy",
  async ({ tenantId }, _value: string) => {
    void tenantId;
    throw new Error("locale toggle UI ships in Phase 15 — @cjm-6.1 stays @expected-red");
  },
);

When("a GET to \\/api\\/locale on api.localhost is issued", async () => {
  throw new Error("/api/locale endpoint ships in Phase 15 — @cjm-6.2 stays @expected-red");
});

Then("the host-split routing returns 200 and a JSON locale body", async () => {
  throw new Error("/api/locale endpoint ships in Phase 15 — @cjm-6.2 stays @expected-red");
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
