// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 06 — TanStack Query provider tests (RED before GREEN).
//
// Verifies the Client provider mounts a QueryClient with the documented
// defaults (RESEARCH § Pattern 5) and that `makeServerQueryClient()`
// produces a fresh instance per RSC render (Pitfall 4 — no cross-request
// hydration leaks).

import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QueryProvider } from "../query-client";
import { makeServerQueryClient } from "../query-client-server";

function ClientProbe({ onClient }: { onClient: (c: QueryClient) => void }): null {
  const client = useQueryClient();
  onClient(client);
  return null;
}

describe("QueryProvider (Phase 07.1 / Plan 06)", () => {
  it("renders children", () => {
    const { getByText } = render(
      <QueryProvider>
        <span>hello</span>
      </QueryProvider>,
    );
    expect(getByText("hello")).toBeInTheDocument();
  });

  it("exposes a QueryClient with staleTime=60_000 default", () => {
    let observed: QueryClient | undefined;
    render(
      <QueryProvider>
        <ClientProbe
          onClient={(c) => {
            observed = c;
          }}
        />
      </QueryProvider>,
    );
    expect(observed).toBeInstanceOf(QueryClient);
    const defaults = observed?.getDefaultOptions();
    expect(defaults?.queries?.staleTime).toBe(60_000);
    expect(defaults?.queries?.refetchOnWindowFocus).toBe(false);
  });
});

describe("makeServerQueryClient (Phase 07.1 / Plan 06)", () => {
  it("returns a fresh QueryClient each call (no cross-request leak)", () => {
    const a = makeServerQueryClient();
    const b = makeServerQueryClient();
    expect(a).toBeInstanceOf(QueryClient);
    expect(b).toBeInstanceOf(QueryClient);
    expect(a).not.toBe(b);
  });

  it("server QueryClient has staleTime=60_000 default", () => {
    const qc = makeServerQueryClient();
    expect(qc.getDefaultOptions().queries?.staleTime).toBe(60_000);
  });
});
