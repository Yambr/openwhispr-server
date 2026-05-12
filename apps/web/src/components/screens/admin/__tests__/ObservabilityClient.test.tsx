// Phase 07.1 / Plan 12 — ObservabilityClient unit tests (RED before GREEN).
//
// A2 Observability hub is a Client Component that renders a static card grid
// of deep-links into the operator's external Grafana / Tempo / Mimir / Loki
// stack. It performs ZERO API calls against this server.
//
// State matrix:
//   - success  → 6 dashboard cards + 4 quick-links, all anchors with
//                target="_blank" rel="noopener noreferrer"
//   - error    → NEXT_PUBLIC_GRAFANA_BASE_URL unset → Alert with operator
//                instructions per copy key admin.observability.error-env-missing.*
//   - loading  → N/A (no async fetch)
//   - empty    → N/A (cards are static)
//
// D-ADMIN-1: NO application-layer role check.
// D-S1: zero new API endpoints.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";
import { ObservabilityClient } from "../ObservabilityClient";

const adminResources = {
  admin: {
    admin: {
      observability: {
        action: { "open-grafana": { label: "Open Grafana" } },
        "card-api-latency": {
          title: { label: "API tier — request latency" },
          body: { label: "p50, p95, p99 from Fastify hooks" },
        },
        "card-worker-queue": {
          title: { label: "Worker — STT job queue" },
          body: { label: "BullMQ depth, retries, throughput" },
        },
        "card-postgres": {
          title: { label: "Postgres — partitions and vacuum" },
        },
        "card-litellm": {
          title: { label: "LiteLLM — provider routing" },
        },
        "card-security": {
          title: { label: "Security — rate limits and auth failures" },
        },
        "card-system": {
          title: { label: "System — CPU, RAM, disk, network" },
        },
        quicklinks: {
          title: { label: "Quick links" },
          loki: { label: "Loki — application logs" },
          mimir: { label: "Mimir — Prometheus metrics" },
          tempo: { label: "Tempo — distributed tracing" },
          alertmanager: { label: "Alertmanager — routing and silences" },
        },
        "error-env-missing": {
          title: { label: "Grafana endpoint not configured" },
          body: {
            label: "Set NEXT_PUBLIC_GRAFANA_BASE_URL and redeploy the web container.",
          },
        },
        title: { heading: { text: "Observability" } },
        subtitle: {
          body: { text: "Deep-links to Grafana dashboards for this installation." },
        },
      },
    },
  },
  common: {},
} as Record<string, Record<string, unknown>>;

function Wrap({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <I18nProvider lng="en" resources={adminResources}>
      {children}
    </I18nProvider>
  );
}

describe("ObservabilityClient — success state (env configured)", () => {
  const envs = {
    grafana: "https://grafana.example.com",
    tempo: "https://tempo.example.com",
    mimir: "https://mimir.example.com",
    loki: "https://loki.example.com",
  };

  it("renders heading + subtitle", () => {
    render(
      <Wrap>
        <ObservabilityClient env={envs} />
      </Wrap>,
    );
    expect(screen.getByRole("heading", { name: /observability/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/deep-links to grafana/i)).toBeInTheDocument();
  });

  it("renders an Open Grafana button linking to grafanaBaseUrl in a new tab", () => {
    render(
      <Wrap>
        <ObservabilityClient env={envs} />
      </Wrap>,
    );
    const link = screen.getByRole("link", { name: /open grafana/i });
    expect(link).toHaveAttribute("href", envs.grafana);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("renders six dashboard cards as external links anchored under grafanaBaseUrl", () => {
    render(
      <Wrap>
        <ObservabilityClient env={envs} />
      </Wrap>,
    );
    const titles = [
      /api tier — request latency/i,
      /worker — stt job queue/i,
      /postgres — partitions and vacuum/i,
      /litellm — provider routing/i,
      /security — rate limits and auth failures/i,
      /system — cpu, ram, disk, network/i,
    ];
    for (const title of titles) {
      const link = screen.getByRole("link", { name: title });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
      expect(link.getAttribute("href")).toMatch(/^https:\/\/grafana\.example\.com/);
    }
  });

  it("renders four quick-links (Loki, Mimir, Tempo, Alertmanager)", () => {
    render(
      <Wrap>
        <ObservabilityClient env={envs} />
      </Wrap>,
    );
    expect(screen.getByRole("link", { name: /loki/i })).toHaveAttribute("href", envs.loki);
    expect(screen.getByRole("link", { name: /mimir/i })).toHaveAttribute("href", envs.mimir);
    expect(screen.getByRole("link", { name: /tempo/i })).toHaveAttribute("href", envs.tempo);
    // Alertmanager has no dedicated env var — falls back to Grafana root.
    expect(screen.getByRole("link", { name: /alertmanager/i })).toHaveAttribute(
      "href",
      envs.grafana,
    );
  });

  it("falls back to the Grafana root for any LGTM env that is unset", () => {
    render(
      <Wrap>
        <ObservabilityClient env={{ grafana: envs.grafana }} />
      </Wrap>,
    );
    expect(screen.getByRole("link", { name: /loki/i })).toHaveAttribute("href", envs.grafana);
    expect(screen.getByRole("link", { name: /mimir/i })).toHaveAttribute("href", envs.grafana);
    expect(screen.getByRole("link", { name: /tempo/i })).toHaveAttribute("href", envs.grafana);
  });

  it("does NOT render the env-missing Alert when GRAFANA is set", () => {
    render(
      <Wrap>
        <ObservabilityClient env={envs} />
      </Wrap>,
    );
    expect(screen.queryByText(/grafana endpoint not configured/i)).not.toBeInTheDocument();
  });
});

describe("ObservabilityClient — error state (NEXT_PUBLIC_GRAFANA_BASE_URL unset)", () => {
  it("renders an Alert with the operator instruction copy when env is empty", () => {
    render(
      <Wrap>
        <ObservabilityClient env={{ grafana: "" }} />
      </Wrap>,
    );
    expect(screen.getByText(/grafana endpoint not configured/i)).toBeInTheDocument();
    expect(screen.getByText(/set next_public_grafana_base_url and redeploy/i)).toBeInTheDocument();
  });

  it("renders no dashboard cards in error state", () => {
    render(
      <Wrap>
        <ObservabilityClient env={{ grafana: "" }} />
      </Wrap>,
    );
    expect(screen.queryByRole("link", { name: /api tier/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /worker — stt/i })).not.toBeInTheDocument();
  });

  it("treats undefined GRAFANA env as unset (error state)", () => {
    render(
      <Wrap>
        <ObservabilityClient env={{}} />
      </Wrap>,
    );
    expect(screen.getByText(/grafana endpoint not configured/i)).toBeInTheDocument();
  });
});
