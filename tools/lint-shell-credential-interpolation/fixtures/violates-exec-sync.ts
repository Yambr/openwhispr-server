// SPDX-License-Identifier: FSL-1.1-ALv2
// Fixture for tools/lint-shell-credential-interpolation.test.ts.
// `execSync(\`...${API_KEY}...\`)` interpolates a credential-shaped binding
// into a shell-interpreted template literal. Expected: exactly one
// finding tagged "shell-credential-interpolation".
import { execSync } from "node:child_process";

const API_KEY = process.env.OPENROUTER_API_KEY ?? "";

execSync(`curl -H "Authorization: Bearer ${API_KEY}" https://example.com`);
