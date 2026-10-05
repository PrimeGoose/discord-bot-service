import type { Logger } from '../logger.js'

export interface ShutdownTask {
  name: string
  run: () => void | Promise<void>
}

/**
 * Builds an idempotent shutdown routine: tasks run in order (stop accepting work
 * first, close storage last), each failure is logged without blocking the rest,
 * and a hard timeout guarantees the process never hangs on exit.
 */
export function createShutdown(
  logger: Logger,
  tasks: ShutdownTask[],
  opts: { timeoutMs?: number; exit?: (code: number) => void } = {},
): (reason: string) => Promise<void> {
  const exit = opts.exit ?? ((code: number) => process.exit(code))
  const timeoutMs = opts.timeoutMs ?? 10_000
  let inFlight: Promise<void> | null = null

  return (reason: string) => {
    if (inFlight) return inFlight
    inFlight = (async () => {
      logger.info({ reason }, 'shutting down')
      const timer = setTimeout(() => {
        logger.error({ timeoutMs }, 'shutdown timed out, forcing exit')
        exit(1)
      }, timeoutMs)
      timer.unref()
      let failed = false
      for (const task of tasks) {
        try {
          await task.run()
          logger.debug({ task: task.name }, 'shutdown step complete')
        } catch (err) {
          failed = true
          logger.error({ err, task: task.name }, 'shutdown step failed')
        }
      }
      clearTimeout(timer)
      logger.info('bye 👋')
      exit(failed ? 1 : 0)
    })()
    return inFlight
  }
}

export function installSignalHandlers(shutdown: (reason: string) => Promise<void>, logger: Logger): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void shutdown(signal))
  }
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection')
  })
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception')
    void shutdown('uncaughtException')
  })
}
