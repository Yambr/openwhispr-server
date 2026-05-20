// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 08 — U5 SessionsTable (Client Component).
//
// D-API2: every session-management call is a Better Auth catch-all:
//   authClient.listSessions()        → GET /api/auth/list-sessions
//   authClient.revokeSession({tok})  → POST /api/auth/revoke-session
//   authClient.revokeOtherSessions() → POST /api/auth/revoke-other-sessions
//
// We use TanStack Query (queryKeys.sessions()) so RSC prefetch + cache
// invalidation work the same as any other screen.
//
// Phase 68 / Plan 68-01 — REVIEW web HIGH HI-02 (session-bearer heap
// exposure — documented, unavoidable).
//   `authClient.listSessions()` returns each session's Better Auth bearer
//   on `SessionRow.token`, so the bearer for every session sits in the JS
//   heap (the TanStack Query cache). This is UNAVOIDABLE in Better Auth
//   1.6.9: `revokeSession` accepts ONLY `{ token }` — there is NO
//   id-based revocation overload (confirmed against
//   `better-auth/dist/api/routes/session.d.mts:230-235`, body
//   `z.ZodObject<{ token: z.ZodString }>` only). Revoking a session
//   therefore REQUIRES holding its token.
//   Containment posture:
//     * The token is read ONLY inside the `revokeOne` mutation closure
//       (`revokeOne.mutate(row.token)`). It is NEVER placed in a rendered
//       DOM attribute, a `data-*` attribute, or a React `key` (keys use
//       the opaque `row.id`). `sessions-table-bearer-exposure.test.ts`
//       pins this.
//     * The app CSP `connect-src` allowlist limits where a compromised
//       dependency / XSS could exfiltrate a heap-read bearer to.
//   Durable fix (v2): a Better Auth upgrade exposing id-based session
//   revocation — recorded in `.planning/deferred-items.md`.
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { authClient } from "@/lib/auth-client";
import { queryKeys } from "@/lib/query-keys";

export interface SessionRow {
  id: string;
  token: string;
  userId?: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt?: string | Date | null;
  expiresAt?: string | Date | null;
}

interface BetterAuthEnvelope<T> {
  data: T | null;
  error: { message?: string } | null;
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

export interface SessionsTableProps {
  /**
   * Phase 51 / Plan 51-04 (REVIEW CR-4) — was `currentSessionToken`
   * (a Better Auth bearer). The bearer was serialized into the JS
   * heap. Now we receive the session ID (safe, opaque identifier)
   * and compare against `row.id` instead of `row.token`.
   */
  currentSessionId: string;
}

export function SessionsTable({ currentSessionId }: SessionsTableProps): React.JSX.Element {
  const { t } = useTranslation(["end-user", "common"]);
  const queryClient = useQueryClient();

  const sessions = useQuery({
    queryKey: queryKeys.sessions(),
    queryFn: async (): Promise<SessionRow[]> => {
      const res = (await authClient.listSessions()) as BetterAuthEnvelope<SessionRow[]>;
      if (res.error) throw new Error(res.error.message ?? "list-sessions failed");
      return (res.data ?? []) as SessionRow[];
    },
  });

  const revokeOne = useMutation({
    mutationFn: async (token: string) => {
      const res = (await authClient.revokeSession({ token })) as BetterAuthEnvelope<unknown>;
      if (res.error) throw new Error("revoke failed");
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    },
  });

  const revokeOthers = useMutation({
    mutationFn: async () => {
      const res = (await authClient.revokeOtherSessions()) as BetterAuthEnvelope<unknown>;
      if (res.error) throw new Error("revoke-others failed");
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    },
  });

  if (sessions.isPending) {
    return (
      <div className="space-y-2">
        <h2 className="font-semibold text-lg">
          {t("end-user:end-user.account.sessions.title.label")}
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("end-user:end-user.account.sessions.col-device.label")}</TableHead>
              <TableHead>{t("end-user:end-user.account.sessions.col-ip.label")}</TableHead>
              <TableHead>{t("end-user:end-user.account.sessions.col-created.label")}</TableHead>
              <TableHead>{t("end-user:end-user.account.sessions.col-expires.label")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 3 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders, stable count
              <TableRow key={i} data-testid="sessions-skeleton-row">
                {Array.from({ length: 5 }).map((__, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders, stable count
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (sessions.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("end-user:end-user.account.error.title.text")}</AlertTitle>
        <AlertDescription>
          <Button onClick={() => sessions.refetch()} size="sm" variant="outline">
            {t("end-user:end-user.account.error.retry.label")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // queryFn always resolves to an array (`?? []`) so sessions.data is never
  // nullish here; no fallback needed.
  const rows = sessions.data as SessionRow[];
  const hasOthers = rows.length > 1;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-lg">
          {t("end-user:end-user.account.sessions.title.label")}
        </h2>
        {hasOthers ? (
          <Button
            disabled={revokeOthers.isPending}
            onClick={() => revokeOthers.mutate()}
            size="sm"
            variant="outline"
          >
            {t("end-user:end-user.account.sessions.action-revoke-others.label")}
          </Button>
        ) : null}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("end-user:end-user.account.sessions.col-device.label")}</TableHead>
            <TableHead>{t("end-user:end-user.account.sessions.col-ip.label")}</TableHead>
            <TableHead>{t("end-user:end-user.account.sessions.col-created.label")}</TableHead>
            <TableHead>{t("end-user:end-user.account.sessions.col-expires.label")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            // Phase 51 / Plan 51-04 — was `row.token === currentSessionToken`.
            const isCurrent = row.id === currentSessionId;
            return (
              <TableRow key={row.id}>
                <TableCell>
                  <span>{row.userAgent ?? "—"}</span>
                  {isCurrent ? (
                    <Badge
                      className="ml-2"
                      data-testid="session-row-this-device"
                      variant="secondary"
                    >
                      {t("common:common.session.thisDevice.label")}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>{row.ipAddress ?? "—"}</TableCell>
                <TableCell>{formatDate(row.createdAt)}</TableCell>
                <TableCell>{formatDate(row.expiresAt)}</TableCell>
                <TableCell>
                  <Button
                    disabled={revokeOne.isPending}
                    onClick={() => revokeOne.mutate(row.token)}
                    size="sm"
                    variant="outline"
                  >
                    {t("end-user:end-user.account.sessions.action-revoke.label")}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
