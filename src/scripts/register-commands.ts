/**
 * Registers slash commands with Discord using the official REST API.
 *
 *   npm run register              # global commands (can take a while to propagate)
 *   npm run register -- --guild   # only DISCORD_DEV_GUILD_ID (instant, for development)
 *   npm run register -- --dry-run # print the payload; needs no token
 */
import { REST, Routes } from 'discord.js'
import { commandPayload } from '../commands/index.js'
import { loadConfig } from '../config.js'
import { createLogger } from '../logger.js'

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const config = loadConfig(process.env, dryRun ? { demoMode: true } : {})
const logger = createLogger({ level: config.log.level, format: config.log.format })
const body = commandPayload()

if (dryRun || config.demoMode) {
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`)
  process.stderr.write(`dry run: ${body.length} commands (${body.map((c) => c.name).join(', ')}); Discord was not contacted\n`)
  process.exit(0)
}

const { token, clientId, devGuildId } = config.discord
if (!token || !clientId) throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required')

const toGuild = args.has('--guild')
if (toGuild && !devGuildId) throw new Error('--guild needs DISCORD_DEV_GUILD_ID')

const rest = new REST({ version: '10' }).setToken(token)
const route = toGuild && devGuildId ? Routes.applicationGuildCommands(clientId, devGuildId) : Routes.applicationCommands(clientId)
await rest.put(route, { body })
logger.info({ scope: toGuild ? `guild ${devGuildId ?? ''}` : 'global', commands: body.map((c) => c.name) }, 'slash commands registered')
