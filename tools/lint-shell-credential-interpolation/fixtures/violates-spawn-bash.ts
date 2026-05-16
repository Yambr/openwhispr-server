// SPDX-License-Identifier: FSL-1.1-ALv2
// Fixture (NOT shipped to runtime) — LOCKER-06 violation:
// spawn('bash', ['-c', `...${CREDENTIAL_URL}...`])
// The linter MUST flag the template-literal line interpolating DATABASE_URL.
//
// biome-ignore lint: fixture file, intentional dead code
import { spawn } from "node:child_process";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
spawn("bash", ["-c", `pg_dump "${DATABASE_URL}" | gzip`]);
