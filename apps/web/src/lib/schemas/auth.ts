// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 07 — Zod schemas for auth forms (D-STACK-4).
//
// Mirrors Better Auth's default `emailAndPassword` constraints
// (apps/api/src/auth.ts): password >= 8 chars (Better Auth default
// minPasswordLength). Email validated with zod's `.email()` rule. Name
// bounded [1, 100] for display safety.
import { z } from "zod";

// Phase 18.1.1 / Plan 04 / D-21 — RHF field for "Remember this device"
// checkbox. Better Auth signIn.email accepts `rememberMe` as a pass-through.
export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  rememberDevice: z.boolean().default(false),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const signUpSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
export type SignUpInput = z.infer<typeof signUpSchema>;
