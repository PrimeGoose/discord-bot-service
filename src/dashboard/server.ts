import { serve, type ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { HTTPException } from 'hono/http-exception'
import { NONCE, secureHeaders, type SecureHeadersVariables } from 'hono/secure-headers'
import type { RuntimeInfo } from '../commands/types.js'
import type { Store } from '../db/store.js'
import type { Logger } from '../logger.js'
import { collectDashboardData } from './data.js'
import { renderDashboard } from './views.js'

export interface DashboardDeps {
  store: Store
  now: () => number
  runtime: () => RuntimeInfo
  logger: Logger
  password?: string | undefined
}

/** Read-only admin dashboard + JSON API. Never exposes user IDs or message content. */
export function createDashboardApp(deps: DashboardDeps): Hono<{ Variables: SecureHeadersVariables }> {
  const app = new Hono<{ Variables: SecureHeadersVariables }>()

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: [NONCE],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    }),
  )

  // Health check stays public so Docker/orchestrators can probe it.
  app.get('/healthz', (c) => {
    const r = deps.runtime()
    const gateway = r.demo ? 'demo' : r.wsPingMs !== null && r.wsPingMs >= 0 ? 'connected' : 'connecting'
    return c.json({ status: 'ok', mode: r.demo ? 'demo' : 'live', gateway, uptimeMs: deps.now() - r.startedAt, version: r.version })
  })

  if (deps.password) {
    app.use('*', basicAuth({ username: 'admin', password: deps.password }))
  }

  const snapshot = () => collectDashboardData(deps.store, deps.now(), deps.runtime())

  app.get('/', (c) => c.html(renderDashboard(snapshot(), c.get('secureHeadersNonce') ?? '')))
  app.get('/api/summary', (c) => c.json(snapshot()))
  app.get('/api/guilds', (c) => c.json(deps.store.guilds.overview(deps.now())))
  app.get('/api/commands', (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query('days') ?? 7) || 7))
    return c.json(deps.store.stats.commandUsage(deps.now() - days * 86_400_000))
  })

  app.notFound((c) => c.json({ error: 'not found' }, 404))
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse()
    deps.logger.error({ err, path: c.req.path }, 'dashboard error')
    return c.json({ error: 'internal error' }, 500)
  })
  return app
}

export interface RunningDashboard {
  url: string
  close(): Promise<void>
}

export function startDashboard(deps: DashboardDeps, host: string, port: number): Promise<RunningDashboard> {
  const app = createDashboardApp(deps)
  return new Promise((resolve, reject) => {
    let server: ServerType | undefined = undefined
    server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
      const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${info.port}`
      deps.logger.info({ url }, 'dashboard listening')
      resolve({
        url,
        close: () =>
          new Promise<void>((done) => {
            if (!server) {
              done()
              return
            }
            server.close(() => {
              done()
            })
            if ('closeAllConnections' in server) server.closeAllConnections()
          }),
      })
    })
    server.on('error', reject)
  })
}
