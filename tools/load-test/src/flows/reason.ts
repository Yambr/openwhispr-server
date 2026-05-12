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
}

export function reason(user: User, client: HttpClient, deps: ReasonDeps): void {
  const idx = deps.prompts.length === 0 ? 0 : deps.iteration % deps.prompts.length;
  const prompt = deps.prompts[idx] ?? "";
  // Plan 08.1-01 Task 2 root-cause fix: the api's ReasonRequest Zod schema
  // (packages/contract-tests/src/schemas.ts:85) is `.strict()` with
  //   { text: string.min(1), model?, provider?, promptMode?, matchType? }
  // — so {model, messages: [{role,content}]} (the old k6 envelope) was
  // rejected with a 400 on every iteration. The model is server-defaulted;
  // we forward only `text`. JSON body REQUIRES `content-type: application/json`
  // because k6's http.request defaults to form-urlencoded when the body is
  // a plain object — without the explicit header Fastify's JSON body
  // parser does not fire and `req.body` stays empty.
  const body = JSON.stringify({ text: prompt });
  const response = client.request("POST", `${BASE_URL}/api/reason`, body, {
    headers: {
      authorization: `Bearer ${user.token}`,
      "content-type": "application/json",
    },
    tags: { endpoint: "reason" },
  });
  updateBearer(user, response);
}
