// SPDX-License-Identifier: FSL-1.1-ALv2
// tests/integration/backup-restore.test.ts
//
// DATA-07 integration test: end-to-end exercise of scripts/backup/make-backup.sh
// and scripts/backup/make-restore.sh against a real Postgres testcontainer.
//
// Coverage:
//   1. backup writes an .age file of non-zero size
//   2. restore against a fresh empty Postgres reproduces the seed rows
//   3. restore refuses (non-zero exit) when the target already has tables
//   4. backup fails clearly when the public recipient file is missing
//
// The whole suite is SKIPPED when `age` / `age-keygen` are not on PATH,
// emitting a diagnostic so operators install the binary before relying
// on `make backup` locally. CI installs `age` via `apt install age`
// (.github/workflows/nightly.yml), so this skip never fires there.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const BACKUP_SCRIPT = join(REPO_ROOT, "scripts", "backup", "make-backup.sh");
const RESTORE_SCRIPT = join(REPO_ROOT, "scripts", "backup", "make-restore.sh");

function ageOnPath(): boolean {
  const a = spawnSync("age", ["--version"], { stdio: "ignore" });
  const k = spawnSync("age-keygen", ["--version"], { stdio: "ignore" });
  return a.status !== null && k.status !== null && a.status === 0 && k.status === 0;
}

function pgClientToolsOnPath(): boolean {
  const d = spawnSync("pg_dump", ["--version"], { stdio: "ignore" });
  const r = spawnSync("pg_restore", ["--version"], { stdio: "ignore" });
  const p = spawnSync("psql", ["--version"], { stdio: "ignore" });
  return [d, r, p].every((x) => x.status === 0);
}

const AGE_AVAILABLE = ageOnPath();
const PG_TOOLS_AVAILABLE = pgClientToolsOnPath();
const SHOULD_SKIP = !AGE_AVAILABLE || !PG_TOOLS_AVAILABLE;

if (SHOULD_SKIP) {
  // biome-ignore lint/suspicious/noConsole: integration-test diagnostic
  console.warn(
    `[backup-restore.test.ts] Skipping suite — missing tooling. age=${AGE_AVAILABLE} pg-tools=${PG_TOOLS_AVAILABLE}. Install with: brew install age postgresql@17 (macOS) or apt install age postgresql-client-17 (debian/ubuntu).`,
  );
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runScript(
  script: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
  args: string[] = [],
): RunResult {
  const r = spawnSync("bash", [script, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function generateAgeKeypair(dir: string): {
  identity: string;
  recipient: string;
  identityFile: string;
  recipientFile: string;
} {
  const identityFile = join(dir, "key.txt");
  // age-keygen writes the identity to stdout (and a "# public key:" comment
  // to stderr on `-o`). We capture stdout, parse out the AGE-SECRET-KEY-1
  // line, and derive the recipient via `age-keygen -y` for stability.
  const gen = spawnSync("age-keygen", [], { encoding: "utf8" });
  if (gen.status !== 0) throw new Error(`age-keygen failed: ${gen.stderr}`);
  // The default output is multi-line: a "# created:" comment, a
  // "# public key: ..." comment, then the identity line.
  const identityLine = gen.stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("AGE-SECRET-KEY-1"));
  if (!identityLine) throw new Error("age-keygen did not emit an AGE-SECRET-KEY-1 line");
  writeFileSync(identityFile, `${identityLine}\n`, { mode: 0o600 });

  const recipientResult = spawnSync("age-keygen", ["-y", identityFile], { encoding: "utf8" });
  if (recipientResult.status !== 0)
    throw new Error(`age-keygen -y failed: ${recipientResult.stderr}`);
  const recipient = recipientResult.stdout.trim();
  if (!recipient.startsWith("age1")) throw new Error(`unexpected recipient format: ${recipient}`);

  const recipientFile = join(dir, "backup.age.pub");
  writeFileSync(recipientFile, `${recipient}\n`);

  return { identity: identityLine, recipient, identityFile, recipientFile };
}

const SEED_SQL = `
  CREATE TABLE tenants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  INSERT INTO tenants (id, name) VALUES
    ('00000000-0000-0000-0000-000000000000', 'default'),
    ('11111111-1111-1111-1111-111111111111', 'acme-corp');
  CREATE TABLE notes (
    id serial PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    body text NOT NULL
  );
  INSERT INTO notes (tenant_id, body) VALUES
    ('00000000-0000-0000-0000-000000000000', 'hello from default'),
    ('11111111-1111-1111-1111-111111111111', 'acme private data');
`;

describe.skipIf(SHOULD_SKIP)("DATA-07: backup/restore round-trip", () => {
  let pgSource: StartedPostgreSqlContainer;
  let sourceUrl: string;
  let workdir: string;
  let identityFile: string;
  let backupsDir: string;
  let producedBackup = "";

  beforeAll(async () => {
    workdir = mkdtempSync(join(tmpdir(), "backup-restore-"));

    // Layout the workdir like a tiny repo so make-backup.sh can find
    // keys/backup.age.pub via "${PWD}/keys/backup.age.pub".
    mkdirSync(join(workdir, "keys"), { recursive: true });
    backupsDir = join(workdir, "backups");
    mkdirSync(backupsDir, { recursive: true });

    const keypair = generateAgeKeypair(join(workdir, "keys"));
    identityFile = keypair.identityFile;

    // Source Postgres: schema + seed data we'll back up.
    pgSource = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("source")
      .withUsername("postgres")
      .withPassword("test")
      .start();
    sourceUrl = pgSource.getConnectionUri();

    // pgcrypto for gen_random_uuid().
    const c = new Client({ connectionString: sourceUrl });
    await c.connect();
    try {
      await c.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
      await c.query(SEED_SQL);
    } finally {
      await c.end();
    }
  }, 120_000);

  afterAll(async () => {
    if (pgSource) await pgSource.stop();
    if (workdir && existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
  }, 60_000);

  it("Test 1: make-backup.sh produces a non-empty .age file in backups/", () => {
    const r = runScript(BACKUP_SCRIPT, { DATABASE_URL_OWNER: sourceUrl }, workdir);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const entries = readdirSync(backupsDir).filter((f) => f.endsWith(".dump.age"));
    expect(entries.length).toBeGreaterThan(0);
    const path = join(backupsDir, entries[0]);
    expect(statSync(path).size).toBeGreaterThan(0);
    producedBackup = path;
  }, 60_000);

  it("Test 2: make-restore.sh restores schema and data into a fresh Postgres", async () => {
    const pgTarget = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("target")
      .withUsername("postgres")
      .withPassword("test")
      .start();
    try {
      const targetUrl = pgTarget.getConnectionUri();

      const r = runScript(
        RESTORE_SCRIPT,
        {
          DATABASE_URL_OWNER: targetUrl,
          BACKUP: producedBackup,
          BACKUP_AGE_IDENTITY_FILE: identityFile,
        },
        workdir,
      );
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);

      const c = new Client({ connectionString: targetUrl });
      await c.connect();
      try {
        const tenants = await c.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM tenants",
        );
        expect(tenants.rows[0]?.count).toBe("2");
        const notes = await c.query<{ body: string }>("SELECT body FROM notes ORDER BY id ASC");
        expect(notes.rows.map((r) => r.body)).toEqual(["hello from default", "acme private data"]);
      } finally {
        await c.end();
      }
    } finally {
      await pgTarget.stop();
    }
  }, 180_000);

  it("Test 3: make-restore.sh refuses when the target already has tables", async () => {
    const pgTarget = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("nonempty")
      .withUsername("postgres")
      .withPassword("test")
      .start();
    try {
      const targetUrl = pgTarget.getConnectionUri();
      const c = new Client({ connectionString: targetUrl });
      await c.connect();
      try {
        await c.query("CREATE TABLE preexisting (id int)");
      } finally {
        await c.end();
      }

      const r = runScript(
        RESTORE_SCRIPT,
        {
          DATABASE_URL_OWNER: targetUrl,
          BACKUP: producedBackup,
          BACKUP_AGE_IDENTITY_FILE: identityFile,
        },
        workdir,
      );
      expect(r.code).not.toBe(0);
      expect(r.stderr).toMatch(/refusing/i);
    } finally {
      await pgTarget.stop();
    }
  }, 180_000);

  it("Test 4: make-backup.sh fails clearly when keys/backup.age.pub is missing", () => {
    const isolated = mkdtempSync(join(tmpdir(), "no-pubkey-"));
    try {
      mkdirSync(join(isolated, "backups"), { recursive: true });
      // Intentionally do NOT create keys/backup.age.pub.
      const r = runScript(BACKUP_SCRIPT, { DATABASE_URL_OWNER: sourceUrl }, isolated);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toMatch(/backup\.age\.pub/);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  }, 30_000);

  it("Test 5: make-restore.sh fails clearly when BACKUP_AGE_IDENTITY_FILE is missing", () => {
    const r = runScript(
      RESTORE_SCRIPT,
      {
        DATABASE_URL_OWNER: sourceUrl,
        BACKUP: producedBackup,
        BACKUP_AGE_IDENTITY_FILE: "/nonexistent/path/key.txt",
      },
      workdir,
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/identity/i);
  }, 30_000);
});
