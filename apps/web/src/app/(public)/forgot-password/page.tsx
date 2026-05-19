// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-01-a / Task 2 GREEN — /forgot-password RSC entry.
//
// Pure RSC entry that hands off to the Client ForgotPasswordForm. The
// form delegates to authClient.forgetPassword and renders an
// enumeration-safe success panel regardless of outcome.
import { ForgotPasswordForm } from "@/components/screens/auth/ForgotPasswordForm";

export default function ForgotPasswordPage(): React.JSX.Element {
  return <ForgotPasswordForm />;
}
