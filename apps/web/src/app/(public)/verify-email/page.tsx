// Phase 07.1 / Plan 07 — U3 Verify-email route.
//
// RSC parses `?token=` and validates it against a tight regex BEFORE
// passing it to the Client component. This is the reflected-XSS defense
// called out in 07.1-RESEARCH.md § Security Domain: the token is never
// rendered to the DOM and only Better Auth's verify endpoint ever sees it.
import { z } from "zod";
import { VerifyEmailClient } from "@/components/screens/auth/VerifyEmailClient";

// Better Auth verification tokens are URL-safe; the regex below accepts the
// canonical set [A-Za-z0-9._-] with a defensive [1, 512] length bound.
const TokenSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9._-]+$/);

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const raw = Array.isArray(sp.token) ? sp.token[0] : sp.token;
  const parsed = TokenSchema.safeParse(raw);
  return <VerifyEmailClient token={parsed.success ? parsed.data : undefined} />;
}
