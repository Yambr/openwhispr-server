// Phase 07.1 / Plan 13 — Selftest CLI entry for the seed fixture.
//
// Lives in its own file (not seed.ts) because Playwright's CommonJS
// transformer crashes with "exports is not defined in ES module scope"
// when seed.ts contains a top-level `import.meta` reference (see Plan 13
// deviation report). seed.ts is imported by every notes/conversations
// spec file; this entry is invoked only as a CLI:
//
//   pnpm --filter @openwhispr/web exec tsx \
//     tests/e2e/fixtures/seed-selftest.ts
//
// Exits 0 on success, 1 on any seed/clear failure.
import { request as playwrightRequest } from "@playwright/test";
import { fixtureEmail, provisionTestUser } from "./auth.js";
import {
  buildSignedInRequestContext,
  clearAllData,
  seedConversations,
  seedFolders,
  seedNotes,
  seedTranscriptions,
} from "./seed.js";

const BASE_URL = process.env.BASE_URL ?? "https://api.localhost";

// biome-ignore-all lint/suspicious/noConsole: CLI selftest entry — log output is the UX
async function selftest(): Promise<void> {
  console.log("seed-selftest: provisioning worker-0 fixture user...");
  const provisionCtx = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
  });
  await provisionTestUser(provisionCtx, 0);
  await provisionCtx.dispose();
  const email = fixtureEmail(0);
  console.log(`seed-selftest: signing in as ${email}...`);
  const ctx = await buildSignedInRequestContext(email);
  try {
    console.log("seed-selftest: clearing pre-existing data...");
    await clearAllData(ctx);
    console.log("seed-selftest: seeding folder...");
    const folders = await seedFolders(ctx, { count: 1 });
    const folder = folders[0];
    if (!folder) {
      throw new Error("seed-selftest: seedFolders returned no rows");
    }
    console.log(`  folder.id=${folder.id}`);
    console.log("seed-selftest: seeding note...");
    const notes = await seedNotes(ctx, { count: 1, folderId: folder.id });
    console.log(`  note.id=${notes[0]?.id}`);
    console.log("seed-selftest: seeding transcription...");
    const ts = await seedTranscriptions(ctx, { count: 1 });
    console.log(`  transcription.id=${ts[0]?.id}`);
    console.log("seed-selftest: seeding conversation with 2 messages...");
    const convs = await seedConversations(ctx, { count: 1, withMessages: 2 });
    console.log(`  conversation.id=${convs[0]?.id}`);
    console.log("seed-selftest: clearing all data...");
    await clearAllData(ctx);
    console.log("seed-selftest: OK");
  } finally {
    await ctx.dispose();
  }
}

selftest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("seed-selftest FAILED:", err);
    process.exit(1);
  });
