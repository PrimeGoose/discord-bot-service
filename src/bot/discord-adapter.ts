import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type MessageCreateOptions,
} from 'discord.js'
import type { CommandContext, CommandResponse, ComponentContext, Services } from '../commands/types.js'

/** Never let bot output ping @everyone/@here/roles; only explicitly allowed users. */
const allowedMentions = (r: CommandResponse) => ({ parse: [], users: r.allowedUserMentions ?? [] })

export function toReply(r: CommandResponse): InteractionReplyOptions {
  return {
    ...(r.content !== undefined ? { content: r.content } : {}),
    ...(r.embeds ? { embeds: r.embeds } : {}),
    ...(r.components ? { components: r.components } : {}),
    ...(r.ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
    allowedMentions: allowedMentions(r),
  }
}

/** For editing an existing message (button `update`, scheduler poll close). */
export function toEdit(r: CommandResponse): InteractionEditReplyOptions {
  return {
    ...(r.content !== undefined ? { content: r.content } : {}),
    embeds: r.embeds ?? [],
    components: r.components ?? [],
    allowedMentions: allowedMentions(r),
  }
}

export function toMessage(r: CommandResponse): MessageCreateOptions {
  return {
    ...(r.content !== undefined ? { content: r.content } : {}),
    ...(r.embeds ? { embeds: r.embeds } : {}),
    ...(r.components ? { components: r.components } : {}),
    allowedMentions: allowedMentions(r),
  }
}

export function commandContext(interaction: ChatInputCommandInteraction, services: Services): CommandContext {
  return {
    ...services,
    commandName: interaction.commandName,
    user: { id: interaction.user.id, username: interaction.user.username },
    guild: interaction.guild ? { id: interaction.guild.id, name: interaction.guild.name } : null,
    channelId: interaction.channelId,
    options: {
      getSubcommand: () => interaction.options.getSubcommand(false),
      getString: (name) => interaction.options.getString(name),
      getInteger: (name) => interaction.options.getInteger(name),
    },
  }
}

export function componentContext(interaction: ButtonInteraction, services: Services): ComponentContext {
  return {
    ...services,
    customId: interaction.customId,
    user: { id: interaction.user.id, username: interaction.user.username },
    guild: interaction.guild ? { id: interaction.guild.id, name: interaction.guild.name } : null,
  }
}
