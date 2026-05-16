// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 28 / Plan 28-01 — @cjm-10.* diarization round-trip steps.
//
// Closes G3 from `.planning/qa-audit/2026-05-16-cjm-coverage.md`. Asserts
// the wire-shape contract of POST /v1/audio/diarization against the
// bundled Speaches main-branch upstream (Phase 08.6).
//
// Per `feedback_cjm_steps_need_unit_tests`: sibling vitest coverage at
// `__tests__/diarization.steps.test.ts`.
// Per `feedback_speaches_diarization_build_from_main`: this scenario is
// tagged @after-docker-up @after-speaches-main and only runs when the
// compose stack has the Speaches main-branch image (Phase 08.6).

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Agent, FormData, fetch as undiciFetch } from "undici";

import { expect, freshTenant, Given, signedInAs, Then, When } from "../support/fixtures";

// Phase 28 — playwright-bdd loader runs under ESM, where `__dirname` is
// not defined. Mirror the transcribe.steps.ts fixture resolver (try repo
// root via `process.cwd()` first, then known relative fallbacks).
function resolveFixtureWav(): string {
  const candidates = [
    resolve(process.cwd(), "tests/e2e-cjm/fixtures/silent.wav"),
    resolve(process.cwd(), "fixtures/silent.wav"),
    resolve(process.cwd(), "../../tests/e2e-cjm/fixtures/silent.wav"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0] ?? "";
}
const FIXTURE_WAV = resolveFixtureWav();

interface DiarizationSegment {
  start: unknown;
  end: unknown;
  speaker: unknown;
}

interface ScenarioState {
  cookie?: string;
  wavBytes?: Buffer;
  status?: number;
  body?: { duration?: unknown; segments?: DiarizationSegment[] };
  rawText?: string;
}

const state = new Map<string, ScenarioState>();

function stateFor(scenarioTenantId: string): ScenarioState {
  let s = state.get(scenarioTenantId);
  if (!s) {
    s = {};
    state.set(scenarioTenantId, s);
  }
  return s;
}

function localhostDispatcher(url: string): Agent | undefined {
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host.endsWith(".localhost")) {
      return new Agent({ connect: { rejectUnauthorized: false } });
    }
  } catch {
    /* unreachable */
  }
  return undefined;
}

/** Issue POST /v1/audio/diarization with multipart body. */
export async function postDiarizationMultipart(
  apiBaseURL: string,
  cookie: string,
  wavBytes: Uint8Array,
): Promise<{ status: number; body: unknown; rawText: string }> {
  const url = `${apiBaseURL}/v1/audio/diarization`;
  const dispatcher = localhostDispatcher(url);
  const form = new FormData();
  form.append("file", new Blob([wavBytes], { type: "audio/wav" }), "audio.wav");
  const res = await undiciFetch(url, {
    method: "POST",
    headers: { origin: new URL(url).origin, cookie },
    body: form,
    ...(dispatcher ? { dispatcher } : {}),
  });
  const rawText = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    body = rawText;
  }
  return { status: res.status, body, rawText };
}

/** Issue POST /v1/audio/diarization with a deliberately-wrong content-type. */
export async function postDiarizationTextPlain(
  apiBaseURL: string,
  cookie: string,
): Promise<{ status: number; body: unknown; rawText: string }> {
  const url = `${apiBaseURL}/v1/audio/diarization`;
  const dispatcher = localhostDispatcher(url);
  const res = await undiciFetch(url, {
    method: "POST",
    headers: {
      origin: new URL(url).origin,
      cookie,
      "content-type": "text/plain",
    },
    body: "this is not audio",
    ...(dispatcher ? { dispatcher } : {}),
  });
  const rawText = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    body = rawText;
  }
  return { status: res.status, body, rawText };
}

/** Predicate — does a parsed body match the canonical diarization shape? */
export function isDiarizationBody(
  body: unknown,
): body is { duration: number; segments: DiarizationSegment[] } {
  if (typeof body !== "object" || body === null) return false;
  const b = body as { duration?: unknown; segments?: unknown };
  if (typeof b.duration !== "number") return false;
  if (!Array.isArray(b.segments)) return false;
  return true;
}

Given("a signed-in user", async function (this, ctx) {
  const { apiBaseURL, mailpitApiUrl, tenantId } = ctx as {
    apiBaseURL: string;
    mailpitApiUrl: string;
    tenantId: string;
  };
  const s = stateFor(tenantId);
  const id = freshTenant(tenantId);
  s.cookie = await signedInAs(apiBaseURL, mailpitApiUrl, id);
});

Given("a wav fixture is available", async function (this, ctx) {
  const { tenantId } = ctx as { tenantId: string };
  const s = stateFor(tenantId);
  s.wavBytes = readFileSync(FIXTURE_WAV);
});

When(
  "the user POSTs the wav to \\/v1\\/audio\\/diarization as multipart\\/form-data",
  async function (this, ctx) {
    const { apiBaseURL, tenantId } = ctx as { apiBaseURL: string; tenantId: string };
    const s = stateFor(tenantId);
    if (!s.wavBytes) throw new Error("wav fixture not loaded");
    const res = await postDiarizationMultipart(apiBaseURL, s.cookie ?? "", s.wavBytes);
    s.status = res.status;
    s.body = res.body as ScenarioState["body"];
    s.rawText = res.rawText;
  },
);

When(
  "the user POSTs {string} content to \\/v1\\/audio\\/diarization",
  async function (this, ctx, contentType: string) {
    const { apiBaseURL, tenantId } = ctx as { apiBaseURL: string; tenantId: string };
    const s = stateFor(tenantId);
    if (contentType !== "text/plain") {
      throw new Error(`Phase 28 step only models text/plain; got ${contentType}`);
    }
    const res = await postDiarizationTextPlain(apiBaseURL, s.cookie ?? "");
    s.status = res.status;
    s.body = res.body as ScenarioState["body"];
    s.rawText = res.rawText;
  },
);

Then("the response status is {int}", async function (this, ctx, expected: number) {
  const { tenantId } = ctx as { tenantId: string };
  expect(stateFor(tenantId).status).toBe(expected);
});

Then('the body has a numeric "duration" field greater than 0', async function (this, ctx) {
  const { tenantId } = ctx as { tenantId: string };
  const body = stateFor(tenantId).body ?? {};
  expect(typeof body.duration).toBe("number");
  expect(body.duration as number).toBeGreaterThan(0);
});

Then(
  'the body has a "segments" array with at least {int} item',
  async function (this, ctx, n: number) {
    const { tenantId } = ctx as { tenantId: string };
    const body = stateFor(tenantId).body ?? {};
    expect(Array.isArray(body.segments)).toBe(true);
    expect((body.segments as DiarizationSegment[]).length).toBeGreaterThanOrEqual(n);
  },
);

Then(
  "every segment carries numeric start, numeric end, string speaker",
  async function (this, ctx) {
    const { tenantId } = ctx as { tenantId: string };
    const segments = (stateFor(tenantId).body?.segments ?? []) as DiarizationSegment[];
    for (const seg of segments) {
      expect(typeof seg.start).toBe("number");
      expect(typeof seg.end).toBe("number");
      expect(typeof seg.speaker).toBe("string");
    }
  },
);

Then(
  /^the body is the typed envelope shape "\{ error: \{ code, message \} \}"$/,
  async function (this, ctx) {
    const { tenantId } = ctx as { tenantId: string };
    const body = stateFor(tenantId).body;
    expect(body).toMatchObject({
      error: expect.objectContaining({
        code: expect.any(String),
        message: expect.any(String),
      }),
    });
  },
);

Then("the body MUST NOT contain a Node.js stack trace", async function (this, ctx) {
  const { tenantId } = ctx as { tenantId: string };
  expect(stateFor(tenantId).rawText ?? "").not.toMatch(/at Object\.<anonymous>|node_modules\//);
});
