import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

/**
 * Serve the built web app from `distDir`: its static files, and `index.html`
 * for any other path the router does not know, so client-side routes load.
 * Unknown `/api…` paths get the JSON 404 instead.
 *
 * Google Reader paths never reach this handler: unknown paths under
 * `/reader/api/0/` and `/api/greader.php/` are answered by the catch-all
 * routes in greaderRoutes / freshRssGreaderRoutes (`400 Bad Request!`).
 */
export async function registerSpaFallback(app: FastifyInstance, distDir: string): Promise<void> {
  await app.register(fastifyStatic, {
    root: distDir,
    wildcard: false,
  })

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) {
      reply.status(404).send({ error: 'Not found' })
    } else {
      reply.sendFile('index.html')
    }
  })
}
