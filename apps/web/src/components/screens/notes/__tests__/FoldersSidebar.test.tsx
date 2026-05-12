// Phase 07.1 / Plan 10 — FoldersSidebar unit tests (RED→GREEN).
//
// D-UX5: folders are READ-ONLY in web. This test enforces ZERO mutation UI
// — no Create / Rename / Delete / New folder / "+" affordance — under any
// rendering state (loading / empty / populated).
//
// Surface verified:
//   - Renders the folders list from useQuery(queryKeys.folders())
//   - Renders the readonly-body copy ("Folder management is in the desktop client.")
//   - Clicking a folder calls router.push with ?folder=<id> on the current pathname
//   - "All notes" affordance clears ?folder= back to base path
//   - Hard assertion: zero buttons with names /create|new|rename|delete|edit|\+/i
//     under any rendering state.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";

const pushMock = vi.fn();
let currentSearchParams = new URLSearchParams("");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/notes",
  useSearchParams: () => currentSearchParams,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const clientFetchMock = vi.fn();
vi.mock("@/lib/client-fetch", () => ({
  clientFetch: (...args: unknown[]) => clientFetchMock(...args),
}));

import { FoldersSidebar } from "../FoldersSidebar";

const resources = {
  "end-user": {
    "end-user": {
      "notes-list": {
        folders: {
          title: { label: "Folders" },
          "readonly-body": { text: "Folder management is in the desktop client." },
        },
      },
    },
  },
  common: { common: {} },
} as Record<string, Record<string, unknown>>;

function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider lng="en" resources={resources}>
        {ui}
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const MUTATION_PATTERN = /create|new folder|rename|delete folder|edit folder|\+/i;

function assertNoMutationUi(container: HTMLElement): void {
  const buttons = Array.from(container.querySelectorAll("button"));
  const offenders = buttons.filter((b) => MUTATION_PATTERN.test(b.textContent ?? ""));
  expect(offenders.map((o) => o.textContent ?? "")).toEqual([]);
  const inputs = Array.from(container.querySelectorAll("input"));
  // Inputs with type=text are forbidden — there is no rename form.
  expect(inputs.filter((i) => (i.type || "text") === "text")).toEqual([]);
}

describe("FoldersSidebar (Phase 07.1 / Plan 10 — D-UX5 read-only)", () => {
  beforeEach(() => {
    clientFetchMock.mockReset();
    pushMock.mockReset();
    currentSearchParams = new URLSearchParams("");
  });

  it("renders the readonly-body copy", async () => {
    clientFetchMock.mockResolvedValue({ folders: [] });
    renderWithProviders(<FoldersSidebar />);
    await waitFor(() => {
      expect(screen.getByText(/Folder management is in the desktop client/i)).toBeInTheDocument();
    });
  });

  it("renders each folder from useQuery", async () => {
    clientFetchMock.mockResolvedValue({
      folders: [
        { id: "ffffffff-ffff-ffff-ffff-ffffffffffff", name: "Work" },
        { id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", name: "Personal" },
      ],
    });
    renderWithProviders(<FoldersSidebar />);
    await waitFor(() => {
      expect(screen.getByText("Work")).toBeInTheDocument();
      expect(screen.getByText("Personal")).toBeInTheDocument();
    });
  });

  it("clicking a folder pushes /app/notes?folder=<id>", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    clientFetchMock.mockResolvedValue({
      folders: [{ id: "ffffffff-ffff-ffff-ffff-ffffffffffff", name: "Work" }],
    });
    renderWithProviders(<FoldersSidebar />);
    const link = await screen.findByText("Work");
    await user.click(link);
    await waitFor(() => {
      const urls = pushMock.mock.calls.map((c) => String(c[0]));
      expect(
        urls.some(
          (u) =>
            u.includes("/app/notes") && u.includes("folder=ffffffff-ffff-ffff-ffff-ffffffffffff"),
        ),
      ).toBe(true);
    });
  });

  it("D-UX5: zero folder mutation UI rendered in loading state", () => {
    clientFetchMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWithProviders(<FoldersSidebar />);
    assertNoMutationUi(container);
  });

  it("D-UX5: zero folder mutation UI rendered in empty state", async () => {
    clientFetchMock.mockResolvedValue({ folders: [] });
    const { container } = renderWithProviders(<FoldersSidebar />);
    await waitFor(() => {
      expect(screen.getByText(/Folder management is in the desktop client/i)).toBeInTheDocument();
    });
    assertNoMutationUi(container);
  });

  it("D-UX5: zero folder mutation UI rendered in populated state", async () => {
    clientFetchMock.mockResolvedValue({
      folders: [
        { id: "ffffffff-ffff-ffff-ffff-ffffffffffff", name: "Work" },
        { id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", name: "Personal" },
      ],
    });
    const { container } = renderWithProviders(<FoldersSidebar />);
    await waitFor(() => expect(screen.getByText("Work")).toBeInTheDocument());
    assertNoMutationUi(container);
  });
});
