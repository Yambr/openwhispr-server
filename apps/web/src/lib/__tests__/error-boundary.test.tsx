// Phase 07.1 / Plan 06 — error-boundary tests (RED before GREEN).
//
// Class component using React 19 error boundary lifecycle (getDerivedStateFromError
// + componentDidCatch). Renders Alert with i18n copy on failure, exposes a
// Reset button that re-mounts children.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../error-boundary";

function Boom(): never {
  throw new Error("boom");
}

function Ok(): React.JSX.Element {
  return <span>ok</span>;
}

describe("ErrorBoundary (Phase 07.1 / Plan 06)", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <Ok />
      </ErrorBoundary>,
    );
    expect(screen.getByText("ok")).toBeInTheDocument();
  });

  it("renders fallback Alert when a child throws", () => {
    // Suppress React's expected error log during this test.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    spy.mockRestore();
  });

  it("Reset button clears the error and re-renders children", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // First render with a throwing child, then swap to a healthy child after reset.
    function Toggle({ on }: { on: boolean }): React.JSX.Element {
      return on ? <Boom /> : <Ok />;
    }
    const { rerender } = render(
      <ErrorBoundary>
        <Toggle on={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    rerender(
      <ErrorBoundary>
        <Toggle on={false} />
      </ErrorBoundary>,
    );
    const resetBtn = screen.getByRole("button", { name: /retry/i });
    await user.click(resetBtn);
    expect(screen.getByText("ok")).toBeInTheDocument();
    spy.mockRestore();
  });
});
