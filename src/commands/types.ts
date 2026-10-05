import type { ActionRowBuilder, ButtonBuilder, EmbedBuilder, SharedSlashCommand } from 'discord.js'
import type { Store } from '../db/store.js'
import type { Logger } from '../logger.js'

/**
 * What a handler wants to send. Kept as discord.js builders so the live adapter
 * can pass it straight through, while tests and demo mode can call `toJSON()`.
 */
export interface CommandResponse {
  content?: string
  embeds?: EmbedBuilder[]
  components?: ActionRowBuilder<ButtonBuilder>[]
  /** Only visible to the invoking user. */
  ephemeral?: boolean
  /** Users that may be pinged by this message (everyone/roles are never allowed). */
  allowedUserMentions?: string[]
  /** Called with the posted message id (e.g. so a poll can find its message later). */
  onPosted?: (messageId: string) => void
}

/** Minimal, transport-agnostic view of slash command options. */
export interface CommandOptions {
  getSubcommand(): string | null
  getString(name: string): string | null
  getInteger(name: string): number | null
}

export interface RuntimeInfo {
  demo: boolean
  startedAt: number
  /** Gateway heartbeat in ms, or null when not connected (demo mode). */
  wsPingMs: number | null
  guildCount: number
  version: string
}

export interface Services {
  store: Store
  logger: Logger
  now: () => number
  runtime: () => RuntimeInfo
}

export interface CommandContext extends Services {
  commandName: string
  user: { id: string; username: string }
  guild: { id: string; name: string } | null
  channelId: string
  options: CommandOptions
}

export interface SlashCommand {
  data: SharedSlashCommand
  /** Shown in /help; grouped by category. */
  category: 'Utility' | 'Community' | 'Insights'
  execute(ctx: CommandContext): CommandResponse | Promise<CommandResponse>
}

export interface ComponentContext extends Services {
  customId: string
  user: { id: string; username: string }
  guild: { id: string; name: string } | null
}

/** A button press: optionally edit the message it's attached to, optionally reply privately. */
export interface ComponentResult {
  update?: CommandResponse
  reply?: CommandResponse
}

export interface ComponentHandler {
  /** customId prefix, e.g. `poll` matches `poll:vote:12:0`. */
  prefix: string
  handle(ctx: ComponentContext): ComponentResult | Promise<ComponentResult>
}

/** Thrown by handlers for expected, user-facing problems (bad input, permissions...). */
export class UserFacingError extends Error {
  override name = 'UserFacingError'
}
