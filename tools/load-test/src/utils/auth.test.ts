// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 08 / Plan 02 — Task 2 RED: Bearer rotation helpers.
//
// Better Auth rotates session tokens via the `set-auth-token` response
// header; the k6 VU state must follow rotations or every request after
// the first one will 401. Per CLAUDE.md "no mocks of internal logic" —
// these helpers operate on plain header maps so the tests need no mocks
// at all.
import { describe, expect, it } from "vitest";

import { extractBearer, updateBearer } from "./auth.js";

describe("utils/auth", () => {
  it("extractBearer reads set-auth-token case-insensitively", () => {
    expect(extractBearer({ "set-auth-token": "abc" })).toBe("abc");
    expect(extractBearer({ "Set-Auth-Token": "def" })).toBe("def");
    expect(extractBearer({ "SET-AUTH-TOKEN": "ghi" })).toBe("ghi");
  });

  it("extractBearer returns null when no rotation header is present", () => {
    expect(extractBearer({})).toBeNull();
    expect(extractBearer({ "content-type": "application/json" })).toBeNull();
  });

  it("updateBearer mutates state.token only when a new token arrives", () => {
    const state = { token: "old" };
    updateBearer(state, { headers: { "set-auth-token": "new" } });
    expect(state.token).toBe("new");
  });

  it("updateBearer is a no-op when the response carries no rotation header", () => {
    const state = { token: "old" };
    updateBearer(state, { headers: { "content-type": "application/json" } });
    expect(state.token).toBe("old");
  });
});
