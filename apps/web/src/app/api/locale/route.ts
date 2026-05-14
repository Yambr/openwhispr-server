// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 10 / Plan 02 — Locale-switching route handler.
//
// Accepts POST `{ locale: 'en' | 'ru' }`, validates with zod, and persists
// the choice as the `NEXT_LOCALE` cookie that the Edge middleware reads
// on subsequent requests. The cookie is intentionally NOT httpOnly so a
// future client-side locale-detection fallback can read it directly; it is
// scoped `SameSite=Lax` and 1 year. The body is otherwise empty (204 No
// Content) on success.
//
// Errors are returned in the canonical OpenWhispr error envelope shape
// (`{ error: { code, message } }`) so downstream consumers (the language
// switcher and any future programmatic callers) can branch on `code`.
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Body = z.object({
  locale: z.enum(["en", "ru"]),
});

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function POST(req: Request): Promise<NextResponse> {
  let parsed: z.infer<typeof Body>;
  try {
    const json = await req.json();
    parsed = Body.parse(json);
  } catch (_err) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_LOCALE",
          message: "Body must be { locale: 'en' | 'ru' }",
        },
      },
      { status: 400 },
    );
  }

  const res = new NextResponse(null, { status: 204 });
  res.cookies.set({
    name: "NEXT_LOCALE",
    value: parsed.locale,
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  return res;
}
