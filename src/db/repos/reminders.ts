import type { Database } from '../database.js'

export interface Reminder {
  id: number
  guildId: string | null
  channelId: string
  userId: string
  message: string
  remindAt: number
  createdAt: number
}

interface ReminderRow {
  id: number
  guild_id: string | null
  channel_id: string
  user_id: string
  message: string
  remind_at: number
  created_at: number
}

const toReminder = (r: ReminderRow): Reminder => ({
  id: r.id,
  guildId: r.guild_id,
  channelId: r.channel_id,
  userId: r.user_id,
  message: r.message,
  remindAt: r.remind_at,
  createdAt: r.created_at,
})

const PENDING = 'delivered_at IS NULL AND cancelled_at IS NULL'

export class ReminderRepository {
  constructor(private readonly db: Database) {}

  create(input: Omit<Reminder, 'id'>): Reminder {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO reminders (guild_id, channel_id, user_id, message, remind_at, created_at)
       VALUES (:guildId, :channelId, :userId, :message, :remindAt, :createdAt)`,
      { ...input },
    )
    return { id: lastInsertRowid, ...input }
  }

  listPendingForUser(userId: string, limit = 10): Reminder[] {
    return this.db
      .all<ReminderRow>(`SELECT * FROM reminders WHERE user_id = :userId AND ${PENDING} ORDER BY remind_at LIMIT :limit`, {
        userId,
        limit,
      })
      .map(toReminder)
  }

  countPendingForUser(userId: string): number {
    return this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM reminders WHERE user_id = :userId AND ${PENDING}`, { userId })?.n ?? 0
  }

  /** Users may only cancel their own reminders. Returns false if not found / not theirs / already done. */
  cancel(id: number, userId: string, now: number): boolean {
    return (
      this.db.run(`UPDATE reminders SET cancelled_at = :now WHERE id = :id AND user_id = :userId AND ${PENDING}`, {
        id,
        userId,
        now,
      }).changes === 1
    )
  }

  due(now: number, limit = 50): Reminder[] {
    return this.db
      .all<ReminderRow>(`SELECT * FROM reminders WHERE ${PENDING} AND remind_at <= :now ORDER BY remind_at LIMIT :limit`, {
        now,
        limit,
      })
      .map(toReminder)
  }

  markDelivered(id: number, now: number): void {
    this.db.run('UPDATE reminders SET delivered_at = :now WHERE id = :id', { id, now })
  }

  countPending(): number {
    return this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM reminders WHERE ${PENDING}`)?.n ?? 0
  }
}
