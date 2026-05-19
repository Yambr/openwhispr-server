// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 08 — U5 Account composite (Client Component).
//
// Receives the server-resolved Better Auth user object from the RSC parent
// (no client-side fetch for profile — `app/(auth)/layout.tsx` already
// resolved the session via getServerSession). Composes:
//   - ProfileCard      (read-only profile data)
//   - SessionsTable    (Better Auth list/revoke flows)
//   - DeleteAccountDialog (typed-email confirm + DELETE /api/auth/delete-account)
"use client";

import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { SessionsTable } from "./SessionsTable";

export interface AccountUser {
  id: string;
  name?: string | null;
  email: string;
  emailVerified?: boolean;
  createdAt?: string | Date | null;
}

export interface AccountClientProps {
  user: AccountUser;
  /**
   * Phase 51 / Plan 51-04 (REVIEW CR-4) — was `currentSessionToken`
   * (a Better Auth bearer). Renamed to the safe session identifier
   * because the bearer was being serialized into __NEXT_DATA__ /
   * the JS heap, defeating HttpOnly cookie protection.
   */
  currentSessionId: string;
}

function formatCreatedAt(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  // BUG-53-40: was `format(d, "yyyy-MM-dd")` from date-fns, which uses
  // the local timezone. SSR (Docker UTC) and the client browser
  // (e.g. America/Los_Angeles) disagree at midnight UTC, producing a
  // React #418 text-content hydration mismatch on `/app/account`.
  // Use the UTC ISO date slice — same approach as SessionsTable's
  // formatDate — so SSR and client always render identical strings.
  return d.toISOString().slice(0, 10);
}

export function AccountClient({ user, currentSessionId }: AccountClientProps): React.JSX.Element {
  const { t } = useTranslation(["end-user"]);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-semibold text-2xl">
          {t("end-user:end-user.account.title.heading.text")}
        </h1>
        <p className="text-text-muted text-sm">
          {t("end-user:end-user.account.subtitle.body.text")}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("end-user:end-user.account.profile.title.label")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <div className="text-text-muted text-xs">
              {t("end-user:end-user.account.profile.name.label")}
            </div>
            <div className="font-medium">{user.name ?? "—"}</div>
          </div>
          <div>
            <div className="text-text-muted text-xs">
              {t("end-user:end-user.account.profile.email.label")}
            </div>
            <div className="flex items-center gap-2 font-medium">
              <span>{user.email}</span>
              {user.emailVerified ? (
                <Badge data-testid="profile-verified-badge" variant="secondary">
                  {t("end-user:end-user.account.profile.verified.label")}
                </Badge>
              ) : null}
            </div>
          </div>
          <div>
            <div className="text-text-muted text-xs">
              {t("end-user:end-user.account.profile.created.label")}
            </div>
            <div className="font-medium" data-testid="profile-created-value">
              {formatCreatedAt(user.createdAt)}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <SessionsTable currentSessionId={currentSessionId} />
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>{t("end-user:end-user.account.danger.title.label")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DeleteAccountDialog userEmail={user.email} />
        </CardContent>
      </Card>
    </div>
  );
}
