import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js'
import { formatDuration, parseDuration } from '../lib/duration.js'
import { COLORS, discordTime } from '../lib/format.js'
import { UserFacingError, type CommandContext, type CommandResponse, type SlashCommand } from './types.js'

export const REMINDER_LIMITS = {
  minMs: 10_000,
  maxMs: 365 * 86_400_000,
  maxMessageLength: 500,
  maxPendingPerUser: 25,
} as const

function set(ctx: CommandContext): CommandResponse {
  const when = ctx.options.getString('in') ?? ''
  const message = (ctx.options.getString('message') ?? '').trim()
  const delay = parseDuration(when)

  if (delay === null) {
    throw new UserFacingError(`I couldn't understand \`${when}\`. Try something like \`10m\`, \`1h30m\` or \`2 days\`.`)
  }
  if (delay < REMINDER_LIMITS.minMs || delay > REMINDER_LIMITS.maxMs) {
    throw new UserFacingError('Reminders must be between 10 seconds and 365 days away.')
  }
  if (message.length === 0 || message.length > REMINDER_LIMITS.maxMessageLength) {
    throw new UserFacingError(`The reminder text must be 1–${REMINDER_LIMITS.maxMessageLength} characters.`)
  }
  if (ctx.store.reminders.countPendingForUser(ctx.user.id) >= REMINDER_LIMITS.maxPendingPerUser) {
    throw new UserFacingError(
      `You already have ${REMINDER_LIMITS.maxPendingPerUser} pending reminders. Cancel one with \`/remind cancel\` first.`,
    )
  }

  const now = ctx.now()
  const reminder = ctx.store.reminders.create({
    guildId: ctx.guild?.id ?? null,
    channelId: ctx.channelId,
    userId: ctx.user.id,
    message,
    remindAt: now + delay,
    createdAt: now,
  })

  return {
    ephemeral: true,
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle('⏰ Reminder set')
        .setDescription(message)
        .addFields(
          { name: 'When', value: `${discordTime(reminder.remindAt, 'f')} (${discordTime(reminder.remindAt, 'R')})`, inline: true },
          { name: 'In', value: formatDuration(delay), inline: true },
          { name: 'ID', value: `#${reminder.id}`, inline: true },
        )
        .setFooter({ text: 'I will mention you in this channel. Cancel with /remind cancel.' }),
    ],
  }
}

function list(ctx: CommandContext): CommandResponse {
  const reminders = ctx.store.reminders.listPendingForUser(ctx.user.id, 10)
  if (reminders.length === 0) {
    return { ephemeral: true, content: 'You have no pending reminders. Create one with `/remind set`.' }
  }
  const lines = reminders.map((r) => {
    const text = r.message.length > 80 ? `${r.message.slice(0, 77)}…` : r.message
    return `**#${r.id}** · ${discordTime(r.remindAt, 'R')} — ${text}`
  })
  return {
    ephemeral: true,
    embeds: [new EmbedBuilder().setColor(COLORS.brand).setTitle('Your pending reminders').setDescription(lines.join('\n'))],
  }
}

function cancel(ctx: CommandContext): CommandResponse {
  const id = ctx.options.getInteger('id') ?? -1
  if (!ctx.store.reminders.cancel(id, ctx.user.id, ctx.now())) {
    throw new UserFacingError(`No pending reminder #${id} belongs to you.`)
  }
  return { ephemeral: true, content: `🗑️ Reminder #${id} cancelled.` }
}

export const remind: SlashCommand = {
  category: 'Utility',
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Personal reminders delivered in the channel where you set them.')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Remind me about something later.')
        .addStringOption((o) => o.setName('in').setDescription('When, e.g. 10m, 1h30m, 2 days').setRequired(true).setMaxLength(32))
        .addStringOption((o) =>
          o.setName('message').setDescription('What to remind you about').setRequired(true).setMaxLength(REMINDER_LIMITS.maxMessageLength),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show your pending reminders.'))
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription('Cancel one of your reminders.')
        .addIntegerOption((o) => o.setName('id').setDescription('Reminder ID from /remind list').setRequired(true).setMinValue(1)),
    ),
  execute(ctx) {
    switch (ctx.options.getSubcommand()) {
      case 'set':
        return set(ctx)
      case 'list':
        return list(ctx)
      case 'cancel':
        return cancel(ctx)
      default:
        throw new UserFacingError('Unknown subcommand.')
    }
  },
}
