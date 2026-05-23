// SPDX-License-Identifier: FSL-1.1-ALv2
// Fixture for tools/lint-shell-credential-interpolation.test.ts.
// Safe pattern (Phase 36.a closure): the credential is passed as a
// SEPARATE argv element with `shell: false`, NOT interpolated into a
// `-c` shell command. No finding expected.
import { spawn } from "node:child_process";

const DATABASE_URL = process.env.DATABASE_URL ?? "";

spawn("pg_dump", ["--dbname", DATABASE_URL, "--file=/tmp/dump.sql"], {
  shell: false,
});
