import type { FastifyInstance } from 'fastify'
import { requireAuth, requireWriteScope } from '../auth.js'
import { feedRoutes } from './feeds.js'
import { articleRoutes } from './articles.js'
import { categoryRoutes } from './categories.js'
import { settingsRoutes } from './settings.js'
import { adminRoutes } from './admin.js'
import { apiKeyRoutes } from './apiKeys.js'
import { statsRoutes } from './stats.js'
import { freshRssGreaderRoutes } from './greader-freshrss.js'

export function registerApi(app: FastifyInstance): void {
  // FreshRSS clients use a full API base ending in /api/greader.php. Register
  // that compatibility path outside the normal /api auth middleware because
  // the Google Reader API performs its own ClientLogin/JWT authentication.
  app.register(freshRssGreaderRoutes)

  app.register(async function apiRoutes(api) {
    api.addHook('preHandler', requireAuth)
    api.addHook('preHandler', requireWriteScope)

    await api.register(feedRoutes)
    await api.register(articleRoutes)
    await api.register(categoryRoutes)
    await api.register(settingsRoutes)
    await api.register(adminRoutes)
    await api.register(apiKeyRoutes)
    await api.register(statsRoutes)
  })
}
