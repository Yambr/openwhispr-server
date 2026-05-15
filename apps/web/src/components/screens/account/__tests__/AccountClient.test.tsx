// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 08 — U5 AccountClient composite tests (RED→GREEN).
//
// AccountClient composes ProfileCard + SessionsTable + DeleteAccountDialog and
// surfaces error states per section. It receives the server-resolved session
// from the RSC parent (no client fetch for profile data).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/account",
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    listSessions: vi.fn(async () => ({ data: [], error: null })),
    revokeSession: vi.fn(async () => ({ data: { status: true }, error: null })),
    revokeOtherSessions: vi.fn(async () => ({ data: { status: true }, error: null })),
    deleteAccount: vi.fn(async () => ({ data: { success: true }, error: null })),
    signOut: vi.fn(async () => ({ data: {}, error: null })),
  },
}));

import { AccountClient } from "../AccountClient";

const resources = {
  "end-user": {
    "end-user": {
      account: {
        title: { heading: { text: "Account" } },
        subtitle: { body: { text: "Manage your profile, active sessions, and account deletion." } },
        profile: {
          title: { label: "Profile" },
          name: { label: "Name" },
          email: { label: "Email" },
          verified: { label: "Verified" },
          created: { label: "Member since" },
        },
        sessions: {
          title: { label: "Active sessions" },
          "col-device": { label: "Device" },
          "col-ip": { label: "IP address" },
          "col-created": { label: "Started" },
          "col-expires": { label: "Expires" },
          "action-revoke": { label: "Revoke" },
          "action-revoke-others": { label: "Revoke all other sessions" },
        },
        danger: {
          title: { label: "Danger zone" },
          delete: { label: "Delete account" },
          "dialog-title": { text: "Delete your OpenWhispr account" },
          "dialog-body": { text: "This deletes your data." },
          "dialog-input": { label: "Type your email to confirm" },
          "dialog-confirm": { label: "Delete account" },
        },
        error: {
          title: { text: "Could not load account" },
          retry: { label: "Retry" },
        },
      },
    },
  },
  common: { common: {} },
} as Record<string, Record<string, unknown>>;

function renderClient(props: Parameters<typeof AccountClient>[0]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider lng="en" resources={resources}>
        <AccountClient {...props} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("AccountClient (Phase 07.1 / Plan 08)", () => {
  it("renders Profile card with name, email, verified badge, created date", () => {
    renderClient({
      user: {
        id: "u1",
        name: "Alice Operator",
        email: "alice@example.com",
        emailVerified: true,
        createdAt: "2025-08-12T10:00:00.000Z",
      },
      currentSessionToken: "tok-1",
    });
    expect(screen.getByText("Alice Operator")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Verified/i)).toBeInTheDocument();
    // date-fns format yields a readable date — assert year present
    expect(screen.getByText(/2025/)).toBeInTheDocument();
  });

  it("renders the three section headings (Profile / Active sessions / Danger zone)", () => {
    renderClient({
      user: {
        id: "u1",
        name: "Alice",
        email: "alice@example.com",
        emailVerified: false,
        createdAt: "2025-08-12T10:00:00.000Z",
      },
      currentSessionToken: "tok-1",
    });
    expect(screen.getByText(/^Profile$/)).toBeInTheDocument();
    // Phase 18.1 F7 GREEN (Plan 04): heading-scoped query mirrors the analog at
    // apps/web/src/components/screens/admin/__tests__/ConfigClient.test.tsx:165.
    // SessionsTable renders <h2>Active sessions</h2> in the skeleton render path
    // (synchronous, before useQuery resolves). Anchored regex + role-scoping
    // defends against future regressions that re-introduce the phrase into the
    // subtitle <p> (the original duplicate-text bug).
    expect(screen.getByRole("heading", { name: /^Active sessions$/i })).toBeInTheDocument();
    expect(screen.getByText(/Danger zone/i)).toBeInTheDocument();
  });

  it("does NOT render Verified badge when emailVerified is false", () => {
    renderClient({
      user: {
        id: "u1",
        name: "Alice",
        email: "alice@example.com",
        emailVerified: false,
        createdAt: "2025-08-12T10:00:00.000Z",
      },
      currentSessionToken: "tok-1",
    });
    expect(screen.queryByTestId("profile-verified-badge")).not.toBeInTheDocument();
  });

  it("renders em-dash for missing createdAt", () => {
    renderClient({
      user: {
        id: "u1",
        name: "Alice",
        email: "alice@example.com",
        emailVerified: true,
        createdAt: null,
      },
      currentSessionToken: "tok-1",
    });
    expect(screen.getByTestId("profile-created-value")).toHaveTextContent("—");
  });

  it("renders em-dash for missing name", () => {
    renderClient({
      user: {
        id: "u1",
        name: null,
        email: "alice@example.com",
        emailVerified: true,
        createdAt: "2025-08-12T10:00:00.000Z",
      },
      currentSessionToken: "tok-1",
    });
    // name=null → 1 em-dash for the name cell. createdAt is valid so the
    // created date cell renders the formatted year, not an em-dash.
    expect(screen.getAllByText("—")).toHaveLength(1);
  });

  it("renders em-dash for invalid createdAt string (NaN branch)", () => {
    renderClient({
      user: {
        id: "u1",
        name: "Alice",
        email: "alice@example.com",
        emailVerified: true,
        createdAt: "not-a-real-date",
      },
      currentSessionToken: "tok-1",
    });
    expect(screen.getByTestId("profile-created-value")).toHaveTextContent("—");
  });

  it("accepts Date object createdAt", () => {
    renderClient({
      user: {
        id: "u1",
        name: "Alice",
        email: "alice@example.com",
        emailVerified: true,
        createdAt: new Date("2025-08-12T10:00:00.000Z"),
      },
      currentSessionToken: "tok-1",
    });
    expect(screen.getByTestId("profile-created-value")).toHaveTextContent("2025-08-12");
  });
});
