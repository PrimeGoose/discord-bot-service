import { describe, expect, it } from 'vitest'
import { FIXTURE_GUILDS, FIXTURE_LEFT_GUILD } from '../src/demo/fixtures.js'
import { mulberry32, seedDemoData, zipfIndex } from '../src/demo/seed.js'
import { DAY_MS } from '../src/db/repos/stats.js'
import { memoryStore, NOW } from './helpers.js'

describe('demo seed', () => {
  it('creates a believable, deterministic dataset relative to now', () => {
    const a = memoryStore()
    const b = memoryStore()
    const summaryA = seedDemoData(a, NOW)
    const summaryB = seedDemoData(b, NOW)
    expect(summaryA).toEqual(summaryB)

    const overview = a.guilds.overview(NOW)
    expect(overview.map((g) => g.name)).toEqual(FIXTURE_GUILDS.map((g) => g.name)) // ordered by activity
    expect(overview.map((g) => g.id)).not.toContain(FIXTURE_LEFT_GUILD.id)
    expect(overview.every((g) => g.messages7d > 0 && g.commands7d > 0)).toBe(true)

    expect(a.stats.dailyMessages(30, NOW).every((d) => d.count > 0)).toBe(true)
    expect(a.stats.commandUsage(NOW - 30 * DAY_MS).map((c) => c.command).sort()).toEqual(['help', 'ping', 'poll', 'remind', 'stats'])
    expect(a.reminders.countPending()).toBe(5)
    expect(a.polls.countOpen()).toBe(2)
    expect(a.polls.results(1)?.total).toBeGreaterThan(5)
    a.close()
    b.close()
  })

  it('PRNG and zipf helpers are stable and in range', () => {
    const rand = mulberry32(1)
    const values = Array.from({ length: 1000 }, rand)
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true)
    expect(mulberry32(1)()).toBe(values[0])
    const picks = Array.from({ length: 2000 }, () => zipfIndex(rand, 5))
    const counts = [0, 1, 2, 3, 4].map((i) => picks.filter((p) => p === i).length)
    expect(counts[0]).toBeGreaterThan(counts[4] ?? 0)
  })
})
