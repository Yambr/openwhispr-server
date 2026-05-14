// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 07 — Zod schemas for auth forms (D-STACK-4).
//
// Mirrors Better Auth's default `emailAndPassword` constraints
// (apps/api/src/auth.ts): password >= 8 chars (Better Auth default
// minPasswordLength). Email validated with zod's `.email()` rule. Name
// bounded [1, 100] for display safety.
import { z } from "zod";

export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const signUpSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
export type SignUpInput = z.infer<typeof signUpSchema>;
