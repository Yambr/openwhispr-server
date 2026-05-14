// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-05a — UICONF-04 hand-curated JSX-oracle inventory.
//
// Source-of-truth JSX oracles (RESEARCH §16 / D-20):
//   - .planning/phases/07-frontend-ui-spec/design/screens-user.jsx
//   - .planning/phases/07-frontend-ui-spec/design/screens-admin.jsx
//   - .planning/phases/07-frontend-ui-spec/design/ui.jsx
//
// The constants below are transcribed by hand from the cited line ranges.
// They are NOT derived from design-canvas.jsx (RESEARCH P6 overcorrection 1)
// and are NOT a skip-the-oracle invention (RESEARCH P6 overcorrection 2).
//
// Drift between the oracle and the production UI is detected when a
// conformance test consumes one of these constants and the rendered DOM
// no longer contains the asserted text/role/structure. Any oracle edit
// requires updating both this fixture and the affected tests in the same
// commit.
//
// Note on i18n: the JSX oracles use literal English strings. Our production
// components render translated copy via react-i18next. The conformance
// tests therefore mount the components inside an I18nProvider seeded with
// the SAME strings the oracle uses (where they map 1:1), or the live
// `end-user.json` resource bundle (when the production copy was localized
// away from the oracle's wording). The fixture carries the canonical
// expected strings; tests pick between oracle-literal and production-i18n
// per case.

// from screens-user.jsx:7-94 (ScreenSignIn) — U1
export const signInInventory = {
  // Oracle h2 text. Production renders this string inside <CardTitle>; the
  // actual i18n value (`end-user.signin.title.heading.text`) is "Sign in to
  // OpenWhispr" which is the production analog of the oracle's "Sign in".
  headingOracle: "Sign in",
  headingProduction: "Sign in to OpenWhispr",
  ledeOracle: "Welcome back to your OpenWhispr Server.",
  ledeProduction: "Use your email or your organization SSO.",
  // Oracle row: 3 OIDC buttons (Google / GitHub / SSO-OIDC, ghost variant
  // on the third). Production OidcButtons component maps the runtime
  // /api/auth/providers payload to the same 3 affordances.
  oidcLabels: [
    "Continue with Google", // screens-user.jsx:16-18
    "Continue with GitHub", // screens-user.jsx:19-21
    "Continue with SSO", // screens-user.jsx:22-24 — production i18n key end-user.signin.oidc.sso.label
  ],
  orSeparator: "Or with email", // screens-user.jsx:26 — production omits a literal "or" separator (deviation)
  emailLabel: "Email", // screens-user.jsx:28
  passwordLabel: "Password", // screens-user.jsx:35
  rememberLabel: "Remember this device", // screens-user.jsx:74 — production renders "Forgot password? — coming soon…" instead (D-UX2)
  forgotLink: "Forgot password?", // screens-user.jsx:77
  submitOracle: "Sign in", // screens-user.jsx:82
  submitProduction: "Sign in",
  footerLink: "Sign up", // screens-user.jsx:88
} as const;

// from screens-user.jsx:97-183 (ScreenSignUp) — U2
export const signUpInventory = {
  headingOracle: "Create account",
  headingProduction: "Create your OpenWhispr account",
  ledeOracle: "The first registered user becomes the admin of this server.",
  ledeProduction: "A confirmation email is sent to verify your address.",
  nameLabel: "Name", // screens-user.jsx:107
  emailLabel: "Email", // screens-user.jsx:110
  passwordLabel: "Password", // screens-user.jsx:113
  submitOracle: "Create account", // screens-user.jsx:171
  submitProduction: "Sign up",
  footerLink: "Sign in", // screens-user.jsx:177
  // UICONF-06 hardening tokens (Plan 12-04 introduced these distinct keys).
  duplicate: {
    title: { text: "Email already registered" }, // end-user.signup.error-duplicate.title.text
    body: { text: "This email is already registered. Sign in instead." }, // end-user.signup.error-duplicate.body.text
  },
  generic: {
    title: { text: "Sign-up failed" },
    body: { text: "Sign-up failed. Please review the form and try again." },
  },
} as const;

// from screens-user.jsx:15-25 (OIDC button row inside ScreenSignIn)
export const oidcInventory = {
  // 3 providers + the third (generic OIDC) uses `kind="ghost"` in the
  // oracle (line 22). Production maps `oidc` id → "sso" i18n slot
  // (OidcButtons.tsx labelKey) and renders all three buttons with the
  // shared `outline` variant; ghost-vs-outline distinction is documented
  // as a non-semantic styling deviation in the SUMMARY's Deviations
  // section, not enforced by conformance tests.
  providers: [
    { id: "google" as const, name: "Google", label: "Continue with Google" },
    { id: "github" as const, name: "GitHub", label: "Continue with GitHub" },
    { id: "oidc" as const, name: "Single Sign-On", label: "Continue with SSO" },
  ],
  // 0/1/N scenarios for the test suite.
  empty: [] as const,
  single: [{ id: "google" as const, name: "Google", label: "Continue with Google" }],
} as const;

// from screens-user.jsx:186-260 (ScreenVerify) — U3
//
// The oracle ScreenVerify enumerates FOUR variants via the `variant` prop:
// "pending" / "verifying" / "success" / "error" (lines 215-218). The
// shipped VerifyEmailClient component (Plan 07 / Plan 12-04) collapses
// these to THREE states ("loading" / "success" / "error") because the
// production token-validation flow has no user-driven "pending" branch —
// the RSC validates `?token=` before mounting the client, so we only see
// loading → success|error in practice. This is a documented design
// deviation (RESEARCH §16 / Plan 07 D-UX3); the conformance test asserts
// the THREE shipped variants, not all four oracle variants.
export const verifyEmailInventory = {
  // Variants shipped in production (3 of 4 oracle variants).
  variants: [
    {
      name: "loading" as const,
      // Loading variant copy from end-user.verify.loading.body.text.
      body: "Verifying your email...",
    },
    {
      name: "success" as const,
      title: "Email verified",
      body: "Your email is confirmed. You can now sign in.",
      ctaLabel: "Sign in",
      ctaHref: "/sign-in",
    },
    {
      name: "error" as const,
      title: "Verification failed",
      body: "This verification link is invalid or has expired. Sign up again.",
      ctaLabel: "Back to sign up",
      ctaHref: "/sign-up",
    },
  ],
  // Oracle-only variant ("pending" — user clicks "Open mail app") — not
  // shipped; recorded here for traceability so any future plan that
  // implements the standalone /verify-email "check your inbox" view can
  // import this token and assert against it.
  oraclePendingVariant: {
    name: "pending" as const,
    title: "Check your inbox", // screens-user.jsx:215
    cta: "Open mail app", // screens-user.jsx:237
  },
} as const;

// from ui.jsx:229-316 (AuthShell) + ui.jsx:326-336 (Btn) + ui.jsx:338-352 (Field)
//
// NO /setup JSX oracle exists in screens-user.jsx — see RESEARCH §16 / D-20.
// The /setup wizard composes the shared AuthShell + Btn + Field primitives;
// the wizard's section structure (Identity → Workspace → Review) is an
// ADMIN-02 invention with no oracle artboard.
export const setupInventory = {
  // 3 stepper sections wired to anchor ids (SetupForm SECTION_IDS).
  sectionIds: ["identity", "workspace", "review"] as const,
  // Stepper data-slot exposed by ui/stepper.tsx (vendored).
  stepperSlot: "stepper",
  // Composition note (must appear in test header comment — documented
  // design deviation per RESEARCH §16).
  oracleDeviation: "no /setup JSX oracle — wizard composed of ui.jsx primitives",
  // Field labels (from end-user.setup.form.*.label production copy).
  labels: {
    name: "Name",
    email: "Email",
    password: "Password",
    workspace: "Workspace name",
    timezone: "Timezone",
    submit: "Create admin and finish setup",
  },
  // Wizard heading (CardTitle).
  heading: "Set up your OpenWhispr server",
} as const;

// from screens-admin.jsx:445-628 (ScreenConfig) — A3
//
// Plan 12-04 AdminIndex mirrors ONLY A3 ScreenConfig (RESEARCH §15(h)).
// A1 ScreenAudit + A2 ScreenObservability surface PII (actor emails, IPs,
// audit-row metadata) and are out-of-scope for Phase 12 — Phase 13+ ships
// them behind RLS-gated admin queries.
export const adminConfigInventory = {
  // Page-head.
  heading: "Configuration", // screens-admin.jsx:451
  ledeOracle:
    "Server-side configuration for speech-to-text and note recording. Set via env vars; admin can view but not edit in v1.",
  // Read-only alert (screens-admin.jsx:462-476). Production renders this
  // as role='status' (informational, NOT destructive) to keep the
  // /admin index free of role='alert' which our convention reserves for
  // user-actionable destructive states.
  readonly: {
    title: "Read-only",
    role: "status",
  },
  // 2-column card grid (screens-admin.jsx:478-582). Production AdminIndex
  // renders exactly 2 cards: STT config + Note recording. The third card
  // ("Effective env") in the oracle is deliberately NOT mirrored — its
  // table values include redacted env vars; rendering even partial env
  // values widens the trust boundary for an end-user-visible /admin
  // landing (the actual values are reachable via the sidebar → Config
  // route which already exists).
  cards: [
    {
      titleOracle: "STT config", // screens-admin.jsx:495
      titleProduction: "Speech-to-text",
      endpoint: "GET /api/stt-config", // screens-admin.jsx:496
    },
    {
      titleOracle: "Note recording", // screens-admin.jsx:548
      titleProduction: "Note recording",
      endpoint: "GET /api/note-recording-config", // screens-admin.jsx:549
    },
  ],
  // PII gate (defense-in-depth over Plan 12-04 Task 5).
  piiPatterns: {
    email: /[\w.+-]+@[\w-]+\.[\w.-]+/,
    ipv4: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    auditSubstring: "audit",
  },
} as const;
