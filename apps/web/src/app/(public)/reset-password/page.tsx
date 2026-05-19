// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-01-a / Task 2 GREEN — /reset-password RSC entry.
//
// Next.js 15 App Router signature: searchParams is a Promise that must
// be awaited inside the async server component (Next.js 15 breaking
// change from sync searchParams in 14.x).
import { ResetPasswordForm } from "@/components/screens/auth/ResetPasswordForm";

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage(
  props: ResetPasswordPageProps,
): Promise<React.JSX.Element> {
  const { token } = await props.searchParams;
  return <ResetPasswordForm token={token ?? null} />;
}
