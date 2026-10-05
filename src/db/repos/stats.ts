import type { Database } from '../database.js'

export const DAY_MS = 86_400_000
export const utcDay = (at: number): string => new Date(at).toISOString().slice(0, 10)

export interface CommandUsageInput {
  guildId: string | null
  userId: string
  command: string
  subcommand: string | null
  success: boolean
  durationMs: number
  usedAt: number
}

export interface GuildActivity {
  total: number
  activeMembers: number
  topChannels: { channelId: string; count: number }[]
  topMembers: { userId: string; count: number }[]
  daily: { day: string; count: number }[]
}

export interface CommandStat {
  command: string
  uses: number
  failures: number
  avgMs: number
}

export interface RecentCommand {
  guildName: string | null
  command: string
  subcommand: string | null
  success: boolean
  durationMs: number
  usedAt: number
}

/** Fill gaps so charts get one bucket per day, oldest first. */
export function fillDays(rows: { day: string; count: number }[], days: number, now: number): { day: string; count: number }[] {
  const byDay = new Map(rows.map((r) => [r.day, r.count]))
  return Array.from({ length: days }, (_, i) => {
    const day = utcDay(now - (days - 1 - i) * DAY_MS)
    return { day, count: byDay.get(day) ?? 0 }
  })
}

export class StatsRepository {
  constructor(private readonly db: Database) {}

  /** Increment the per-day counter. Only IDs + a count are stored — never content. */
  recordMessage(m: { guildId: string; channelId: string; userId: string; at: number }, increment = 1): void {
    this.db.run(
      `INSERT INTO message_counts (guild_id, channel_id, user_id, day, count) VALUES (:guildId, :channelId, :userId, :day, :inc)
       ON CONFLICT (guild_id, channel_id, user_id, day) DO UPDATE SET count = count + excluded.count`,
      { guildId: m.guildId, channelId: m.channelId, userId: m.userId, day: utcDay(m.at), inc: increment },
    )
  }

  recordCommand(u: CommandUsageInput): void {
    this.db.run(
      `INSERT INTO command_usage (guild_id, user_id, command, subcommand, success, duration_ms, used_at)
       VALUES (:guildId, :userId, :command, :subcommand, :success, :durationMs, :usedAt)`,
      { ...u, success: u.success ? 1 : 0 },
    )
  }

  guildActivity(guildId: string, days: number, now: number, top = 5): GuildActivity {
    const params = { guildId, sinceDay: utcDay(now - (days - 1) * DAY_MS) }
    const where = 'guild_id = :guildId AND day >= :sinceDay'
    const totals = this.db.get<{ total: number | null; members: number }>(
      `SELECT SUM(count) AS total, COUNT(DISTINCT user_id) AS members FROM message_counts WHERE ${where}`,
      params,
    )
    return {
      total: totals?.total ?? 0,
      activeMembers: totals?.members ?? 0,
      topChannels: this.db.all<{ channelId: string; count: number }>(
        `SELECT channel_id AS channelId, SUM(count) AS count FROM message_counts WHERE ${where}
         GROUP BY channel_id ORDER BY count DESC, channel_id LIMIT :top`,
        { ...params, top },
      ),
      topMembers: this.db.all<{ userId: string; count: number }>(
        `SELECT user_id AS userId, SUM(count) AS count FROM message_counts WHERE ${where}
         GROUP BY user_id ORDER BY count DESC, user_id LIMIT :top`,
        { ...params, top },
      ),
      daily: fillDays(
        this.db.all<{ day: string; count: number }>(
          `SELECT day, SUM(count) AS count FROM message_counts WHERE ${where} GROUP BY day`,
          params,
        ),
        days,
        now,
      ),
    }
  }

  /** Messages per day across all guilds (or one guild). */
  dailyMessages(days: number, now: number, guildId?: string): { day: string; count: number }[] {
    const rows = this.db.all<{ day: string; count: number }>(
      `SELECT day, SUM(count) AS count FROM message_counts
       WHERE day >= :sinceDay ${guildId ? 'AND guild_id = :guildId' : ''} GROUP BY day`,
      { sinceDay: utcDay(now - (days - 1) * DAY_MS), ...(guildId ? { guildId } : {}) },
    )
    return fillDays(rows, days, now)
  }

  dailyCommands(days: number, now: number): { day: string; count: number }[] {
    const since = Date.parse(`${utcDay(now - (days - 1) * DAY_MS)}T00:00:00Z`)
    const rows = this.db.all<{ day: string; count: number }>(
      `SELECT strftime('%Y-%m-%d', used_at / 1000, 'unixepoch') AS day, COUNT(*) AS count
       FROM command_usage WHERE used_at >= :since GROUP BY day`,
      { since },
    )
    return fillDays(rows, days, now)
  }

  commandUsage(since: number, guildId?: string): CommandStat[] {
    return this.db
      .all<{ command: string; uses: number; failures: number; avg_ms: number }>(
        `SELECT command, COUNT(*) AS uses, SUM(success = 0) AS failures, AVG(duration_ms) AS avg_ms
         FROM command_usage WHERE used_at >= :since ${guildId ? 'AND guild_id = :guildId' : ''}
         GROUP BY command ORDER BY uses DESC, command`,
        { since, ...(guildId ? { guildId } : {}) },
      )
      .map((r) => ({ command: r.command, uses: r.uses, failures: r.failures, avgMs: Math.round(r.avg_ms) }))
  }

  recentCommands(limit = 10): RecentCommand[] {
    return this.db
      .all<{ guild_name: string | null; command: string; subcommand: string | null; success: number; duration_ms: number; used_at: number }>(
        `SELECT g.name AS guild_name, c.command, c.subcommand, c.success, c.duration_ms, c.used_at
         FROM command_usage c LEFT JOIN guilds g ON g.id = c.guild_id
         ORDER BY c.used_at DESC, c.id DESC LIMIT :limit`,
        { limit },
      )
      .map((r) => ({
        guildName: r.guild_name,
        command: r.command,
        subcommand: r.subcommand,
        success: r.success === 1,
        durationMs: r.duration_ms,
        usedAt: r.used_at,
      }))
  }

  /** Data retention: drop counters/usage rows older than `days`. */
  prune(days: number, now: number): { messageRows: number; commandRows: number } {
    const cutoff = now - days * DAY_MS
    return {
      messageRows: this.db.run('DELETE FROM message_counts WHERE day < :day', { day: utcDay(cutoff) }).changes,
      commandRows: this.db.run('DELETE FROM command_usage WHERE used_at < :cutoff', { cutoff }).changes,
    }
  }
}
