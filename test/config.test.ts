import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('runs in demo mode without any Discord credentials', () => {
    const config = loadConfig({ DEMO_MODE: 'true' })
    expect(config.demoMode).toBe(true)
    expect(config.discord.token).toBeUndefined()
    expect(config.dashboard).toMatchObject({ enabled: true, host: '127.0.0.1', port: 3000 })
  })

  it('requires the bot token and client id in live mode', () => {
    expect(() => loadConfig({ DEMO_MODE: 'false' })).toThrow(ConfigError)
    expect(() => loadConfig({ DISCORD_TOKEN: 'x' })).toThrow(/DISCORD_CLIENT_ID/)
  })

  it('accepts live config and treats blank optional values as unset', () => {
    const config = loadConfig({ DISCORD_TOKEN: 'bot-token', DISCORD_CLIENT_ID: '123', DISCORD_DEV_GUILD_ID: '  ' })
    expect(config.demoMode).toBe(false)
    expect(config.discord.devGuildId).toBeUndefined()
  })

  it('lets the --demo flag override the environment', () => {
    expect(loadConfig({ DEMO_MODE: 'false' }, { demoMode: true }).demoMode).toBe(true)
  })

  it('reports invalid values clearly', () => {
    expect(() => loadConfig({ DEMO_MODE: 'true', DASHBOARD_PORT: 'eighty' })).toThrow(/DASHBOARD_PORT/)
    expect(() => loadConfig({ DEMO_MODE: 'true', LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/)
  })
})
