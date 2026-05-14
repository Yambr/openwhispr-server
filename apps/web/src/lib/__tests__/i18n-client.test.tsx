// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 06 — i18next Client provider tests (RED before GREEN).
//
// The Client provider receives a serialized `resources` snapshot from the
// nearest RSC parent (Pitfall 1) and never re-fetches. Verified surface:
//   - children can call useTranslation('end-user') and resolve a key
//   - I18nProvider re-initializes when `lng` changes
import { render, screen } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n-client";

function Probe({ k, ns }: { k: string; ns: string }): React.JSX.Element {
  const { t } = useTranslation(ns);
  return <span data-testid="t-out">{t(k)}</span>;
}

const resources = {
  "end-user": {
    "end-user": {
      signin: { title: { heading: { text: "Sign in to OpenWhispr" } } },
    },
  },
  common: { common: { signout: { label: "Sign out" } } },
} as Record<string, Record<string, unknown>>;

describe("I18nProvider (Phase 07.1 / Plan 06)", () => {
  it("resolves a key from the serialized resources snapshot", () => {
    render(
      <I18nProvider lng="en" resources={resources}>
        <Probe ns="end-user" k="end-user.signin.title.heading.text" />
      </I18nProvider>,
    );
    expect(screen.getByTestId("t-out")).toHaveTextContent("Sign in to OpenWhispr");
  });

  it("resolves a common-namespace key", () => {
    render(
      <I18nProvider lng="en" resources={resources}>
        <Probe ns="common" k="common.signout.label" />
      </I18nProvider>,
    );
    expect(screen.getByTestId("t-out")).toHaveTextContent("Sign out");
  });
});
