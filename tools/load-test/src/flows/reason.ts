// Phase 08 / Plan 06 — Task 2 GREEN: reason flow.
//
// POSTs a canned prompt to /api/reason. The prompt is selected
// deterministically by `iteration % prompts.length` so every VU
// covers the prompt set evenly over a 20-minute run — Math.random()
// would skew toward the first half by the birthday problem.

import { updateBearer } from "../utils/auth.js";
import { BASE_URL } from "../utils/http.js";
import type { HttpClient } from "../utils/http-client.js";
import type { User } from "./transcribe.js";

export interface ReasonDeps {
  prompts: readonly string[];
  /** Iteration index (k6 __ITER); used to round-robin through prompts. */
  iteration: number;
  /** Model id; defaults to the canonical mid-size reasoning model. */
  model?: string;
}

const DEFAULT_MODEL = "openrouter/anthropic/claude-haiku-4.5";

export function reason(user: User, client: HttpClient, deps: ReasonDeps): void {
  const idx = deps.prompts.length === 0 ? 0 : deps.iteration % deps.prompts.length;
  const prompt = deps.prompts[idx] ?? "";
  const body = {
    model: deps.model ?? DEFAULT_MODEL,
    messages: [{ role: "user", content: prompt }],
  };
  const response = client.request("POST", `${BASE_URL}/api/reason`, body, {
    headers: {
      authorization: `Bearer ${user.token}`,
    },
    tags: { endpoint: "reason" },
  });
  updateBearer(user, response);
}
