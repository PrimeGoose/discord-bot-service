import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  InteractionContextType,
  SlashCommandBuilder,
  escapeMarkdown,
} from 'discord.js'
import type { PollResults } from '../db/repos/polls.js'
import { parseDuration } from '../lib/duration.js'
import { bar, COLORS, discordTime, plural } from '../lib/format.js'
import { UserFacingError, type CommandResponse, type ComponentHandler, type SlashCommand } from './types.js'

export const POLL_LIMITS = {
  minOptions: 2,
  maxOptions: 5,
  maxOptionLength: 80,
  maxQuestionLength: 200,
  minDurationMs: 60_000,
  maxDurationMs: 7 * 86_400_000,
} as const

/** Split "Pizza | Sushi | Salad" (also `;` or newlines), trim, drop blanks and duplicates. */
export function parsePollOptions(raw: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const part of raw.split(/[|;\n]/)) {
    const option = part.trim()
    if (option === '' || seen.has(option.toLowerCase())) continue
    seen.add(option.toLowerCase())
    result.push(option)
  }
  return result
}

/** Build the poll message (embed + vote buttons) from current results. */
export function renderPoll({ poll, counts, total }: PollResults, now: number): CommandResponse {
  const closed = poll.closedAt !== null || (poll.closesAt !== null && poll.closesAt <= now)
  const leader = Math.max(...counts)

  const lines = poll.options.map((option, i) => {
    const n = counts[i] ?? 0
    const pct = total === 0 ? 0 : Math.round((n / total) * 100)
    const crown = closed && total > 0 && n === leader ? ' 🏆' : ''
    return `**${i + 1}. ${escapeMarkdown(option)}**${crown}\n\`${bar(total === 0 ? 0 : n / total)}\` ${pct}% · ${plural(n, 'vote')}`
  })

  const status = closed
    ? `Closed ${discordTime(poll.closedAt ?? poll.closesAt ?? now, 'R')}`
    : poll.closesAt
      ? `Closes ${discordTime(poll.closesAt, 'R')}`
      : 'Open until the author closes it'

  const embed = new EmbedBuilder()
    .setColor(closed ? COLORS.neutral : COLORS.brand)
    .setTitle(`📊 ${escapeMarkdown(poll.question)}`)
    .setDescription(`${lines.join('\n')}\n\n${status} · ${plural(total, 'vote')} total`)
    .setFooter({ text: `Poll #${poll.id} · one vote per member, click again to change it` })

  if (closed) return { embeds: [embed], components: [] }

  const voteRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    poll.options.map((option, i) =>
      new ButtonBuilder()
        .setCustomId(`poll:vote:${poll.id}:${i}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(`${i + 1}. ${option}`.slice(0, 80)),
    ),
  )
  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`poll:close:${poll.id}`).setStyle(ButtonStyle.Secondary).setLabel('Close poll'),
  )
  return { embeds: [embed], components: [voteRow, controlRow] }
}

export const poll: SlashCommand = {
  category: 'Community',
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Run a quick button poll with live results.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o.setName('question').setDescription('What are you asking?').setRequired(true).setMaxLength(POLL_LIMITS.maxQuestionLength),
    )
    .addStringOption((o) =>
      o.setName('options').setDescription('2–5 choices separated by |, e.g. Pizza | Sushi | Salad').setRequired(true).setMaxLength(450),
    )
    .addStringOption((o) => o.setName('duration').setDescription('Auto-close after, e.g. 30m, 1d (max 7d)').setMaxLength(32)),
  execute(ctx) {
    if (!ctx.guild) throw new UserFacingError('Polls can only be run inside a server.')
    const question = (ctx.options.getString('question') ?? '').trim()
    const options = parsePollOptions(ctx.options.getString('options') ?? '')
    const durationText = ctx.options.getString('duration')

    if (question.length === 0) throw new UserFacingError('The poll needs a question.')
    if (options.length < POLL_LIMITS.minOptions || options.length > POLL_LIMITS.maxOptions) {
      throw new UserFacingError('Give 2–5 distinct options separated by `|`, e.g. `Pizza | Sushi | Salad`.')
    }
    const tooLong = options.find((o) => o.length > POLL_LIMITS.maxOptionLength)
    if (tooLong) throw new UserFacingError(`Options can be at most ${POLL_LIMITS.maxOptionLength} characters.`)

    let closesAt: number | null = null
    const now = ctx.now()
    if (durationText) {
      const ms = parseDuration(durationText)
      if (ms === null || ms < POLL_LIMITS.minDurationMs || ms > POLL_LIMITS.maxDurationMs) {
        throw new UserFacingError('Duration must be between 1 minute and 7 days, e.g. `30m` or `1d`.')
      }
      closesAt = now + ms
    }

    const created = ctx.store.polls.create({
      guildId: ctx.guild.id,
      channelId: ctx.channelId,
      authorId: ctx.user.id,
      question,
      options,
      createdAt: now,
      closesAt,
    })
    return {
      ...renderPoll({ poll: created, counts: options.map(() => 0), total: 0 }, now),
      onPosted: (messageId) => {
        ctx.store.polls.attachMessage(created.id, messageId)
      },
    }
  },
}

/** Handles `poll:vote:<pollId>:<option>` and `poll:close:<pollId>` button presses. */
export const pollButtons: ComponentHandler = {
  prefix: 'poll',
  handle(ctx) {
    const [, action, idText, optionText] = ctx.customId.split(':')
    const pollId = Number(idText)
    const now = ctx.now()

    if (action === 'vote') {
      const optionIndex = Number(optionText)
      const outcome = ctx.store.polls.vote(pollId, ctx.user.id, optionIndex, now)
      const results = ctx.store.polls.results(pollId)
      const option = results?.poll.options[optionIndex] ?? '?'
      const messages: Record<typeof outcome, string> = {
        recorded: `✅ Vote recorded for **${escapeMarkdown(option)}**.`,
        changed: `🔁 Vote changed to **${escapeMarkdown(option)}**.`,
        unchanged: `You already voted for **${escapeMarkdown(option)}**.`,
        closed: '🔒 This poll is closed.',
        not_found: 'This poll no longer exists.',
        invalid_option: 'That option is not valid.',
      }
      return {
        ...(results ? { update: renderPoll(results, now) } : {}),
        reply: { ephemeral: true, content: messages[outcome] },
      }
    }

    if (action === 'close') {
      const existing = ctx.store.polls.get(pollId)
      if (!existing) return { reply: { ephemeral: true, content: 'This poll no longer exists.' } }
      if (existing.authorId !== ctx.user.id) {
        return { reply: { ephemeral: true, content: 'Only the person who started the poll can close it.' } }
      }
      ctx.store.polls.close(pollId, now, { userId: ctx.user.id })
      const results = ctx.store.polls.results(pollId)
      return results ? { update: renderPoll(results, now) } : {}
    }

    return { reply: { ephemeral: true, content: 'Unknown poll action.' } }
  },
}
