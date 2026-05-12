/**
 * Healthcheck endpoint for docker-compose (D-DEPLOY-2).
 *
 * Returns 200 OK with body "OK" — no DB or upstream API check; the web tier
 * is stateless and same-origin behind Traefik, so liveness is sufficient.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response("OK", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
