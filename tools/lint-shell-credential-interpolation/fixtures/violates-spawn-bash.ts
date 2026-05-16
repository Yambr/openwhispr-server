// Fixture for tools/lint-shell-credential-interpolation.test.ts.
// `spawn('bash', ['-c', `...${DATABASE_URL}...`])` interpolates a
// credential-shaped binding into the shell argv. Linter must flag this
// with label "shell-credential-interpolation" and a remediation hint that
// mentions the safe `argv-array` form.
import { spawn } from "node:child_process";

const DATABASE_URL = process.env.DATABASE_URL ?? "";

spawn("bash", ["-c", `pg_dump "${DATABASE_URL}" > /tmp/dump.sql`]);
