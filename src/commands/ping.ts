import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js'
import { formatDuration } from '../lib/duration.js'
import { COLORS } from '../lib/format.js'
import type { SlashCommand } from './types.js'

export const ping: SlashCommand = {
  category: 'Utility',
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check that the bot is alive: gateway latency, database latency and uptime.')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),
  execute(ctx) {
    const runtime = ctx.runtime()
    const t0 = performance.now()
    ctx.store.db.get('SELECT 1')
    const dbMs = performance.now() - t0

    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle('🏓 Pong!')
      .addFields(
        { name: 'Gateway', value: runtime.wsPingMs === null ? 'demo (offline)' : `${runtime.wsPingMs} ms`, inline: true },
        { name: 'Database', value: `${dbMs.toFixed(2)} ms`, inline: true },
        { name: 'Uptime', value: formatDuration(ctx.now() - runtime.startedAt), inline: true },
      )
      .setFooter({ text: `Server Toolkit v${runtime.version}${runtime.demo ? ' · demo mode' : ''}` })
    return { embeds: [embed], ephemeral: true }
  },
}
