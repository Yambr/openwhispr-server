// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 08 — U5 DeleteAccountDialog (Client Component).
//
// AlertDialog gated by a typed-email confirmation Input. Calls
// `authClient.deleteAccount()` (Better Auth catch-all DELETE /api/auth/delete-account)
// then `authClient.signOut()` (defensive — clears any client-side cache)
// and `router.push('/sign-in')` on success. Stays open on error so the
// user can retry or close manually.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

interface BetterAuthEnvelope {
  data: unknown;
  error: { message?: string } | null;
}

export interface DeleteAccountDialogProps {
  userEmail: string;
}

export function DeleteAccountDialog({ userEmail }: DeleteAccountDialogProps): React.JSX.Element {
  const { t } = useTranslation(["end-user", "common"]);
  const router = useRouter();
  const [typed, setTyped] = useState<string>("");
  const [pending, setPending] = useState<boolean>(false);
  const [open, setOpen] = useState<boolean>(false);

  const confirmed = typed === userEmail;

  async function handleConfirm(): Promise<void> {
    // Button is `disabled` whenever !confirmed OR pending, so this entry
    // point is naturally serialised — no extra in-flight guard needed.
    setPending(true);
    try {
      const res = (await authClient.deleteAccount({
        callbackURL: "/sign-in",
      })) as BetterAuthEnvelope;
      if (res.error) {
        // Stay open on error.
        return;
      }
      // Defensive sign-out (best-effort) — Better Auth's deleteAccount
      // server-side already clears the cookie; we call signOut to flush
      // any client-side cache / useSession subscribers.
      try {
        await authClient.signOut();
      } catch {
        // best-effort
      }
      router.push("/sign-in");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog onOpenChange={setOpen} open={open}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">{t("end-user:end-user.account.danger.delete.label")}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("end-user:end-user.account.danger.dialog-title.text")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("end-user:end-user.account.danger.dialog-body.text")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="delete-account-email">
            {t("end-user:end-user.account.danger.dialog-input.label")}
          </Label>
          <Input
            autoComplete="off"
            id="delete-account-email"
            onChange={(e) => setTyped(e.target.value)}
            placeholder={userEmail}
            type="email"
            value={typed}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="delete-account-confirm"
            disabled={!confirmed || pending}
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
          >
            {t("end-user:end-user.account.danger.dialog-confirm.label")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
