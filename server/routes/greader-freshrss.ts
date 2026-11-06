import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { routedPath } from '../lib/routed-path.js'
import { badRequest, greaderRoutes, sendOk, verifyGReaderAuth } from './greader.js'

const FRESHRSS_GREADER_PREFIX = '/api/greader.php'

/**
 * FreshRSS clients expect the full API base URL to end in `/api/greader.php`
 * and append the normal Google Reader paths to it. Register the existing
 * GReader implementation under that prefix while preserving the root routes.
 */
export async function freshRssGreaderRoutes(app: FastifyInstance): Promise<void> {
  // greaderRoutes' own auth hook matches root `/reader/api/*` routes. Because
  // the routed path includes the plugin prefix, protect the prefixed reader
  // routes here before delegating to the existing handlers. Match on the
  // routed path, not request.url, which is still percent-encoded.
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!routedPath(request).startsWith(`${FRESHRSS_GREADER_PREFIX}/reader/api/`)) return

    const email = await verifyGReaderAuth(request, reply, app)
    if (!email) return
    request.greaderEmail = email
  })

  await app.register(greaderRoutes, { prefix: FRESHRSS_GREADER_PREFIX })

  // greader.php itself with no path and no query string answers `OK`; with a
  // query string it has fewer than three path segments, so `400`.
  app.all(FRESHRSS_GREADER_PREFIX, async (request, reply) => {
    return request.url.includes('?') ? badRequest(reply) : sendOk(reply)
  })

  // Any other path under the prefix that no route serves (including
  // `/api/greader.php/` itself) is greader.php's fall-through
  // `400 Bad Request!`, never the web app's JSON 404. Unknown paths under
  // `/api/greader.php/reader/api/0/` are caught by greaderRoutes' own
  // catch-all behind the auth hook (401 without a valid token); this one is
  // outside /reader/api/ and answers 400 whatever the credentials.
  app.all(`${FRESHRSS_GREADER_PREFIX}/*`, async (_request, reply) => badRequest(reply))
}
