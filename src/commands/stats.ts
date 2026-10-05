import { EmbedBuilder, InteractionContextType, SlashCommandBuilder, escapeMarkdown } from 'discord.js'
import { DAY_MS } from '../db/repos/stats.js'
import { COLORS, plural, sparkline } from '../lib/format.js'
import { UserFacingError, type SlashCommand } from './types.js'

export const stats: SlashCommand = {
  category: 'Insights',
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Message activity for this server, from counts the bot has recorded since it joined.')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) => o.setName('days').setDescription('Window in days (default 7)').setMinValue(1).setMaxValue(30)),
  execute(ctx) {
    if (!ctx.guild) throw new UserFacingError('Stats are only available inside a server.')
    const days = ctx.options.getInteger('days') ?? 7
    const now = ctx.now()
    const activity = ctx.store.stats.guildActivity(ctx.guild.id, days, now)
    const commands = ctx.store.stats.commandUsage(now - days * DAY_MS, ctx.guild.id)
    const commandTotal = commands.reduce((sum, c) => sum + c.uses, 0)

    const embed = new EmbedBuilder()
      .setColor(COLORS.brand)
      .setTitle(`📈 ${escapeMarkdown(ctx.guild.name)} — last ${plural(days, 'day')}`)
      .addFields(
        { name: 'Messages', value: activity.total.toLocaleString('en-US'), inline: true },
        { name: 'Active members', value: activity.activeMembers.toLocaleString('en-US'), inline: true },
        { name: 'Commands run', value: commandTotal.toLocaleString('en-US'), inline: true },
      )

    if (activity.total === 0) {
      embed.setDescription('No messages recorded in this window yet. Counting starts when the bot joins a server.')
    } else {
      embed.setDescription(`Daily activity \`${sparkline(activity.daily.map((d) => d.count))}\``)
      embed.addFields(
        {
          name: 'Top channels',
          value: activity.topChannels.map((c, i) => `${i + 1}. <#${c.channelId}> — ${c.count.toLocaleString('en-US')}`).join('\n'),
          inline: true,
        },
        {
          name: 'Most active',
          value: activity.topMembers.map((m, i) => `${i + 1}. <@${m.userId}> — ${m.count.toLocaleString('en-US')}`).join('\n'),
          inline: true,
        },
      )
    }
    if (commands.length > 0) {
      embed.addFields({
        name: 'Popular commands',
        value: commands.slice(0, 5).map((c) => `\`/${c.command}\` × ${c.uses}`).join(' · '),
      })
    }
    embed.setFooter({ text: 'Only message counts are stored — never message content.' })
    return { embeds: [embed] }
  },
}
