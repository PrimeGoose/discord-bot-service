import { existsSync } from 'node:fs'
import type { Client } from 'discord.js'
import { attachHandlers, createDiscordClient, discordDelivery } from './bot/client.js'
import { Scheduler, type Delivery } from './bot/scheduler.js'
import { Dispatcher } from './commands/dispatcher.js'
import { commands, componentHandlers } from './commands/index.js'
import type { RuntimeInfo, Services } from './commands/types.js'
import { ConfigError, loadConfig } from './config.js'
import { startDashboard, type RunningDashboard } from './dashboard/server.js'
import { createStore } from './db/store.js'
import { seedDemoData } from './demo/seed.js'
import { DemoSimulator, demoDelivery } from './demo/simulator.js'
import { createShutdown, installSignalHandlers } from './lib/shutdown.js'
import { createLogger } from './logger.js'
import { VERSION } from './version.js'

const RETENTION_DAYS = 90

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env')
  const config = loadConfig(process.env, process.argv.includes('--demo') ? { demoMode: true } : {})
  const logger = createLogger(config.log)
  const startedAt = Date.now()
  const now = () => Date.now()

  // Demo mode always uses a fresh in-memory database so seeded data is "recent" on every start.
  const dbPath = config.demoMode ? ':memory:' : config.databasePath
  const store = createStore(dbPath)
  logger.info({ mode: config.demoMode ? 'demo' : 'live', database: dbPath, version: VERSION }, 'starting Server Toolkit')

  let client: Client | null = null
  const runtime = (): RuntimeInfo => ({
    demo: config.demoMode,
    startedAt,
    wsPingMs: client ? client.ws.ping : null,
    guildCount: client ? client.guilds.cache.size : store.guilds.overview(now()).length,
    version: VERSION,
  })
  const services: Services = { store, logger, now, runtime }
  const dispatcher = new Dispatcher(commands, componentHandlers)

  let delivery: Delivery
  let simulator: DemoSimulator | null = null
  if (config.demoMode) {
    const summary = seedDemoData(store, now())
    logger.info(summary, 'demo data seeded (no Discord connection will be made)')
    delivery = demoDelivery(services)
    simulator = new DemoSimulator(services, dispatcher).start()
  } else {
    client = createDiscordClient()
    attachHandlers(client, services, dispatcher)
    delivery = discordDelivery(client, services)
  }

  const scheduler = new Scheduler(store, delivery, logger, now, {
    intervalMs: config.schedulerIntervalMs,
    retentionDays: RETENTION_DAYS,
  })

  let dashboard: RunningDashboard | null = null
  const shutdown = createShutdown(logger, [
    { name: 'simulator', run: () => simulator?.stop() },
    { name: 'scheduler', run: () => scheduler.stop() },
    { name: 'dashboard', run: () => dashboard?.close() },
    { name: 'discord', run: () => client?.destroy() },
    {
      name: 'database',
      run: () => {
        store.close()
      },
    },
  ])
  installSignalHandlers(shutdown, logger)

  if (config.dashboard.enabled) {
    dashboard = await startDashboard({ ...services, password: config.dashboard.password }, config.dashboard.host, config.dashboard.port)
  }
  if (client && config.discord.token) {
    await client.login(config.discord.token)
  }
  scheduler.start()
  if (config.demoMode && dashboard) logger.info(`demo ready → open ${dashboard.url}  (Ctrl+C to stop)`)
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(`\n✖ ${err.message}\n`)
  } else {
    console.error('fatal startup error', err)
  }
  process.exit(1)
})
