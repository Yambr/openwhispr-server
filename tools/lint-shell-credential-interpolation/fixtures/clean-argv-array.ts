// SPDX-License-Identifier: FSL-1.1-ALv2
// Fixture (NOT shipped to runtime) — LOCKER-06 safe-pattern affirmation:
// argv-array form with NO `bash -c` and NO template literal. This is the
// canonical safe shape (Phase 36.a target). MUST NOT be flagged.
//
// biome-ignore lint: fixture file, intentional dead code
import { spawn } from "node:child_process";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
spawn("pg_dump", ["--dbname", DATABASE_URL], { shell: false });
