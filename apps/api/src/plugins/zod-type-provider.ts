// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 03 / Task 1 — wires the Fastify zod type provider.
//
// `@fastify/type-provider-zod` ships two compilers (validator + serializer)
// that turn zod schemas into Fastify route schemas. Routes attached after
// this plugin can declare `schema: { body: SomeZodSchema, ... }` and get
// runtime validation + typed `req.body` for free.
//
// This file is a tiny `fastify-plugin` wrapper so other Plan 03 modules
// (and Plan 04's buildApp) can simply `await app.register(zodTypeProvider)`.
// Plan 04 owns the actual `withTypeProvider<ZodTypeProvider>()` cast at
// the buildApp boundary because it owns `index.ts`.

import { serializerCompiler, validatorCompiler } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export type { ZodTypeProvider } from "@fastify/type-provider-zod";

async function zodTypeProviderInner(app: FastifyInstance): Promise<void> {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
}

export const zodTypeProvider = fp(zodTypeProviderInner, {
  name: "zod-type-provider",
  fastify: "5.x",
});
