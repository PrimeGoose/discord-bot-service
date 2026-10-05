import type { Delivery } from '../bot/scheduler.js'
import type { Dispatcher } from '../commands/dispatcher.js'
import type { Services } from '../commands/types.js'
import { fakeCommandContext, type FakeInvocation } from './fake-context.js'
import { DEMO_USER, FIXTURE_GUILDS, FIXTURE_USERS } from './fixtures.js'
import { mulberry32, zipfIndex } from './seed.js'

/**
 * Demo mode only: generates a trickle of fake activity so the dashboard visibly
 * updates. Commands go through the real dispatcher, so usage stats are genuine.
 */
export class DemoSimulator {
  private timer: NodeJS.Timeout | null = null
  private readonly rand = mulberry32(7)

  constructor(
    private readonly services: Services,
    private readonly dispatcher: Dispatcher,
    private readonly intervalMs = 4000,
  ) {}

  start(): this {
    this.timer = setInterval(() => void this.step(), this.intervalMs)
    this.timer.unref()
    return this
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async step(): Promise<void> {
    const { store, now } = this.services
    for (const g of FIXTURE_GUILDS) {
      if (this.rand() > g.dailyMessages / 1000) continue
      const channel = g.channels[zipfIndex(this.rand, g.channels.length, 0.9)]
      const user = FIXTURE_USERS[zipfIndex(this.rand, FIXTURE_USERS.length)] ?? DEMO_USER
      if (channel) store.stats.recordMessage({ guildId: g.id, channelId: channel.id, userId: user.id, at: now() }, 1 + Math.floor(this.rand() * 6))
    }
    if (this.rand() < 0.35) {
      const g = FIXTURE_GUILDS[zipfIndex(this.rand, FIXTURE_GUILDS.length)] ?? FIXTURE_GUILDS[0]
      if (!g?.channels[0]) return
      const choices: Omit<FakeInvocation, 'guild' | 'user'>[] = [
        { command: 'ping' },
        { command: 'help' },
        { command: 'stats', options: { days: 7 } },
        { command: 'remind', options: { subcommand: 'list' } },
      ]
      const pick = choices[Math.floor(this.rand() * choices.length)] ?? { command: 'ping' }
      const user = FIXTURE_USERS[Math.floor(this.rand() * FIXTURE_USERS.length)] ?? DEMO_USER
      await this.dispatcher.runCommand(
        fakeCommandContext(this.services, { ...pick, user, guild: { id: g.id, name: g.name }, channelId: g.channels[0].id }),
      )
    }
  }
}

/** Demo delivery: log what would be sent to Discord instead of calling the API. */
export function demoDelivery(services: Services): Delivery {
  return {
    sendReminder(reminder) {
      services.logger.info({ reminderId: reminder.id, channelId: reminder.channelId }, `[demo] would deliver reminder: ${reminder.message}`)
      return Promise.resolve()
    },
    updatePollMessage(poll) {
      services.logger.info({ pollId: poll.id }, '[demo] would update closed poll message')
      return Promise.resolve()
    },
  }
}
