// Phase 07.1 / Plan 13 — Bundle budget gate (D-PERF-1).
//
// Enforces ≤ 200 KB gzipped per route on the Next.js First Load JS. The
// First Load includes the route page chunk + every shared chunk listed for
// the route in `.next/app-build-manifest.json`. Hardcoding chunk filenames
// would brittle across builds (each carries a content hash); instead we
// read the manifest at config-load time and emit one size-limit entry per
// user-facing route with the exact chunk paths Next.js declares.
//
// Run after `pnpm --filter @openwhispr/web build`:
//   pnpm --filter @openwhispr/web exec size-limit
//
// Gate: CI fails if any route exceeds its 200 KB limit (D-PERF-1).
const fs = require("node:fs");
const path = require("node:path");

const MANIFEST = path.resolve(__dirname, ".next/app-build-manifest.json");
const PER_ROUTE_LIMIT = "200 kB";

// Manifest key → human route label (used in size-limit output).
const ROUTES = {
  "/(public)/sign-in/page": "/sign-in",
  "/(public)/sign-up/page": "/sign-up",
  "/(public)/verify-email/page": "/verify-email",
  "/(auth)/app/page": "/app",
  "/(auth)/app/account/page": "/app/account",
  "/(auth)/app/notes/page": "/app/notes",
  "/(auth)/app/notes/[id]/page": "/app/notes/[id]",
  "/(auth)/app/notes/search/page": "/app/notes/search",
  "/(auth)/app/transcriptions/page": "/app/transcriptions",
  "/(auth)/app/transcriptions/[id]/page": "/app/transcriptions/[id]",
  "/(auth)/app/conversations/page": "/app/conversations",
  "/(auth)/app/conversations/[id]/page": "/app/conversations/[id]",
  "/(auth)/app/conversations/search/page": "/app/conversations/search",
  "/(admin)/admin/observability/page": "/admin/observability",
  "/(admin)/admin/config/page": "/admin/config",
};

if (!fs.existsSync(MANIFEST)) {
  throw new Error(
    `size-limit: ${MANIFEST} not found — run \`pnpm --filter @openwhispr/web build\` first.`,
  );
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

const entries = [];
for (const [manifestKey, label] of Object.entries(ROUTES)) {
  const chunks = manifest.pages[manifestKey];
  if (!chunks || chunks.length === 0) {
    throw new Error(`size-limit: route ${manifestKey} missing from manifest`);
  }
  // Each chunk path in the manifest is relative to .next/. size-limit needs
  // file paths relative to the package root (.next/static/chunks/...).
  const paths = chunks.filter((c) => c.endsWith(".js")).map((c) => path.posix.join(".next", c));
  entries.push({
    name: label,
    path: paths,
    limit: PER_ROUTE_LIMIT,
    gzip: true,
  });
}

module.exports = entries;
