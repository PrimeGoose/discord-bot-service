import type {
  CommandContext,
  CommandResponse,
  ComponentContext,
  ComponentHandler,
  ComponentResult,
  SlashCommand,
} from './types.js'
import { UserFacingError } from './types.js'

const errorResponse = (message: string): CommandResponse => ({ ephemeral: true, content: `⚠️ ${message}` })

/**
 * Routes interactions to handlers, measures them, records usage stats and turns
 * failures into friendly ephemeral replies. Has no discord.js runtime dependency,
 * so the live bot, demo mode and tests all share it.
 */
export class Dispatcher {
  private readonly byName: Map<string, SlashCommand>

  constructor(
    commands: readonly SlashCommand[],
    private readonly components: readonly ComponentHandler[],
  ) {
    this.byName = new Map(commands.map((c) => [c.data.name, c]))
  }

  async runCommand(ctx: CommandContext): Promise<CommandResponse> {
    const command = this.byName.get(ctx.commandName)
    if (!command) return errorResponse(`Unknown command \`/${ctx.commandName}\`.`)

    const started = performance.now()
    let success = true
    let response: CommandResponse
    try {
      response = await command.execute(ctx)
    } catch (error) {
      if (error instanceof UserFacingError) {
        response = errorResponse(error.message)
      } else {
        success = false
        ctx.logger.error({ err: error, command: ctx.commandName, guildId: ctx.guild?.id }, 'command failed')
        response = errorResponse('Something went wrong running that command. It has been logged.')
      }
    }
    const durationMs = Math.round(performance.now() - started)

    const subcommand = ctx.options.getSubcommand()
    try {
      ctx.store.stats.recordCommand({
        guildId: ctx.guild?.id ?? null,
        userId: ctx.user.id,
        command: ctx.commandName,
        subcommand,
        success,
        durationMs,
        usedAt: ctx.now(),
      })
    } catch (error) {
      ctx.logger.warn({ err: error }, 'failed to record command usage')
    }
    ctx.logger.info({ command: ctx.commandName, subcommand, guildId: ctx.guild?.id, success, durationMs }, 'command handled')
    return response
  }

  async runComponent(ctx: ComponentContext): Promise<ComponentResult> {
    const prefix = ctx.customId.split(':')[0]
    const handler = this.components.find((h) => h.prefix === prefix)
    if (!handler) return { reply: errorResponse('This button is no longer supported.') }
    try {
      return await handler.handle(ctx)
    } catch (error) {
      ctx.logger.error({ err: error, customId: ctx.customId }, 'component failed')
      return { reply: errorResponse('Something went wrong handling that button.') }
    }
  }
}
