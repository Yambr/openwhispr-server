// SPDX-License-Identifier: Apache-2.0
// Phase 13 / Plan 01 / Task 04 — Public barrel for `@openwhispr/email`.
//
// Consumers (apps/worker, apps/api after D-04 wiring lands in Session 5)
// import from the package root:
//
//   import { createEmailSender, type EmailSender, type Logger } from "@openwhispr/email";
//
// Re-exports the full public surface: factory + type contracts. The
// implementation in `./EmailSender.ts` has no Fastify coupling — Logger is
// structural.
export {
  type CreateEmailSenderOpts,
  createEmailSender,
  type EmailSender,
  type Logger,
  type SendArgs,
  type SendResult,
} from "./EmailSender.js";
