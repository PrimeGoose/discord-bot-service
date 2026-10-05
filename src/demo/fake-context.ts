import type { CommandContext, CommandOptions, ComponentContext, RuntimeInfo, Services } from '../commands/types.js'

export type OptionValues = Record<string, string | number | undefined> & { subcommand?: string }

/** Options object backed by a plain record — used by demo mode and unit tests. */
export function fakeOptions(values: OptionValues = {}): CommandOptions {
  const { subcommand, ...rest } = values
  return {
    getSubcommand: () => subcommand ?? null,
    getString: (name) => {
      const v = rest[name]
      return typeof v === 'string' ? v : null
    },
    getInteger: (name) => {
      const v = rest[name]
      return typeof v === 'number' ? v : null
    },
  }
}

export const defaultRuntime = (overrides: Partial<RuntimeInfo> = {}): RuntimeInfo => ({
  demo: true,
  startedAt: 0,
  wsPingMs: null,
  guildCount: 0,
  version: '0.1.0',
  ...overrides,
})

export interface FakeInvocation {
  command: string
  options?: OptionValues
  user?: { id: string; username: string }
  guild?: { id: string; name: string } | null
  channelId?: string
}

export function fakeCommandContext(services: Services, inv: FakeInvocation): CommandContext {
  return {
    ...services,
    commandName: inv.command,
    user: inv.user ?? { id: '100000000000000001', username: 'demo-user' },
    guild: inv.guild === undefined ? { id: '200000000000000001', name: 'Demo Server' } : inv.guild,
    channelId: inv.channelId ?? '300000000000000001',
    options: fakeOptions(inv.options),
  }
}

export function fakeComponentContext(
  services: Services,
  customId: string,
  user = { id: '100000000000000001', username: 'demo-user' },
): ComponentContext {
  return { ...services, customId, user, guild: { id: '200000000000000001', name: 'Demo Server' } }
}
