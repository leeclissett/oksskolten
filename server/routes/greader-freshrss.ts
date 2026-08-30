import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getDb } from '../db.js'
import { logger } from '../logger.js'
import { greaderRoutes } from './greader.js'

const log = logger.child('greader-freshrss')
const FRESHRSS_GREADER_PREFIX = '/api/greader.php'

function extractGReaderToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization ?? ''
  const match = auth.match(/^GoogleLogin\s+auth=(.+)$/i)
  return match ? match[1] : null
}

async function verifyFreshRssAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  app: FastifyInstance,
): Promise<string | null> {
  const token = extractGReaderToken(request)
  if (!token) {
    reply.status(401).send('Error=NeedsBrowser\n')
    return null
  }

  try {
    const payload = app.jwt.verify<{ email: string; token_version: number }>(token)
    const user = getDb()
      .prepare('SELECT token_version FROM users WHERE email = ?')
      .get(payload.email) as { token_version: number } | undefined

    if (!user || user.token_version !== payload.token_version) {
      log.warn('FreshRSS GReader token rejected (version mismatch) for', payload.email)
      reply.status(401).send('Error=TokenExpired\n')
      return null
    }

    return payload.email
  } catch {
    reply.status(401).send('Error=TokenExpired\n')
    return null
  }
}

/**
 * FreshRSS clients expect the full API base URL to end in `/api/greader.php`
 * and append the normal Google Reader paths to it. Register the existing
 * GReader implementation under that prefix while preserving the root routes.
 */
export async function freshRssGreaderRoutes(app: FastifyInstance): Promise<void> {
  // greaderRoutes' own auth hook matches root `/reader/api/*` paths. Because
  // Fastify keeps the plugin prefix in request.url, protect the prefixed reader
  // routes here before delegating to the existing handlers.
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith(`${FRESHRSS_GREADER_PREFIX}/reader/api/`)) return

    const email = await verifyFreshRssAuth(request, reply, app)
    if (!email) return
    request.greaderEmail = email
  })

  await app.register(greaderRoutes, { prefix: FRESHRSS_GREADER_PREFIX })
}
