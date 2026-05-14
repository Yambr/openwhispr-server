// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-05a — UICONF-04 conformance inventory derived from
//   .planning/phases/07-frontend-ui-spec/design/screens-admin.jsx:445-628 (ScreenConfig).
// Inventory: see 12-RESEARCH.md §16 table and __fixtures__/jsx-inventory.ts.
//
// Plan 12-04 AdminIndex mirrors ONLY the A3 ScreenConfig surface — A1
// ScreenAudit + A2 ScreenObservability are out-of-scope (RESEARCH §15(h),
// T-12.04-01) because they surface user PII (actor emails, IPs, audit
// rows) and ship in Phase 13+ behind RLS-gated admin queries.
//
// What this asserts:
//   - <h1>Configuration</h1>                 (screens-admin.jsx:451)
//   - lede paragraph                          (screens-admin.jsx:452-455)
//   - exactly one role='status' alert         (screens-admin.jsx:462-476)
//     and ZERO role='alert' (destructive)     -- defense-in-depth
//   - 2-column card grid w/ >= 2 [data-slot="card"]
//
// PII gate (defense-in-depth over Plan 12-04 Task 5 / T-12.04-01):
//   - container.innerHTML must NOT match an email-like pattern.
//   - container.innerHTML must NOT match an IPv4-like pattern.
//   - container.innerHTML lowercased must NOT contain the substring 'audit'.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";
import { adminConfigInventory } from "./__fixtures__/jsx-inventory";

const resources = {
  admin: {
    admin: {
      index: {
        title: { heading: { text: adminConfigInventory.heading } },
        lede: { body: { text: adminConfigInventory.ledeOracle } },
        readonly: {
          title: { text: adminConfigInventory.readonly.title },
          body: { text: "Edits require restarting the api container." },
        },
        "card-stt": {
          title: { text: adminConfigInventory.cards[0].titleProduction },
          endpoint: { text: adminConfigInventory.cards[0].endpoint },
        },
        "card-note": {
          title: { text: adminConfigInventory.cards[1].titleProduction },
          endpoint: { text: adminConfigInventory.cards[1].endpoint },
        },
      },
    },
  },
  common: { common: {} },
} as Record<string, Record<string, unknown>>;

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider lng="en" resources={resources}>
      {children}
    </I18nProvider>
  );
}

describe("AdminIndex conformance vs screens-admin.jsx:445-628 (A3 ScreenConfig)", () => {
  it("renders <h1>Configuration</h1> with the oracle's lede", async () => {
    const { AdminIndex } = await import("@/components/screens/AdminIndex");
    const { container, getByText } = render(
      <Wrap>
        <AdminIndex />
      </Wrap>,
    );
    expect(container.querySelector("h1")?.textContent).toBe(adminConfigInventory.heading);
    expect(
      getByText(new RegExp(adminConfigInventory.ledeOracle.slice(0, 40), "i")),
    ).toBeInTheDocument();
  });

  it("renders exactly one role='status' alert and ZERO role='alert' (defense-in-depth)", async () => {
    const { AdminIndex } = await import("@/components/screens/AdminIndex");
    const { container } = render(
      <Wrap>
        <AdminIndex />
      </Wrap>,
    );
    expect(
      container.querySelectorAll(`[role="${adminConfigInventory.readonly.role}"]`).length,
    ).toBe(1);
    expect(container.querySelectorAll('[role="alert"]').length).toBe(0);
  });

  it("renders >= 2 cards in a 2-column grid ([data-slot='card'])", async () => {
    const { AdminIndex } = await import("@/components/screens/AdminIndex");
    const { container } = render(
      <Wrap>
        <AdminIndex />
      </Wrap>,
    );
    const cards = container.querySelectorAll('[data-slot="card"]');
    expect(cards.length).toBeGreaterThanOrEqual(2);
  });

  it("PII gate: no email-like patterns in rendered HTML", async () => {
    const { AdminIndex } = await import("@/components/screens/AdminIndex");
    const { container } = render(
      <Wrap>
        <AdminIndex />
      </Wrap>,
    );
    expect(container.innerHTML).not.toMatch(adminConfigInventory.piiPatterns.email);
  });

  it("PII gate: no IPv4-like patterns in rendered HTML", async () => {
    const { AdminIndex } = await import("@/components/screens/AdminIndex");
    const { container } = render(
      <Wrap>
        <AdminIndex />
      </Wrap>,
    );
    expect(container.innerHTML).not.toMatch(adminConfigInventory.piiPatterns.ipv4);
  });

  it("PII gate: no 'audit' substring (case-insensitive) in rendered HTML", async () => {
    const { AdminIndex } = await import("@/components/screens/AdminIndex");
    const { container } = render(
      <Wrap>
        <AdminIndex />
      </Wrap>,
    );
    expect(container.innerHTML.toLowerCase()).not.toContain(
      adminConfigInventory.piiPatterns.auditSubstring,
    );
  });
});
