import { createHelpCommand } from './help.js'
import { ping } from './ping.js'
import { poll, pollButtons } from './poll.js'
import { remind } from './remind.js'
import { stats } from './stats.js'
import type { ComponentHandler, SlashCommand } from './types.js'

const commandList: SlashCommand[] = [ping, remind, poll, stats]
commandList.push(createHelpCommand(() => commandList))

export const commands: readonly SlashCommand[] = commandList
export const componentHandlers: readonly ComponentHandler[] = [pollButtons]

/** JSON payload for the Discord REST "bulk overwrite application commands" endpoint. */
export const commandPayload = () => commands.map((c) => c.data.toJSON())
