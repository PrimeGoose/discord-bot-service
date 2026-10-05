import type { Database } from '../database.js'

export interface Poll {
  id: number
  guildId: string
  channelId: string
  messageId: string | null
  authorId: string
  question: string
  options: string[]
  createdAt: number
  closesAt: number | null
  closedAt: number | null
}

export interface PollResults {
  poll: Poll
  counts: number[]
  total: number
}

interface PollRow {
  id: number
  guild_id: string
  channel_id: string
  message_id: string | null
  author_id: string
  question: string
  options: string
  created_at: number
  closes_at: number | null
  closed_at: number | null
}

const toPoll = (r: PollRow): Poll => ({
  id: r.id,
  guildId: r.guild_id,
  channelId: r.channel_id,
  messageId: r.message_id,
  authorId: r.author_id,
  question: r.question,
  options: JSON.parse(r.options) as string[],
  createdAt: r.created_at,
  closesAt: r.closes_at,
  closedAt: r.closed_at,
})

export type VoteOutcome = 'recorded' | 'changed' | 'unchanged' | 'closed' | 'not_found' | 'invalid_option'

export class PollRepository {
  constructor(private readonly db: Database) {}

  create(input: Omit<Poll, 'id' | 'messageId' | 'closedAt'>): Poll {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO polls (guild_id, channel_id, author_id, question, options, created_at, closes_at)
       VALUES (:guildId, :channelId, :authorId, :question, :options, :createdAt, :closesAt)`,
      { ...input, options: JSON.stringify(input.options) },
    )
    return { ...input, id: lastInsertRowid, messageId: null, closedAt: null }
  }

  attachMessage(id: number, messageId: string): void {
    this.db.run('UPDATE polls SET message_id = :messageId WHERE id = :id', { id, messageId })
  }

  get(id: number): Poll | undefined {
    const row = this.db.get<PollRow>('SELECT * FROM polls WHERE id = :id', { id })
    return row ? toPoll(row) : undefined
  }

  /** One vote per user; voting again for a different option moves the vote. */
  vote(pollId: number, userId: string, optionIndex: number, now: number): VoteOutcome {
    return this.db.transaction(() => {
      const poll = this.get(pollId)
      if (!poll) return 'not_found'
      if (poll.closedAt !== null || (poll.closesAt !== null && poll.closesAt <= now)) return 'closed'
      if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) return 'invalid_option'
      const existing = this.db.get<{ option_index: number }>(
        'SELECT option_index FROM poll_votes WHERE poll_id = :pollId AND user_id = :userId',
        { pollId, userId },
      )
      if (existing?.option_index === optionIndex) return 'unchanged'
      this.db.run(
        `INSERT INTO poll_votes (poll_id, user_id, option_index, voted_at) VALUES (:pollId, :userId, :optionIndex, :now)
         ON CONFLICT (poll_id, user_id) DO UPDATE SET option_index = excluded.option_index, voted_at = excluded.voted_at`,
        { pollId, userId, optionIndex, now },
      )
      return existing ? 'changed' : 'recorded'
    })
  }

  results(pollId: number): PollResults | undefined {
    const poll = this.get(pollId)
    if (!poll) return undefined
    const counts = poll.options.map(() => 0)
    for (const row of this.db.all<{ option_index: number; n: number }>(
      'SELECT option_index, COUNT(*) AS n FROM poll_votes WHERE poll_id = :pollId GROUP BY option_index',
      { pollId },
    )) {
      if (row.option_index < counts.length) counts[row.option_index] = row.n
    }
    return { poll, counts, total: counts.reduce((a, b) => a + b, 0) }
  }

  /** Close a poll. Only the author (or the scheduler, with `force`) may close it. */
  close(pollId: number, now: number, by?: { userId: string }): boolean {
    const authorClause = by ? 'AND author_id = :userId' : ''
    return (
      this.db.run(`UPDATE polls SET closed_at = :now WHERE id = :pollId AND closed_at IS NULL ${authorClause}`, {
        pollId,
        now,
        ...(by ? { userId: by.userId } : {}),
      }).changes === 1
    )
  }

  expired(now: number, limit = 50): Poll[] {
    return this.db
      .all<PollRow>(
        'SELECT * FROM polls WHERE closed_at IS NULL AND closes_at IS NOT NULL AND closes_at <= :now ORDER BY closes_at LIMIT :limit',
        { now, limit },
      )
      .map(toPoll)
  }

  countOpen(): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM polls WHERE closed_at IS NULL')?.n ?? 0
  }
}
