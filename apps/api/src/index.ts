// Phase 0 Fastify placeholder. Provides GET /api/health for `make dev` smoke
// and as the Phase 2 starting point for real route wiring.
import Fastify from 'fastify';

export const buildApp = () => {
  const app = Fastify({ logger: false });
  app.get('/api/health', async () => ({ status: 'phase-0-placeholder' }));
  return app;
};

/* v8 ignore start -- entry-point bootstrap; exercised in dev/prod, not in unit tests */
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3000);
  app.listen({ port, host: '0.0.0.0' }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
/* v8 ignore stop */
