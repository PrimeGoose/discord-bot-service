import { renderPoll } from '../commands/poll.js'
import type { CommandResponse } from '../commands/types.js'
import type { Poll } from '../db/repos/polls.js'
import type { Reminder } from '../db/repos/reminders.js'
import { DAY_MS } from '../db/repos/stats.js'
import type { Store } from '../db/store.js'
import type { Logger } from '../logger.js'

/** How the scheduler talks to the outside world — Discord in live mode, the log in demo mode. */
export interface Delivery {
  sendReminder(reminder: Reminder): Promise<void>
  updatePollMessage(poll: Poll, message: CommandResponse): Promise<void>
}

export interface SchedulerOptions {
  intervalMs: number
  /** Give up retrying a reminder this long after it was due (e.g. channel deleted). */
  giveUpAfterMs?: number
  retentionDays?: number
}

export interface TickResult {
  remindersDelivered: number
  remindersFailed: number
  pollsClosed: number
}

/**
 * Polls SQLite for due work. Polling (rather than one setTimeout per reminder)
 * survives restarts for free: anything that came due while the bot was down is
 * delivered on the first tick.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private running: Promise<TickResult> | null = null
  private lastPruneDay = -1

  constructor(
    private readonly store: Store,
    private readonly delivery: Delivery,
    private readonly logger: Logger,
    private readonly now: () => number,
    private readonly opts: SchedulerOptions,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), this.opts.intervalMs)
    this.timer.unref()
    void this.tick()
    this.logger.info({ intervalMs: this.opts.intervalMs }, 'scheduler started')
  }

  /** Stops the timer and waits for an in-flight tick to finish. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.running) await this.running
  }

  tick(): Promise<TickResult> {
    // Never overlap ticks: a slow Discord API call must not cause double delivery.
    this.running ??= this.runTick().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async runTick(): Promise<TickResult> {
    const now = this.now()
    const result: TickResult = { remindersDelivered: 0, remindersFailed: 0, pollsClosed: 0 }
    const giveUpAfter = this.opts.giveUpAfterMs ?? DAY_MS

    for (const reminder of this.store.reminders.due(now)) {
      try {
        await this.delivery.sendReminder(reminder)
        this.store.reminders.markDelivered(reminder.id, this.now())
        result.remindersDelivered++
      } catch (err) {
        result.remindersFailed++
        const abandon = now - reminder.remindAt > giveUpAfter
        if (abandon) this.store.reminders.markDelivered(reminder.id, now)
        this.logger.warn({ err, reminderId: reminder.id, abandon }, 'reminder delivery failed')
      }
    }

    for (const poll of this.store.polls.expired(now)) {
      if (!this.store.polls.close(poll.id, now)) continue
      result.pollsClosed++
      const results = this.store.polls.results(poll.id)
      if (!results || !poll.messageId) continue
      try {
        await this.delivery.updatePollMessage(results.poll, renderPoll(results, now))
      } catch (err) {
        this.logger.warn({ err, pollId: poll.id }, 'could not update closed poll message')
      }
    }

    const day = Math.floor(now / DAY_MS)
    if (this.opts.retentionDays && day !== this.lastPruneDay) {
      this.lastPruneDay = day
      const pruned = this.store.stats.prune(this.opts.retentionDays, now)
      if (pruned.messageRows + pruned.commandRows > 0) this.logger.info(pruned, 'pruned old stats')
    }

    if (result.remindersDelivered + result.remindersFailed + result.pollsClosed > 0) {
      this.logger.info(result, 'scheduler tick')
    }
    return result
  }
}
