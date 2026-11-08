import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import rateLimit, { type RateLimitPluginOptions } from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import { registerApi } from '../../api.js'
import { authRoutes } from '../../authRoutes.js'
import { greaderRoutes } from '../../routes/greader.js'

/** `rateLimit` replaces the default global rate-limit options (e.g. to mirror server/index.ts). */
export async function buildApp(options: { rateLimit?: RateLimitPluginOptions } = {}) {
  const app = Fastify()
  await app.register(jwt, { secret: 'test-secret', sign: { expiresIn: '30d' } })
  await app.register(rateLimit, options.rateLimit ?? { max: 100, timeWindow: '1 minute' })
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } })
  await app.register(authRoutes)
  await app.register(greaderRoutes)
  registerApi(app)
  return app
}
