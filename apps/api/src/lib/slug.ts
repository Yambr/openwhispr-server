// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Slugs for tenant-scoped named things (workspaces, teams, spaces).
 *
 * The desktop uses a slug as a stable key, never as a URL, so readability
 * matters more than fidelity: a name written entirely outside the ASCII range
 * yields no slug-able characters at all, and an empty slug is a broken key
 * rather than a missing one.
 */

/** Lowercase, hyphenated, ASCII-safe. Falls back rather than returning "". */
export function slugify(name: string, fallback = "workspace"): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : fallback;
}

/**
 * Make a slug unique within a tenant by appending a counter.
 *
 * `taken` is the set of slugs already present. Deliberately a pure function
 * over a caller-supplied set rather than a query loop: the caller already has
 * to read inside its own transaction, and a retry loop against a live table is
 * where uniqueness bugs hide.
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
