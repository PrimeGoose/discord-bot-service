import type { Database } from '../database.js'

export interface GuildRecord {
  id: string
  name: string
  memberCount: number
  joinedAt: number
  leftAt: number | null
}

export interface GuildOverview extends GuildRecord {
  messages7d: number
  commands7d: number
  activeReminders: number
  openPolls: number
}

interface GuildRow {
  id: string
  name: string
  member_count: number
  joined_at: number
  left_at: number | null
}

const toRecord = (r: GuildRow): GuildRecord => ({
  id: r.id,
  name: r.name,
  memberCount: r.member_count,
  joinedAt: r.joined_at,
  leftAt: r.left_at,
})

export class GuildRepository {
  constructor(private readonly db: Database) {}

  /** Called on `ready` / `guildCreate` / `guildUpdate`. Re-joining clears `left_at`. */
  upsert(guild: { id: string; name: string; memberCount: number }, now: number): void {
    this.db.run(
      `INSERT INTO guilds (id, name, member_count, joined_at) VALUES (:id, :name, :members, :now)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         member_count = excluded.member_count,
         joined_at = CASE WHEN guilds.left_at IS NOT NULL THEN excluded.joined_at ELSE guilds.joined_at END,
         left_at = NULL`,
      { id: guild.id, name: guild.name, members: guild.memberCount, now },
    )
  }

  markLeft(id: string, now: number): void {
    this.db.run('UPDATE guilds SET left_at = :now WHERE id = :id', { id, now })
  }

  get(id: string): GuildRecord | undefined {
    const row = this.db.get<GuildRow>('SELECT * FROM guilds WHERE id = :id', { id })
    return row ? toRecord(row) : undefined
  }

  /** Guilds the bot is currently in, with 7-day activity for the dashboard. */
  overview(now: number): GuildOverview[] {
    const since = now - 7 * 86_400_000
    const sinceDay = new Date(since).toISOString().slice(0, 10)
    const rows = this.db.all<GuildRow & { messages_7d: number; commands_7d: number; active_reminders: number; open_polls: number }>(
      `SELECT g.*,
         COALESCE((SELECT SUM(count) FROM message_counts m WHERE m.guild_id = g.id AND m.day >= :sinceDay), 0) AS messages_7d,
         (SELECT COUNT(*) FROM command_usage c WHERE c.guild_id = g.id AND c.used_at >= :since) AS commands_7d,
         (SELECT COUNT(*) FROM reminders r WHERE r.guild_id = g.id AND r.delivered_at IS NULL AND r.cancelled_at IS NULL) AS active_reminders,
         (SELECT COUNT(*) FROM polls p WHERE p.guild_id = g.id AND p.closed_at IS NULL) AS open_polls
       FROM guilds g
       WHERE g.left_at IS NULL
       ORDER BY messages_7d DESC, g.name`,
      { since, sinceDay },
    )
    return rows.map((r) => ({
      ...toRecord(r),
      messages7d: r.messages_7d,
      commands7d: r.commands_7d,
      activeReminders: r.active_reminders,
      openPolls: r.open_polls,
    }))
  }
}
