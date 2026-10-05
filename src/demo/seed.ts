import { DAY_MS } from '../db/repos/stats.js'
import type { Store } from '../db/store.js'
import { DEMO_USER, FIXTURE_GUILDS, FIXTURE_LEFT_GUILD, FIXTURE_USERS, type FixtureGuild } from './fixtures.js'

/** Small deterministic PRNG so every demo run (and screenshot) looks the same. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Pick an index with Zipf-like weights (first items much more popular). */
export function zipfIndex(rand: () => number, n: number, s = 1.1): number {
  const weights = Array.from({ length: n }, (_, i) => 1 / (i + 1) ** s)
  let r = rand() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < n; i++) {
    r -= weights[i] ?? 0
    if (r <= 0) return i
  }
  return n - 1
}

const COMMAND_MIX: [string, string | null, number][] = [
  ['remind', 'set', 22],
  ['remind', 'list', 6],
  ['remind', 'cancel', 2],
  ['stats', null, 24],
  ['poll', null, 18],
  ['ping', null, 16],
  ['help', null, 12],
]

function pickCommand(rand: () => number): [string, string | null] {
  const total = COMMAND_MIX.reduce((s, [, , w]) => s + w, 0)
  let r = rand() * total
  for (const [name, sub, w] of COMMAND_MIX) {
    r -= w
    if (r <= 0) return [name, sub]
  }
  return ['ping', null]
}

export interface SeedSummary {
  guilds: number
  messageRows: number
  commands: number
  reminders: number
  polls: number
}

/**
 * Fill the store with ~30 days of believable activity relative to `now`, so the
 * dashboard and /stats look alive without a Discord connection.
 */
export function seedDemoData(store: Store, now: number, days = 30, seed = 2026): SeedSummary {
  const rand = mulberry32(seed)
  const summary: SeedSummary = { guilds: 0, messageRows: 0, commands: 0, reminders: 0, polls: 0 }

  store.db.transaction(() => {
    const all: FixtureGuild[] = [...FIXTURE_GUILDS, FIXTURE_LEFT_GUILD]
    for (const [i, g] of all.entries()) {
      store.guilds.upsert({ id: g.id, name: g.name, memberCount: g.memberCount }, now - (days + 30 - i * 7) * DAY_MS)
      summary.guilds++
    }
    store.guilds.markLeft(FIXTURE_LEFT_GUILD.id, now - 12 * DAY_MS)

    for (const g of FIXTURE_GUILDS) {
      const memberPool = FIXTURE_USERS.slice(0, Math.max(6, Math.min(FIXTURE_USERS.length, Math.round(g.memberCount / 80))))
      for (let d = days - 1; d >= 0; d--) {
        const at = now - d * DAY_MS
        const weekday = new Date(at).getUTCDay()
        const weekend = weekday === 0 || weekday === 6 ? 1.35 : 1
        const growth = 0.75 + 0.25 * ((days - d) / days) // gentle upward trend
        const target = Math.round(g.dailyMessages * weekend * growth * (0.8 + rand() * 0.4))

        // Spread the day's messages over (channel, member) buckets.
        let remaining = target
        while (remaining > 0) {
          const chunk = Math.min(remaining, 1 + Math.floor(rand() * 25))
          const channel = g.channels[zipfIndex(rand, g.channels.length, 0.9)] ?? g.channels[0]
          const member = memberPool[zipfIndex(rand, memberPool.length)] ?? DEMO_USER
          if (channel) store.stats.recordMessage({ guildId: g.id, channelId: channel.id, userId: member.id, at }, chunk)
          summary.messageRows++
          remaining -= chunk
        }

        const commandsToday = Math.round((g.dailyMessages / 30) * weekend * growth * (0.6 + rand() * 0.8))
        for (let c = 0; c < commandsToday; c++) {
          const [command, subcommand] = pickCommand(rand)
          const member = memberPool[Math.floor(rand() * memberPool.length)] ?? DEMO_USER
          store.stats.recordCommand({
            guildId: g.id,
            userId: member.id,
            command,
            subcommand,
            success: rand() > 0.015,
            durationMs: Math.round(2 + rand() * (command === 'stats' ? 28 : 9)),
            usedAt: Math.min(now - 60_000, at - Math.floor(rand() * DAY_MS * 0.9)),
          })
          summary.commands++
        }
      }
    }

    // A few reminders: pending ones keep the dashboard counters interesting.
    const reminderTexts = [
      'Post the weekly devlog',
      'Review jam submissions',
      'Book the trail-run carpool',
      'Export stems for the collab',
      'Rotate the TypeScript challenge',
      'Order pizza for game night',
    ]
    for (const [i, text] of reminderTexts.entries()) {
      const g = FIXTURE_GUILDS[i % FIXTURE_GUILDS.length]
      const user = FIXTURE_USERS[i] ?? DEMO_USER
      if (!g?.channels[0]) continue
      const r = store.reminders.create({
        guildId: g.id,
        channelId: g.channels[0].id,
        userId: user.id,
        message: text,
        remindAt: now + (i + 1) * 47 * 60_000,
        createdAt: now - (i + 1) * 3_600_000,
      })
      summary.reminders++
      if (i === reminderTexts.length - 1) store.reminders.markDelivered(r.id, now)
    }

    // Polls with votes: two open, one closed.
    const polls: { g: number; q: string; options: string[]; closesInMs: number | null; closed?: boolean }[] = [
      { g: 1, q: 'Theme for the next jam?', options: ['Tiny worlds', 'Out of control', 'Echoes', 'One button'], closesInMs: 2 * DAY_MS },
      { g: 0, q: 'Monthly challenge genre', options: ['Outrun', 'Darksynth', 'Dreamwave'], closesInMs: null },
      { g: 4, q: 'Next game night pick', options: ['Wingspan', 'Azul', 'Root'], closesInMs: -DAY_MS, closed: true },
    ]
    for (const spec of polls) {
      const g = FIXTURE_GUILDS[spec.g]
      const channel = g?.channels[0]
      if (!g || !channel) continue
      const poll = store.polls.create({
        guildId: g.id,
        channelId: channel.id,
        authorId: (FIXTURE_USERS[spec.g + 2] ?? DEMO_USER).id,
        question: spec.q,
        options: spec.options,
        createdAt: now - 3 * DAY_MS,
        closesAt: spec.closesInMs === null ? null : now + spec.closesInMs,
      })
      for (const user of FIXTURE_USERS) {
        if (rand() < 0.75) store.polls.vote(poll.id, user.id, zipfIndex(rand, spec.options.length, 0.7), now - 2 * DAY_MS)
      }
      if (spec.closed) store.polls.close(poll.id, now - DAY_MS)
      summary.polls++
    }
  })

  return summary
}
