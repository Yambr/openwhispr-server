// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 07 — U1 Sign-in route.
//
// Pure RSC entry that hands off to the Client SignInForm. The form
// hardcodes its post-signin destination to "/app" — we do NOT honor a
// `?next=` query parameter (open-redirect mitigation per
// 07.1-RESEARCH.md § Security Domain).
import { SignInForm } from "@/components/screens/auth/SignInForm";

export default function SignInPage(): React.JSX.Element {
  return <SignInForm />;
}
