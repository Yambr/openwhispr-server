// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 08 / Plan 03 / Task 2 — process entry point for the
// mock-litellm Docker image. Excluded from coverage (see
// vitest.config.ts) because there is no meaningful way to test the
// `process.argv[1]` guard without spawning a subprocess; the smoke
// probe in Task 3 (the docker build + curl /health/liveliness) is the
// integration assertion that matters.
//
// Env overrides supported (all numeric, units = ms):
//   PORT, HOST,
//   TRANSCRIBE_MEAN_MS, TRANSCRIBE_SD_MS,
//   CHAT_MEAN_MS, CHAT_SD_MS,
//   STREAM_FIRST_TOKEN_MS, STREAM_FIRST_TOKEN_SD_MS.

import { startServer } from "./server.js";

function envNum(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

const cfg = {
  port: envNum("PORT") ?? 4000,
  host: process.env.HOST ?? "0.0.0.0",
  transcribeMeanMs: envNum("TRANSCRIBE_MEAN_MS"),
  transcribeSdMs: envNum("TRANSCRIBE_SD_MS"),
  chatMeanMs: envNum("CHAT_MEAN_MS"),
  chatSdMs: envNum("CHAT_SD_MS"),
  streamFirstTokenMs: envNum("STREAM_FIRST_TOKEN_MS"),
  streamFirstTokenSdMs: envNum("STREAM_FIRST_TOKEN_SD_MS"),
};

// Filter undefined keys so they fall through to DEFAULT_CONFIG.
const filtered = Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined));

startServer(filtered).then((app) => {
  // eslint-disable-next-line no-console
  console.log(
    `[mock-litellm] listening on ${app.server.address() instanceof Object ? JSON.stringify(app.server.address()) : app.server.address()}`,
  );
});
