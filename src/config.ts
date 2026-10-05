import { z } from 'zod'

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())))

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))

const envSchema = z.object({
  DEMO_MODE: bool(false),
  DISCORD_TOKEN: optionalString,
  DISCORD_CLIENT_ID: optionalString,
  DISCORD_DEV_GUILD_ID: optionalString,
  DATABASE_PATH: z.string().default('./data/toolkit.db'),
  DASHBOARD_ENABLED: bool(true),
  DASHBOARD_HOST: z.string().default('127.0.0.1'),
  DASHBOARD_PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DASHBOARD_PASSWORD: optionalString,
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
})

export interface AppConfig {
  demoMode: boolean
  discord: { token: string | undefined; clientId: string | undefined; devGuildId: string | undefined }
  databasePath: string
  dashboard: { enabled: boolean; host: string; port: number; password: string | undefined }
  schedulerIntervalMs: number
  log: { level: z.infer<typeof envSchema>['LOG_LEVEL']; format: 'pretty' | 'json' }
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

/**
 * Parse and validate configuration from environment variables.
 * In live mode the official bot token and application id are mandatory;
 * in demo mode nothing Discord-related is needed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: { demoMode?: boolean } = {}): AppConfig {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new ConfigError(`Invalid environment configuration:\n${issues}`)
  }
  const e = parsed.data
  const demoMode = overrides.demoMode ?? e.DEMO_MODE

  if (!demoMode) {
    const missing = [
      e.DISCORD_TOKEN ? null : 'DISCORD_TOKEN',
      e.DISCORD_CLIENT_ID ? null : 'DISCORD_CLIENT_ID',
    ].filter((v): v is string => v !== null)
    if (missing.length > 0) {
      throw new ConfigError(
        `${missing.join(' and ')} must be set when DEMO_MODE is not enabled. ` +
          'Create a bot in the Discord Developer Portal, or run `npm run demo` to try it without a token.',
      )
    }
  }

  return {
    demoMode,
    discord: { token: e.DISCORD_TOKEN, clientId: e.DISCORD_CLIENT_ID, devGuildId: e.DISCORD_DEV_GUILD_ID },
    databasePath: e.DATABASE_PATH,
    dashboard: {
      enabled: e.DASHBOARD_ENABLED,
      host: e.DASHBOARD_HOST,
      port: e.DASHBOARD_PORT,
      password: e.DASHBOARD_PASSWORD,
    },
    schedulerIntervalMs: e.SCHEDULER_INTERVAL_MS,
    log: { level: e.LOG_LEVEL, format: e.LOG_FORMAT },
  }
}
