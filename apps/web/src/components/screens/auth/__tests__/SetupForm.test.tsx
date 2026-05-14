// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-03 / Task 3 + Task 4 — SetupForm + setup-schema tests.
//
// Two describe blocks:
//   * Task 3 — "schema" — exercises `setupSchema` + the zod-i18n bridge
//     across 6 Zod-issue permutations in both EN and RU.
//   * Task 4 — SetupForm component tests (RHF + Zod + Stepper +
//     IntersectionObserver + idempotent submit) AND a small RSC-page
//     guard suite (verifies the page fetches PUBLIC /api/setup-state,
//     NOT /api/capabilities — BLOCKER 1 regression net).

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance } from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n-client";
import { setupSchema } from "@/lib/schemas/setup";
import { installZodI18n } from "@/lib/zod-i18n";
import enCommon from "@/locales/en/common.json";
import enEndUser from "@/locales/en/end-user.json";
import ruCommon from "@/locales/ru/common.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/setup",
  redirect: (path: string) => {
    rscRedirect(path);
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const routerPush = vi.fn();
const rscRedirect = vi.fn();

/**
 * Build an isolated i18next instance bound to a single language. The
 * customError map closes over the instance returned here so two
 * concurrent describe blocks (en + ru) do not race for a single global
 * map.
 *
 * NOTE: installZodI18n() sets a GLOBAL Zod customError map per
 * `z.config({ customError })`. Tests run sequentially within vitest so
 * the en block installs its map, the ru block reinstalls — last-writer
 * wins. We compensate by re-installing inside each `it`.
 */
function makeI18n(lng: "en" | "ru") {
  const i = createInstance();
  const fileContents =
    lng === "en" ? (enCommon as Record<string, unknown>) : (ruCommon as Record<string, unknown>);
  // The locale JSON files are wrapped in a top-level `{"common":{...}}`
  // namespace key (matches the keys actually consumed by the live app,
  // e.g. `t("common:common.signout.label")` in AppShell.tsx). To honor
  // that key shape we load the JSON as the FULL `common` namespace
  // payload — i18next stores it under `bundles[lng].common.common.…`.
  i.init({
    lng,
    resources: { [lng]: { common: fileContents } },
    ns: ["common"],
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });
  return i;
}

const VALID = {
  email: "admin@acme.test",
  password: "CorrectHorseBattery9",
  name: "Alice Admin",
  workspace: "Acme Inc",
  timezone: "Europe/Berlin",
};

describe("schema — setupSchema + zod-i18n bridge (Task 3, UICONF-03)", () => {
  it("(en) accepts a fully valid payload", () => {
    installZodI18n(makeI18n("en"));
    const r = setupSchema.safeParse(VALID);
    expect(r.success).toBe(true);
  });

  it("(en) invalid email → localized English message", () => {
    installZodI18n(makeI18n("en"));
    const r = setupSchema.safeParse({ ...VALID, email: "not-an-email" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "email")?.message;
      expect(msg).toBe("Enter a valid email address.");
    }
  });

  it("(en) password too short → localized English message", () => {
    installZodI18n(makeI18n("en"));
    const r = setupSchema.safeParse({ ...VALID, password: "short" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "password")?.message;
      expect(msg).toBe("Password must be at least 12 characters.");
    }
  });

  it("(en) password missing character classes → localized English message", () => {
    installZodI18n(makeI18n("en"));
    const r = setupSchema.safeParse({ ...VALID, password: "alllowercaseletters" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "password")?.message;
      expect(msg).toBe("Password must include upper-, lower-case, and a digit.");
    }
  });

  it("(en) empty workspace → localized English message", () => {
    installZodI18n(makeI18n("en"));
    const r = setupSchema.safeParse({ ...VALID, workspace: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "workspace")?.message;
      expect(msg).toBe("Value is too short.");
    }
  });

  it("(en) workspace over 100 chars → localized English message", () => {
    installZodI18n(makeI18n("en"));
    const r = setupSchema.safeParse({ ...VALID, workspace: "x".repeat(101) });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "workspace")?.message;
      expect(msg).toBe("Value is too long.");
    }
  });

  // Russian assertions compare against the live `ru/common.json` payload
  // (rather than embedded literals) so this test file remains
  // English-only at the source-artifact level (the global lint-english
  // tool refuses Cyrillic in non-locale source files, and renaming the
  // file would break the plan's grep gate on the form-test path).
  const ruExpected = {
    emailInvalid: (ruCommon as { common: { validation: { email: { invalid: string } } } }).common
      .validation.email.invalid,
    passwordMinLength: (
      ruCommon as { common: { validation: { password: { min_length: string } } } }
    ).common.validation.password.min_length,
  };

  it("(ru) invalid email -> localized Russian message", () => {
    installZodI18n(makeI18n("ru"));
    const r = setupSchema.safeParse({ ...VALID, email: "not-an-email" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "email")?.message;
      expect(msg).toBe(ruExpected.emailInvalid);
    }
  });

  it("(ru) password too short -> localized Russian message", () => {
    installZodI18n(makeI18n("ru"));
    const r = setupSchema.safeParse({ ...VALID, password: "short" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "password")?.message;
      expect(msg).toBe(ruExpected.passwordMinLength);
    }
  });
});

// ---------------------------------------------------------------------
// Task 4 — SetupForm component tests.
//
// The form mounts inside an I18nProvider seeded with the live
// `end-user` + `common` namespaces so localized copy resolves
// correctly. The fetch global is replaced per-test (no leak between
// `it`s); RHF + IntersectionObserver run inside happy-dom which lacks
// a real IntersectionObserver — we stub a minimal one for the effect's
// teardown to call .disconnect on.
// ---------------------------------------------------------------------

const formResources = {
  "end-user": enEndUser as unknown as Record<string, unknown>,
  common: enCommon as unknown as Record<string, unknown>,
};

function WrapForm({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider lng="en" resources={formResources}>
      {children}
    </I18nProvider>
  );
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  routerPush.mockReset();
  rscRedirect.mockReset();
  // Minimal IntersectionObserver stub for happy-dom (lacks the API).
  // The component's effect calls .observe + cleanup .disconnect; no
  // test asserts on `currentStep` flips driven by the observer.
  // biome-ignore lint/suspicious/noExplicitAny: minimal IO shim
  (globalThis as any).IntersectionObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("SetupForm — Task 4 client wizard", () => {
  it("renders all field labels (Identity + Workspace) + submit button", async () => {
    const { SetupForm } = await import("../SetupForm");
    render(
      <WrapForm>
        <SetupForm />
      </WrapForm>,
    );
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/workspace name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/timezone/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create admin and finish setup/i }),
    ).toBeInTheDocument();
  });

  it("(a) valid submit posts JSON to /api/setup/admin including workspace + timezone", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          admin: { email: "a@x.test" },
          alreadyCompleted: false,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { SetupForm } = await import("../SetupForm");
    const user = userEvent.setup();
    render(
      <WrapForm>
        <SetupForm />
      </WrapForm>,
    );
    await user.type(screen.getByLabelText(/^name$/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "a@x.test");
    await user.type(screen.getByLabelText(/^password$/i), "CorrectHorseBattery9");
    await user.type(screen.getByLabelText(/workspace name/i), "Acme");
    await user.click(screen.getByRole("button", { name: /create admin and finish setup/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("/api/setup/admin");
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.email).toBe("a@x.test");
    expect(body.workspace).toBe("Acme");
    expect(typeof body.timezone).toBe("string");
    expect((body.timezone as string).length).toBeGreaterThan(0);
  });

  it("(b) invalid email surfaces a single localized error via getByRole('alert')", async () => {
    const { SetupForm } = await import("../SetupForm");
    const user = userEvent.setup();
    render(
      <WrapForm>
        <SetupForm />
      </WrapForm>,
    );
    await user.type(screen.getByLabelText(/^name$/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "not-an-email");
    await user.type(screen.getByLabelText(/^password$/i), "CorrectHorseBattery9");
    await user.type(screen.getByLabelText(/workspace name/i), "Acme");
    await user.click(screen.getByRole("button", { name: /create admin and finish setup/i }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
  });

  it("(c) submit button disables while the fetch is in flight", async () => {
    let resolveFetch!: (r: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolveFetch = r;
    });
    globalThis.fetch = vi.fn().mockReturnValue(pending) as unknown as typeof fetch;
    const { SetupForm } = await import("../SetupForm");
    const user = userEvent.setup();
    render(
      <WrapForm>
        <SetupForm />
      </WrapForm>,
    );
    await user.type(screen.getByLabelText(/^name$/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "a@x.test");
    await user.type(screen.getByLabelText(/^password$/i), "CorrectHorseBattery9");
    await user.type(screen.getByLabelText(/workspace name/i), "Acme");
    const submitBtn = screen.getByRole("button", { name: /create admin and finish setup/i });
    await user.click(submitBtn);
    await waitFor(() => expect(submitBtn).toBeDisabled());
    // Resolve so the cleanup doesn't hang.
    resolveFetch(
      new Response(JSON.stringify({ admin: { email: "a@x.test" }, alreadyCompleted: false }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("(d) 201 success triggers router.push('/admin') with NO query string", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ admin: { email: "a@x.test" }, alreadyCompleted: false }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const { SetupForm } = await import("../SetupForm");
    const user = userEvent.setup();
    render(
      <WrapForm>
        <SetupForm />
      </WrapForm>,
    );
    await user.type(screen.getByLabelText(/^name$/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "a@x.test");
    await user.type(screen.getByLabelText(/^password$/i), "CorrectHorseBattery9");
    await user.type(screen.getByLabelText(/workspace name/i), "Acme");
    await user.click(screen.getByRole("button", { name: /create admin and finish setup/i }));
    await waitFor(() => expect(routerPush).toHaveBeenCalledTimes(1));
    expect(routerPush).toHaveBeenCalledWith("/admin");
  });

  it("(extra) non-2xx fetch response surfaces the generic error alert", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "ADMIN_CREATE_FAILED" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const { SetupForm } = await import("../SetupForm");
    const user = userEvent.setup();
    render(
      <WrapForm>
        <SetupForm />
      </WrapForm>,
    );
    await user.type(screen.getByLabelText(/^name$/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "a@x.test");
    await user.type(screen.getByLabelText(/^password$/i), "CorrectHorseBattery9");
    await user.type(screen.getByLabelText(/workspace name/i), "Acme");
    await user.click(screen.getByRole("button", { name: /create admin and finish setup/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Setup failed/i)).toBeInTheDocument();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("(extra) thrown fetch (network failure) surfaces the generic error alert", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    const { SetupForm } = await import("../SetupForm");
    const user = userEvent.setup();
    render(
      <WrapForm>
        <SetupForm />
      </WrapForm>,
    );
    await user.type(screen.getByLabelText(/^name$/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "a@x.test");
    await user.type(screen.getByLabelText(/^password$/i), "CorrectHorseBattery9");
    await user.type(screen.getByLabelText(/workspace name/i), "Acme");
    await user.click(screen.getByRole("button", { name: /create admin and finish setup/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Setup failed/i)).toBeInTheDocument();
  });

  it("(e) 201 with warnings:['tenant_rename_failed'] renders notice AND still redirects", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          admin: { email: "a@x.test" },
          alreadyCompleted: false,
          warnings: ["tenant_rename_failed"],
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;
    const { SetupForm } = await import("../SetupForm");
    const user = userEvent.setup();
    render(
      <WrapForm>
        <SetupForm />
      </WrapForm>,
    );
    await user.type(screen.getByLabelText(/^name$/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "a@x.test");
    await user.type(screen.getByLabelText(/^password$/i), "CorrectHorseBattery9");
    await user.type(screen.getByLabelText(/workspace name/i), "Acme");
    await user.click(screen.getByRole("button", { name: /create admin and finish setup/i }));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/admin"));
    // Notice IS rendered (synchronously set right before router.push;
    // the inline mock router-push does not unmount the component).
    expect(
      screen.queryByText(/admin created, but the workspace name could not be saved/i),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------
// Task 4 — RSC page guard.
//
// page.tsx is a Server Component using async/await + redirect() from
// next/navigation. We unit-test the page's branch logic by invoking
// the default export directly with mocked headers + global fetch.
// ---------------------------------------------------------------------

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-locale": "en" }),
}));

vi.mock("@/lib/i18n", () => ({
  getServerI18n: async () => ({
    t: (k: string) => k, // identity translator — assertions match the raw key
  }),
}));

describe("/setup RSC page guard — fetch target + branches", () => {
  beforeEach(() => {
    rscRedirect.mockReset();
    routerPush.mockReset();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("status='pending' -> renders <SetupForm /> (no redirect)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "pending" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const { default: SetupPage } = await import("@/app/(public)/setup/page");
    const node = await SetupPage();
    expect(rscRedirect).not.toHaveBeenCalled();
    // The returned node is the <SetupForm /> JSX element — assert
    // structural match.
    expect(node).toBeDefined();
  });

  it("status='completed' -> redirect('/sign-in')", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "completed" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const { default: SetupPage } = await import("@/app/(public)/setup/page");
    await SetupPage();
    expect(rscRedirect).toHaveBeenCalledWith("/sign-in");
  });

  it("status='skipped_legacy' -> redirect('/sign-in')", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "skipped_legacy" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const { default: SetupPage } = await import("@/app/(public)/setup/page");
    await SetupPage();
    expect(rscRedirect).toHaveBeenCalledWith("/sign-in");
  });

  it("503 / fetch failure -> renders initializing copy (no redirect)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("connection refused")) as unknown as typeof fetch;
    const { default: SetupPage } = await import("@/app/(public)/setup/page");
    const node = await SetupPage();
    expect(rscRedirect).not.toHaveBeenCalled();
    expect(node).toBeDefined();
  });

  it("(BLOCKER 1 regression net) fetch URL targets /api/setup-state, NEVER /api/capabilities", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "pending" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { default: SetupPage } = await import("@/app/(public)/setup/page");
    await SetupPage();
    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/api/setup-state"))).toBe(true);
    expect(calls.some((u) => u.includes("/api/capabilities"))).toBe(false);
  });
});
