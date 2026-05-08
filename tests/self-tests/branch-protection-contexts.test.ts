import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as YAML from 'yaml';

// CI-03 self-test: every required status check listed in
// scripts/branch-protection.json `contexts` MUST correspond to a real top-level
// `jobs.<name>:` key in one of the workflow files under .github/workflows/.
// This catches drift between the branch-protection JSON and the workflow YAMLs
// — a class of misconfiguration where a "required" check silently never runs.

const repoRoot = process.cwd();
const protectionPath = join(repoRoot, 'scripts', 'branch-protection.json');
const workflowsDir = join(repoRoot, '.github', 'workflows');

interface Protection {
  required_status_checks: { contexts: string[] };
}

const protection = JSON.parse(readFileSync(protectionPath, 'utf8')) as Protection;
const contextNames = new Set<string>(protection.required_status_checks.contexts);

function collectJobs(): Set<string> {
  const jobs = new Set<string>();
  const files = readdirSync(workflowsDir).filter(
    (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
  );
  for (const file of files) {
    const yamlText = readFileSync(join(workflowsDir, file), 'utf8');
    const parsed = YAML.parse(yamlText) as { jobs?: Record<string, unknown> } | null;
    if (parsed?.jobs) {
      for (const jobName of Object.keys(parsed.jobs)) {
        jobs.add(jobName);
      }
    }
  }
  return jobs;
}

const allJobs = collectJobs();

describe('CI-03 self-test: branch-protection contexts match actual workflow jobs', () => {
  it('every required context corresponds to a real workflow job', () => {
    const missing: string[] = [];
    for (const ctx of contextNames) {
      if (!allJobs.has(ctx)) missing.push(ctx);
    }
    expect(
      missing,
      `contexts not found as jobs in any .github/workflows/*.yml: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('contains the constitutional minimum required contexts', () => {
    const required = [
      'lint',
      'typecheck',
      'test',
      'mutation-quick',
      'lint-english',
      'pr-checklist',
      'gitleaks',
      'trivy-fs',
      'codeql',
      'license-scan',
    ];
    const missing = required.filter((r) => !contextNames.has(r));
    expect(
      missing,
      `constitutional contexts missing from branch-protection.json: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
