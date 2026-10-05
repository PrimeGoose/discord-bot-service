import { Client, Events, GatewayIntentBits, type Interaction } from 'discord.js'
import type { Dispatcher } from '../commands/dispatcher.js'
import type { CommandResponse, Services } from '../commands/types.js'
import type { Poll } from '../db/repos/polls.js'
import type { Reminder } from '../db/repos/reminders.js'
import { discordTime } from '../lib/format.js'
import { commandContext, componentContext, toEdit, toMessage, toReply } from './discord-adapter.js'
import type { Delivery } from './scheduler.js'

/**
 * Intents are deliberately minimal and non-privileged:
 *  - Guilds: guild join/leave/rename events and the command interaction context.
 *  - GuildMessages: lets /stats count messages per channel. Without the privileged
 *    MessageContent intent Discord sends no message text, and the bot doesn't want it.
 */
export const INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] as const

export function createDiscordClient(): Client {
  return new Client({ intents: [...INTENTS] })
}

export function reminderMessage(reminder: Reminder): CommandResponse {
  return {
    content: `<@${reminder.userId}> ⏰ **Reminder:** ${reminder.message}\n-# set ${discordTime(reminder.createdAt, 'R')} · #${reminder.id}`,
    allowedUserMentions: [reminder.userId],
  }
}

/** Wire gateway events to the store and the dispatcher. */
export function attachHandlers(client: Client, services: Services, dispatcher: Dispatcher): void {
  const { store, logger, now } = services

  client.once(Events.ClientReady, (ready) => {
    for (const guild of ready.guilds.cache.values()) {
      store.guilds.upsert({ id: guild.id, name: guild.name, memberCount: guild.memberCount }, now())
    }
    logger.info({ user: ready.user.tag, guilds: ready.guilds.cache.size }, 'connected to Discord gateway')
  })

  client.on(Events.GuildCreate, (guild) => {
    store.guilds.upsert({ id: guild.id, name: guild.name, memberCount: guild.memberCount }, now())
    logger.info({ guildId: guild.id }, 'joined guild')
  })
  client.on(Events.GuildUpdate, (_old, guild) => {
    store.guilds.upsert({ id: guild.id, name: guild.name, memberCount: guild.memberCount }, now())
  })
  client.on(Events.GuildDelete, (guild) => {
    store.guilds.markLeft(guild.id, now())
    logger.info({ guildId: guild.id }, 'left guild')
  })

  client.on(Events.MessageCreate, (message) => {
    // Count only human messages in guilds. message.content is not read (and is empty without the privileged intent).
    if (!message.inGuild() || message.author.bot || message.system) return
    store.stats.recordMessage({ guildId: message.guildId, channelId: message.channelId, userId: message.author.id, at: now() })
  })

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction, services, dispatcher).catch((err: unknown) => {
      logger.error({ err, interactionId: interaction.id }, 'failed to respond to interaction')
    })
  })

  client.on(Events.Error, (err) => {
    logger.error({ err }, 'discord client error')
  })
  client.on(Events.Warn, (msg) => {
    logger.warn({ msg }, 'discord client warning')
  })
  client.on(Events.ShardDisconnect, (event, shardId) => {
    logger.warn({ code: event.code, shardId }, 'gateway disconnected')
  })
  client.on(Events.ShardResume, (shardId) => {
    logger.info({ shardId }, 'gateway resumed')
  })
}

async function handleInteraction(interaction: Interaction, services: Services, dispatcher: Dispatcher): Promise<void> {
  if (interaction.isChatInputCommand()) {
    const response = await dispatcher.runCommand(commandContext(interaction, services))
    await interaction.reply(toReply(response))
    if (response.onPosted) {
      const message = await interaction.fetchReply()
      response.onPosted(message.id)
    }
    return
  }

  if (interaction.isButton()) {
    const result = await dispatcher.runComponent(componentContext(interaction, services))
    if (result.update) {
      await interaction.update(toEdit(result.update))
      if (result.reply) await interaction.followUp(toReply(result.reply))
    } else if (result.reply) {
      await interaction.reply(toReply(result.reply))
    } else {
      await interaction.deferUpdate()
    }
  }
}

/** Scheduler delivery over the Discord API, with a DM fallback for reminders. */
export function discordDelivery(client: Client, services: Services): Delivery {
  return {
    async sendReminder(reminder) {
      const payload = toMessage(reminderMessage(reminder))
      try {
        const channel = await client.channels.fetch(reminder.channelId)
        if (channel?.isSendable()) {
          await channel.send(payload)
          return
        }
      } catch (err) {
        services.logger.debug({ err, reminderId: reminder.id }, 'channel unavailable, falling back to DM')
      }
      const user = await client.users.fetch(reminder.userId)
      await user.send(payload)
    },
    async updatePollMessage(poll: Poll, message) {
      if (!poll.messageId) return
      const channel = await client.channels.fetch(poll.channelId)
      if (channel?.isTextBased()) await channel.messages.edit(poll.messageId, toEdit(message))
    },
  }
}
