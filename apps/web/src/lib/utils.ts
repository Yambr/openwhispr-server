// SPDX-License-Identifier: FSL-1.1-ALv2
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind utility classes with conflict resolution.
 *
 * Canonical shadcn/ui v2 helper — every primitive under
 * `apps/web/src/components/ui/*` imports `cn` from `@/lib/utils`. Do not
 * rename or relocate without updating `components.json` aliases.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
