// SPDX-License-Identifier: FSL-1.1-ALv2
// Fixture (NOT shipped to runtime) — LOCKER-06 violation:
// execSync(`...${API_KEY}...`)
// The linter MUST flag the template-literal interpolating API_KEY.
//
// biome-ignore lint: fixture file, intentional dead code
import { execSync } from "node:child_process";

const API_KEY = process.env.API_KEY ?? "";
execSync(`curl -H "Authorization: Bearer ${API_KEY}" https://upstream`);
