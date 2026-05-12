// Phase 07.1 / Plan 10 — U8 FoldersSidebar (Client Component).
//
// D-UX5 (Constitutional): folders are READ-ONLY in web. Desktop is the
// single owner of folder CRUD. This component renders:
//   - A read-only list of the user's folders
//   - An "All notes" affordance that clears the ?folder= filter
//   - Click-to-filter: pushes /app/notes?folder=<id>
//
// Forbidden affordances (asserted by unit tests):
//   - No Create / New folder button
//   - No Rename / Edit folder button or input
//   - No Delete folder button
//   - No "+" affordance
"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { clientFetch } from "@/lib/client-fetch";
import { queryKeys } from "@/lib/query-keys";
import type { CloudFolder } from "./NotesListClient";

interface FoldersListResponse {
  folders: CloudFolder[];
}

export function FoldersSidebar(): React.JSX.Element {
  const { t } = useTranslation(["end-user"]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selected = searchParams.get("folder");

  const folders = useQuery({
    queryKey: queryKeys.folders(),
    queryFn: () => clientFetch<FoldersListResponse>("/api/folders/list?limit=200"),
  });

  function selectFolder(id: string | null): void {
    if (id === null) {
      router.push(pathname);
    } else {
      router.push(`${pathname}?folder=${encodeURIComponent(id)}`);
    }
  }

  return (
    <aside aria-label="Folders" data-testid="folders-sidebar">
      <Card>
        <CardHeader>
          <CardTitle>{t("end-user:end-user.notes-list.folders.title.label")}</CardTitle>
          <CardDescription>
            {t("end-user:end-user.notes-list.folders.readonly-body.text")}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-2">
          <ScrollArea className="h-72">
            <nav className="flex flex-col gap-1">
              {/* Read-only navigation links rendered as <a>, never as buttons that
                  could be confused with mutation actions. */}
              <a
                href={pathname}
                onClick={(e) => {
                  e.preventDefault();
                  selectFolder(null);
                }}
                className={`rounded-md px-3 py-2 text-sm ${
                  selected === null
                    ? "bg-panel-2 font-medium text-text"
                    : "text-text-muted hover:bg-panel-2 hover:text-text"
                }`}
              >
                All notes
              </a>
              {folders.isPending ? (
                <>
                  <Skeleton className="h-6 w-full" data-testid="folders-skeleton" />
                  <Skeleton className="h-6 w-full" />
                </>
              ) : folders.isError ? (
                <span className="px-3 py-2 text-sm text-text-muted">
                  {t("end-user:end-user.notes-list.error.title.text")}
                </span>
              ) : (
                (folders.data?.folders ?? []).map((f) => {
                  const active = selected === f.id;
                  return (
                    <a
                      key={f.id}
                      href={`${pathname}?folder=${encodeURIComponent(f.id)}`}
                      onClick={(e) => {
                        e.preventDefault();
                        selectFolder(f.id);
                      }}
                      className={`rounded-md px-3 py-2 text-sm ${
                        active
                          ? "bg-panel-2 font-medium text-text"
                          : "text-text-muted hover:bg-panel-2 hover:text-text"
                      }`}
                    >
                      {f.name}
                    </a>
                  );
                })
              )}
            </nav>
          </ScrollArea>
        </CardContent>
      </Card>
    </aside>
  );
}
