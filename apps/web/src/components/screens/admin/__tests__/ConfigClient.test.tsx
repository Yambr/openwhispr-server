// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 12 — ConfigClient unit tests (RED before GREEN).
//
// A3 Config view fires two parallel queries (GET /api/stt-config and
// GET /api/note-recording-config) and renders them in two side-by-side
// Card+Table blocks.
//
// State matrix:
//   - loading → both queries pending → two Skeleton tables
//   - success → both 2xx → two populated Tables
//   - error   → either query rejected → destructive Alert + Retry button
//                that invalidates and refetches both keys
//   - partial → one query succeeded, one failed → one Card with data + one
//                with inline error treatment (degrades gracefully)
//
// D-API4 — NO env-block (security hot zone).
// D-S1 — zero new API endpoints; only existing /api/stt-config and
// /api/note-recording-config (Plan 05 Plan 04 Task 2).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";
import { ConfigClient } from "../ConfigClient";

const adminResources = {
  admin: {
    admin: {
      config: {
        action: { refresh: { label: "Refresh" } },
        "alert-readonly": {
          body: {
            label: "Edits require restarting the api container with updated env.",
          },
        },
        "error-fetch-failed": {
          title: { label: "Could not load configuration" },
          body: { label: "Retry, or check the api container logs in Grafana." },
          retry: { label: "Retry" },
        },
        link: { "override-docs": { label: "Docs: how to override" } },
        note: {
          endpoint: { label: "GET /api/note-recording-config" },
          "row-allowed-formats": { label: "Allowed formats" },
          "row-diarization": { label: "Diarization enabled" },
          "row-max-duration": { label: "Max duration (seconds)" },
          "row-sample-rate": { label: "Sample rate (Hz)" },
          title: { label: "Note recording" },
        },
        stt: {
          endpoint: { label: "GET /api/stt-config" },
          "row-default-language": { label: "Default language" },
          "row-default-model": { label: "Default model" },
          "row-providers": { label: "Available providers" },
          title: { label: "STT config" },
        },
        subtitle: {
          body: {
            text: "Server-side STT and note-recording defaults. Read-only.",
          },
        },
        title: { heading: { text: "Configuration" } },
      },
    },
  },
  common: {},
} as Record<string, Record<string, unknown>>;

function makeWrap(client: QueryClient) {
  return function Wrap({ children }: { children: ReactNode }): React.JSX.Element {
    return (
      <I18nProvider lng="en" resources={adminResources}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </I18nProvider>
    );
  };
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
}

const sttResponse = {
  defaultModel: "whisper-1",
  defaultLanguage: "en",
  availableProviders: ["openai", "groq"],
};

const noteResponse = {
  maxDurationSeconds: 3600,
  sampleRateHz: 16000,
  allowedFormats: ["webm", "wav", "mp3"],
  diarizationEnabled: true,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetchOk(stt: unknown, note: unknown): void {
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (url: string) => {
      if (url.includes("stt-config")) {
        return new Response(JSON.stringify(stt), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("note-recording-config")) {
        return new Response(JSON.stringify(note), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  );
}

function mockFetchBothFail(): void {
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async () =>
      new Response(JSON.stringify({ error: "boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
  );
}

function mockFetchPartial(): void {
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (url: string) => {
      if (url.includes("stt-config")) {
        return new Response(JSON.stringify(sttResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    },
  );
}

describe("ConfigClient — header + chrome", () => {
  it("renders heading, subtitle, read-only Alert, Refresh button and Docs link", async () => {
    mockFetchOk(sttResponse, noteResponse);
    const client = makeClient();
    const Wrap = makeWrap(client);
    render(
      <Wrap>
        <ConfigClient />
      </Wrap>,
    );
    expect(screen.getByRole("heading", { name: /configuration/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/server-side stt and note-recording defaults/i)).toBeInTheDocument();
    expect(screen.getByText(/edits require restarting the api container/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
    const docs = screen.getByRole("link", { name: /docs: how to override/i });
    expect(docs).toHaveAttribute("target", "_blank");
    expect(docs).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("D-API4 — does NOT render an env-block of any kind", async () => {
    mockFetchOk(sttResponse, noteResponse);
    const client = makeClient();
    const Wrap = makeWrap(client);
    render(
      <Wrap>
        <ConfigClient />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText(/whisper-1/i)).toBeInTheDocument());
    // Any text containing "env" labelled like an exposed env var name is forbidden.
    expect(screen.queryByText(/effective env/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/LITELLM_/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/OPENAI_API_KEY/i)).not.toBeInTheDocument();
  });
});

describe("ConfigClient — loading state", () => {
  it("renders two Skeleton tables while either query is pending", () => {
    // fetch returns never-resolving promise → both pending forever
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => undefined),
    );
    const client = makeClient();
    const Wrap = makeWrap(client);
    render(
      <Wrap>
        <ConfigClient />
      </Wrap>,
    );
    const skeletons = screen.getAllByTestId("config-skeleton");
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
  });
});

describe("ConfigClient — success state", () => {
  it("renders STT table with default model, language and providers", async () => {
    mockFetchOk(sttResponse, noteResponse);
    const client = makeClient();
    const Wrap = makeWrap(client);
    render(
      <Wrap>
        <ConfigClient />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText(/whisper-1/i)).toBeInTheDocument());
    expect(screen.getByText(/default model/i)).toBeInTheDocument();
    expect(screen.getByText(/default language/i)).toBeInTheDocument();
    expect(screen.getByText(/available providers/i)).toBeInTheDocument();
    expect(screen.getByText(/openai/i)).toBeInTheDocument();
    expect(screen.getByText(/groq/i)).toBeInTheDocument();
  });

  it("renders Note recording table with duration, sample rate, formats, diarization Badge", async () => {
    mockFetchOk(sttResponse, noteResponse);
    const client = makeClient();
    const Wrap = makeWrap(client);
    render(
      <Wrap>
        <ConfigClient />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText(/3600/)).toBeInTheDocument());
    expect(screen.getByText(/16000/)).toBeInTheDocument();
    expect(screen.getByText(/webm/i)).toBeInTheDocument();
    expect(screen.getByText(/wav/i)).toBeInTheDocument();
    expect(screen.getByText(/mp3/i)).toBeInTheDocument();
    // Diarization rendered via a Badge — assert its text presence
    const diarization = screen.getByTestId("config-note-diarization");
    expect(diarization).toBeInTheDocument();
    expect(diarization.textContent ?? "").toMatch(/yes|true|on/i);
  });

  it("Refresh button invalidates both query keys (re-fetch)", async () => {
    mockFetchOk(sttResponse, noteResponse);
    const client = makeClient();
    const Wrap = makeWrap(client);
    render(
      <Wrap>
        <ConfigClient />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText(/whisper-1/i)).toBeInTheDocument());
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const before = fetchSpy.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(before));
  });

  it("fires both queries in parallel on mount", async () => {
    mockFetchOk(sttResponse, noteResponse);
    const client = makeClient();
    const Wrap = makeWrap(client);
    render(
      <Wrap>
        <ConfigClient />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText(/whisper-1/i)).toBeInTheDocument());
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const urls = calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/stt-config"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/note-recording-config"))).toBe(true);
  });
});

describe("ConfigClient — error state", () => {
  it("shows destructive Alert with Retry when both queries fail", async () => {
    mockFetchBothFail();
    const client = makeClient();
    const Wrap = makeWrap(client);
    render(
      <Wrap>
        <ConfigClient />
      </Wrap>,
    );
    await waitFor(() =>
      expect(screen.getByText(/could not load configuration/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^retry$/i })).toBeInTheDocument();
  });

  it("Retry button refetches both queries", async () => {
    mockFetchBothFail();
    const client = makeClient();
    const Wrap = makeWrap(client);
    render(
      <Wrap>
        <ConfigClient />
      </Wrap>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^retry$/i })).toBeInTheDocument(),
    );
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const callsBefore = fetchSpy.mock.calls.length;
    // From now on, both endpoints succeed.
    mockFetchOk(sttResponse, noteResponse);
    await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    await waitFor(() => expect(screen.getByText(/whisper-1/i)).toBeInTheDocument());
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

describe("ConfigClient — partial success (graceful degrade)", () => {
  it("renders STT card with data and Note card with inline error when only Note fails", async () => {
    mockFetchPartial();
    const client = makeClient();
    const Wrap = makeWrap(client);
    render(
      <Wrap>
        <ConfigClient />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByText(/whisper-1/i)).toBeInTheDocument());
    // Page-level Alert is present because at least one query errored.
    expect(screen.getByText(/could not load configuration/i)).toBeInTheDocument();
    // But STT data still rendered.
    expect(screen.getByText(/whisper-1/i)).toBeInTheDocument();
  });
});
