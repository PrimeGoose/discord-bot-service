import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStore, type Store } from '../src/db/store.js'
import { DAY_MS, fillDays } from '../src/db/repos/stats.js'
import { memoryStore, NOW } from './helpers.js'

let store: Store
beforeEach(() => {
  store = memoryStore()
})
afterEach(() => {
  store.close()
})

describe('migrations', () => {
  it('applies once and is idempotent across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'toolkit-'))
    try {
      const path = join(dir, 'nested', 'test.db')
      const a = createStore(path)
      expect(a.db.schemaVersion()).toBe(1)
      a.reminders.create({ guildId: 'g', channelId: 'c', userId: 'u', message: 'persisted', remindAt: NOW, createdAt: NOW })
      a.close()
      const b = createStore(path)
      expect(b.db.schemaVersion()).toBe(1)
      expect(b.reminders.countPending()).toBe(1)
      b.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rolls back a failed transaction', () => {
    expect(() =>
      store.db.transaction(() => {
        store.guilds.upsert({ id: 'g1', name: 'Rolled back', memberCount: 1 }, NOW)
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(store.guilds.get('g1')).toBeUndefined()
  })
})

describe('GuildRepository', () => {
  it('upserts, marks left and resets join time on re-join', () => {
    store.guilds.upsert({ id: 'g1', name: 'Alpha', memberCount: 10 }, NOW)
    store.guilds.upsert({ id: 'g1', name: 'Alpha Renamed', memberCount: 12 }, NOW + 1000)
    expect(store.guilds.get('g1')).toMatchObject({ name: 'Alpha Renamed', memberCount: 12, joinedAt: NOW, leftAt: null })

    store.guilds.markLeft('g1', NOW + 2000)
    expect(store.guilds.overview(NOW)).toHaveLength(0)

    store.guilds.upsert({ id: 'g1', name: 'Alpha', memberCount: 12 }, NOW + 3000)
    expect(store.guilds.get('g1')).toMatchObject({ joinedAt: NOW + 3000, leftAt: null })
  })

  it('aggregates 7-day activity per guild', () => {
    store.guilds.upsert({ id: 'g1', name: 'Busy', memberCount: 10 }, NOW)
    store.guilds.upsert({ id: 'g2', name: 'Quiet', memberCount: 3 }, NOW)
    store.stats.recordMessage({ guildId: 'g1', channelId: 'c1', userId: 'u1', at: NOW }, 40)
    store.stats.recordMessage({ guildId: 'g1', channelId: 'c1', userId: 'u1', at: NOW - 10 * DAY_MS }, 999) // outside window
    store.stats.recordMessage({ guildId: 'g2', channelId: 'c2', userId: 'u2', at: NOW }, 2)
    store.stats.recordCommand({ guildId: 'g1', userId: 'u1', command: 'ping', subcommand: null, success: true, durationMs: 3, usedAt: NOW })
    store.reminders.create({ guildId: 'g1', channelId: 'c1', userId: 'u1', message: 'x', remindAt: NOW + 1, createdAt: NOW })

    const [busy, quiet] = store.guilds.overview(NOW)
    expect(busy).toMatchObject({ id: 'g1', messages7d: 40, commands7d: 1, activeReminders: 1, openPolls: 0 })
    expect(quiet).toMatchObject({ id: 'g2', messages7d: 2, commands7d: 0 })
  })
})

describe('ReminderRepository', () => {
  const base = { guildId: 'g1', channelId: 'c1', message: 'stretch', createdAt: NOW }

  it('returns only due, pending reminders in order', () => {
    const late = store.reminders.create({ ...base, userId: 'u1', remindAt: NOW - 1000 })
    const early = store.reminders.create({ ...base, userId: 'u1', remindAt: NOW - 5000 })
    store.reminders.create({ ...base, userId: 'u1', remindAt: NOW + 60_000 })
    expect(store.reminders.due(NOW).map((r) => r.id)).toEqual([early.id, late.id])

    store.reminders.markDelivered(early.id, NOW)
    expect(store.reminders.due(NOW).map((r) => r.id)).toEqual([late.id])
  })

  it('only lets the owner cancel, and only once', () => {
    const r = store.reminders.create({ ...base, userId: 'owner', remindAt: NOW + 1000 })
    expect(store.reminders.cancel(r.id, 'someone-else', NOW)).toBe(false)
    expect(store.reminders.cancel(r.id, 'owner', NOW)).toBe(true)
    expect(store.reminders.cancel(r.id, 'owner', NOW)).toBe(false)
    expect(store.reminders.listPendingForUser('owner')).toEqual([])
  })
})

describe('PollRepository', () => {
  const create = (closesAt: number | null = null) =>
    store.polls.create({
      guildId: 'g1',
      channelId: 'c1',
      authorId: 'author',
      question: 'Lunch?',
      options: ['Pizza', 'Sushi', 'Salad'],
      createdAt: NOW,
      closesAt,
    })

  it('records one vote per user and allows changing it', () => {
    const poll = create()
    expect(store.polls.vote(poll.id, 'u1', 0, NOW)).toBe('recorded')
    expect(store.polls.vote(poll.id, 'u2', 0, NOW)).toBe('recorded')
    expect(store.polls.vote(poll.id, 'u1', 0, NOW)).toBe('unchanged')
    expect(store.polls.vote(poll.id, 'u1', 2, NOW)).toBe('changed')
    expect(store.polls.results(poll.id)).toMatchObject({ counts: [1, 0, 1], total: 2 })
  })

  it('rejects invalid options, unknown polls and closed polls', () => {
    const poll = create(NOW + 1000)
    expect(store.polls.vote(poll.id, 'u1', 3, NOW)).toBe('invalid_option')
    expect(store.polls.vote(9999, 'u1', 0, NOW)).toBe('not_found')
    expect(store.polls.vote(poll.id, 'u1', 0, NOW + 1000)).toBe('closed')
  })

  it('only the author can close manually; the scheduler can close expired polls', () => {
    const manual = create()
    expect(store.polls.close(manual.id, NOW, { userId: 'intruder' })).toBe(false)
    expect(store.polls.close(manual.id, NOW, { userId: 'author' })).toBe(true)
    expect(store.polls.vote(manual.id, 'u1', 0, NOW)).toBe('closed')

    const timed = create(NOW - 1)
    expect(store.polls.expired(NOW).map((p) => p.id)).toEqual([timed.id])
    expect(store.polls.close(timed.id, NOW)).toBe(true)
    expect(store.polls.expired(NOW)).toEqual([])
    expect(store.polls.countOpen()).toBe(0)
  })

  it('stores the message id once the poll is posted', () => {
    const poll = create()
    store.polls.attachMessage(poll.id, 'm-123')
    expect(store.polls.get(poll.id)?.messageId).toBe('m-123')
  })
})

describe('StatsRepository', () => {
  it('summarises guild activity with top channels/members and gap-filled days', () => {
    const rec = (channelId: string, userId: string, daysAgo: number, n: number) => {
      store.stats.recordMessage({ guildId: 'g1', channelId, userId, at: NOW - daysAgo * DAY_MS }, n)
    }
    rec('general', 'alice', 0, 10)
    rec('general', 'alice', 0, 5) // same bucket: increments
    rec('general', 'bob', 1, 7)
    rec('random', 'carol', 3, 4)
    rec('random', 'carol', 30, 100) // outside 7-day window
    store.stats.recordMessage({ guildId: 'other', channelId: 'x', userId: 'alice', at: NOW }, 50)

    const a = store.stats.guildActivity('g1', 7, NOW, 2)
    expect(a.total).toBe(26)
    expect(a.activeMembers).toBe(3)
    expect(a.topChannels).toEqual([
      { channelId: 'general', count: 22 },
      { channelId: 'random', count: 4 },
    ])
    expect(a.topMembers).toEqual([
      { userId: 'alice', count: 15 },
      { userId: 'bob', count: 7 },
    ])
    expect(a.daily).toHaveLength(7)
    expect(a.daily.at(-1)).toEqual({ day: '2026-03-10', count: 15 })
    expect(a.daily.at(-3)).toEqual({ day: '2026-03-08', count: 0 })
  })

  it('aggregates command usage, failures and latency', () => {
    const cmd = (command: string, success: boolean, durationMs: number, usedAt = NOW) => {
      store.stats.recordCommand({ guildId: 'g1', userId: 'u', command, subcommand: null, success, durationMs, usedAt })
    }
    cmd('ping', true, 2)
    cmd('ping', true, 4)
    cmd('poll', false, 30)
    cmd('ping', true, 1, NOW - 40 * DAY_MS)

    expect(store.stats.commandUsage(NOW - 7 * DAY_MS)).toEqual([
      { command: 'ping', uses: 2, failures: 0, avgMs: 3 },
      { command: 'poll', uses: 1, failures: 1, avgMs: 30 },
    ])
    expect(store.stats.dailyCommands(3, NOW).at(-1)).toEqual({ day: '2026-03-10', count: 3 })
    expect(store.stats.recentCommands(1)[0]).toMatchObject({ command: 'poll', success: false })

    expect(store.stats.prune(30, NOW)).toEqual({ messageRows: 0, commandRows: 1 })
  })

  it('fillDays produces one bucket per day oldest-first', () => {
    expect(fillDays([{ day: '2026-03-09', count: 2 }], 3, NOW)).toEqual([
      { day: '2026-03-08', count: 0 },
      { day: '2026-03-09', count: 2 },
      { day: '2026-03-10', count: 0 },
    ])
  })
})
