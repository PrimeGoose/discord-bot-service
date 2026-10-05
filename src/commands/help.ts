import { ApplicationCommandOptionType, EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js'
import { COLORS } from '../lib/format.js'
import type { SlashCommand } from './types.js'

/** /help is generated from the registry so it can never drift from the real command list. */
export function createHelpCommand(getCommands: () => readonly SlashCommand[]): SlashCommand {
  return {
    category: 'Utility',
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('List everything Server Toolkit can do.')
      .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),
    execute(ctx) {
      const byCategory = new Map<string, string[]>()
      for (const command of getCommands()) {
        const json = command.data.toJSON()
        const subcommands = (json.options ?? []).filter((o) => o.type === ApplicationCommandOptionType.Subcommand).map((o) => o.name)
        const usage = subcommands.length > 0 ? `/${json.name} ${subcommands.join('|')}` : `/${json.name}`
        const lines = byCategory.get(command.category) ?? []
        lines.push(`\`${usage}\` — ${json.description}`)
        byCategory.set(command.category, lines)
      }
      const embed = new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle('🧰 Server Toolkit')
        .setDescription('An official Discord bot built on slash commands. Here is what I can do:')
        .addFields([...byCategory].map(([name, lines]) => ({ name, value: lines.join('\n') })))
        .setFooter({ text: ctx.runtime().demo ? 'Running in demo mode' : 'Need more? Ask a server admin.' })
      return { embeds: [embed], ephemeral: true }
    },
  }
}
