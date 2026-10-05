import { pino } from 'pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reminderMessage } from '../src/bot/client.js'
import { toEdit, toReply } from '../src/bot/discord-adapter.js'
import { Scheduler, type Delivery } from '../src/bot/scheduler.js'
import { DAY_MS } from '../src/db/repos/stats.js'
import type { Store } from '../src/db/store.js'
import { createShutdown } from '../src/lib/shutdown.js'
import { memoryStore, NOW } from './helpers.js'

const logger = pino({ level: 'silent' })
let store: Store
let clock: number
let delivery: { sendReminder: ReturnType<typeof vi.fn<Delivery['sendReminder']>>; updatePollMessage: ReturnType<typeof vi.fn<Delivery['updatePollMessage']>> }
let scheduler: Scheduler

beforeEach(() => {
  store = memoryStore()
  clock = NOW
  delivery = { sendReminder: vi.fn(() => Promise.resolve()), updatePollMessage: vi.fn(() => Promise.resolve()) }
  scheduler = new Scheduler(store, delivery, logger, () => clock, { intervalMs: 1000, retentionDays: 90 })
})
afterEach(async () => {
  await scheduler.stop()
  store.close()
})

const reminder = (remindAt: number) =>
  store.reminders.create({ guildId: 'g', channelId: 'c', userId: 'u', message: 'hi', remindAt, createdAt: NOW - 1000 })

describe('Scheduler', () => {
  it('delivers due reminders exactly once', async () => {
    reminder(NOW - 1)
    reminder(NOW + 60_000)
    expect(await scheduler.tick()).toMatchObject({ remindersDelivered: 1 })
    expect(await scheduler.tick()).toMatchObject({ remindersDelivered: 0 })
    expect(delivery.sendReminder).toHaveBeenCalledTimes(1)

    clock = NOW + 60_000
    expect(await scheduler.tick()).toMatchObject({ remindersDelivered: 1 })
  })

  it('retries failed deliveries, then gives up after a day', async () => {
    const r = reminder(NOW - 1)
    delivery.sendReminder.mockRejectedValue(new Error('Missing Access'))
    expect(await scheduler.tick()).toMatchObject({ remindersFailed: 1 })
    expect(store.reminders.due(clock).map((x) => x.id)).toEqual([r.id]) // still pending → retried

    clock = NOW + DAY_MS + 1
    await scheduler.tick()
    expect(store.reminders.due(clock)).toEqual([]) // abandoned
  })

  it('does not run overlapping ticks', async () => {
    reminder(NOW - 1)
    let release: () => void = () => undefined
    delivery.sendReminder.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)))
    const a = scheduler.tick()
    const b = scheduler.tick()
    expect(a).toBe(b)
    release()
    await a
    expect(delivery.sendReminder).toHaveBeenCalledTimes(1)
  })

  it('closes expired polls and updates their message', async () => {
    const poll = store.polls.create({ guildId: 'g', channelId: 'c', authorId: 'a', question: 'Q', options: ['A', 'B'], createdAt: NOW, closesAt: NOW - 1 })
    store.polls.attachMessage(poll.id, 'msg-1')
    store.polls.create({ guildId: 'g', channelId: 'c', authorId: 'a', question: 'later', options: ['A', 'B'], createdAt: NOW, closesAt: NOW + 1e6 })

    expect(await scheduler.tick()).toMatchObject({ pollsClosed: 1 })
    expect(delivery.updatePollMessage).toHaveBeenCalledWith(expect.objectContaining({ id: poll.id, messageId: 'msg-1' }), expect.objectContaining({ components: [] }))
    expect(store.polls.countOpen()).toBe(1)
  })

  it('prunes stats beyond the retention window once per day', async () => {
    store.stats.recordMessage({ guildId: 'g', channelId: 'c', userId: 'u', at: NOW - 100 * DAY_MS })
    const spy = vi.spyOn(store.stats, 'prune')
    await scheduler.tick()
    await scheduler.tick()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(store.stats.dailyMessages(200, NOW).reduce((s, d) => s + d.count, 0)).toBe(0)
  })

  it('start() ticks immediately and stop() halts the timer', async () => {
    vi.useFakeTimers()
    try {
      reminder(NOW - 1)
      scheduler.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(delivery.sendReminder).toHaveBeenCalledTimes(1)
      reminder(NOW - 1)
      await scheduler.stop()
      await vi.advanceTimersByTimeAsync(5000)
      expect(delivery.sendReminder).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Discord payload adapter', () => {
  it('never allows mass mentions and only pings the reminder owner', () => {
    const r = store.reminders.create({ guildId: 'g', channelId: 'c', userId: '42', message: '@everyone ship it', remindAt: NOW, createdAt: NOW })
    const payload = toReply(reminderMessage(r))
    expect(payload.allowedMentions).toEqual({ parse: [], users: ['42'] })
    expect(payload.content).toContain('<@42>')
  })

  it('maps ephemeral replies to the Ephemeral flag and clears components on edit', () => {
    expect(toReply({ content: 'hi', ephemeral: true }).flags).toBe(64)
    expect(toReply({ content: 'hi' }).flags).toBeUndefined()
    expect(toEdit({ content: 'closed' })).toMatchObject({ embeds: [], components: [] })
  })
})

describe('createShutdown', () => {
  it('runs every task in order even if one fails, once, then exits non-zero', async () => {
    const order: string[] = []
    const exit = vi.fn()
    const shutdown = createShutdown(
      logger,
      [
        { name: 'a', run: () => void order.push('a') },
        { name: 'b', run: () => Promise.reject(new Error('nope')) },
        { name: 'c', run: () => void order.push('c') },
      ],
      { exit },
    )
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')])
    expect(order).toEqual(['a', 'c'])
    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('exits zero on a clean shutdown', async () => {
    const exit = vi.fn()
    await createShutdown(logger, [{ name: 'noop', run: () => undefined }], { exit })('SIGINT')
    expect(exit).toHaveBeenCalledWith(0)
  })
})
