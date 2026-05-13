#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 13 — perf measurement (D-PERF-2, informational only).
//
// Boots a Playwright Chromium browser, navigates each declared route against
// the docker-compose stack (BASE_URL=https://api.localhost by default), and
// samples LCP via PerformanceObserver. INP is approximated by triggering a
// synthetic click + reading the resulting `event` PerformanceEntry.
//
// Output: appends a markdown table to apps/web/perf-budgets.md under
// "## Last measurement". Exits 0 regardless of whether thresholds are met —
// D-PERF-2 is an informational floor, not a CI gate.
//
// Run with:
//   pnpm --filter @openwhispr/web exec tsx tests/perf/measure.mjs
//
// Requires the docker compose stack to be up + healthy on https://api.localhost.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUDGETS = path.resolve(__dirname, "../../perf-budgets.md");
const BASE_URL = process.env.BASE_URL ?? "https://api.localhost";

const ROUTES = [
  "/sign-in",
  "/app",
  "/app/notes",
  "/app/transcriptions",
  "/app/conversations",
  "/app/account",
];

async function measure(page, route) {
  const url = `${BASE_URL}${route}`;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "networkidle" });
  // Let layout settle so the LCP entry actually fires.
  await page.waitForTimeout(3_000);

  const sample = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
    const lcp = lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1].startTime : null;
    const ttfb = nav ? nav.responseStart : null;
    return { lcp, ttfb };
  });

  // Approximate INP via a synthetic click + event timing.
  let inp = null;
  try {
    inp = await page.evaluate(async () => {
      return await new Promise((resolve) => {
        const obs = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length > 0) {
            resolve(entries[entries.length - 1].duration);
          }
        });
        obs.observe({ type: "event", buffered: true });
        document.body.click();
        setTimeout(() => resolve(null), 1_500);
      });
    });
  } catch {
    inp = null;
  }

  const wall = Date.now() - t0;
  return { route, ttfb: sample.ttfb, lcp: sample.lcp, inp, wall };
}

function fmt(ms) {
  if (ms === null || ms === undefined) return "n/a";
  return `${Math.round(ms)} ms`;
}

async function main() {
  console.log(`perf-measure: BASE_URL=${BASE_URL}`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const results = [];
  for (const route of ROUTES) {
    console.log(`perf-measure: ${route}`);
    try {
      const r = await measure(page, route);
      results.push(r);
    } catch (err) {
      console.error(`perf-measure: ${route} failed:`, err.message);
      results.push({ route, ttfb: null, lcp: null, inp: null, wall: null });
    }
  }
  await browser.close();

  const rows = results.map(
    (r) => `| \`${r.route}\` | ${fmt(r.ttfb)} | ${fmt(r.lcp)} | ${fmt(r.inp)} |`,
  );
  const table = [
    "| Route | TTFB | LCP | INP (approx) |",
    "| ----- | ---- | --- | ------------ |",
    ...rows,
  ].join("\n");

  const stamp = new Date().toISOString();
  const block = `## Last measurement\n\nMeasured ${stamp} against ${BASE_URL}.\n\n${table}\n`;

  const current = readFileSync(BUDGETS, "utf8");
  const replaced = current.replace(/## Last measurement[\s\S]*$/m, block);
  writeFileSync(BUDGETS, replaced, "utf8");
  console.log(`perf-measure: wrote results to ${BUDGETS}`);
}

main().catch((err) => {
  console.error("perf-measure FAILED:", err);
  // D-PERF-2: informational only; never block the workflow.
  process.exit(0);
});
