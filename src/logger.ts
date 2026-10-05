import { createRequire } from 'node:module'
import { pino, type Logger, type LoggerOptions } from 'pino'

export type { Logger }

function prettyAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty')
    return true
  } catch {
    return false
  }
}

/**
 * Structured JSON logging via pino. `pretty` is a dev convenience and falls back
 * to JSON when pino-pretty isn't installed (e.g. production images built with
 * `npm ci --omit=dev`).
 */
export function createLogger(opts: { level?: string; format?: 'pretty' | 'json' } = {}): Logger {
  const options: LoggerOptions = {
    level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
    base: { service: 'server-toolkit' },
    redact: { paths: ['token', '*.token', 'config.discord.token', 'headers.authorization'], censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  }
  if (opts.format === 'pretty' && prettyAvailable()) {
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, singleLine: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
    }
  }
  return pino(options)
}
