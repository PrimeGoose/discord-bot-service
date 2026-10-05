/**
 * Forward-only migrations. Each entry runs once inside a transaction and is
 * recorded in `schema_migrations`. Never edit a shipped migration — append one.
 */
export const migrations: readonly { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE guilds (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        member_count  INTEGER NOT NULL DEFAULT 0,
        joined_at     INTEGER NOT NULL,
        left_at       INTEGER
      );

      CREATE TABLE reminders (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id      TEXT,
        channel_id    TEXT NOT NULL,
        user_id       TEXT NOT NULL,
        message       TEXT NOT NULL,
        remind_at     INTEGER NOT NULL,
        created_at    INTEGER NOT NULL,
        delivered_at  INTEGER,
        cancelled_at  INTEGER
      );
      CREATE INDEX reminders_pending ON reminders (remind_at)
        WHERE delivered_at IS NULL AND cancelled_at IS NULL;
      CREATE INDEX reminders_user ON reminders (user_id);

      CREATE TABLE polls (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id      TEXT NOT NULL,
        channel_id    TEXT NOT NULL,
        message_id    TEXT,
        author_id     TEXT NOT NULL,
        question      TEXT NOT NULL,
        options       TEXT NOT NULL,           -- JSON array of strings
        created_at    INTEGER NOT NULL,
        closes_at     INTEGER,
        closed_at     INTEGER
      );
      CREATE INDEX polls_open ON polls (closes_at) WHERE closed_at IS NULL;

      CREATE TABLE poll_votes (
        poll_id       INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
        user_id       TEXT NOT NULL,
        option_index  INTEGER NOT NULL,
        voted_at      INTEGER NOT NULL,
        PRIMARY KEY (poll_id, user_id)
      );

      -- Aggregated counters only: the bot never stores message content.
      CREATE TABLE message_counts (
        guild_id      TEXT NOT NULL,
        channel_id    TEXT NOT NULL,
        user_id       TEXT NOT NULL,
        day           TEXT NOT NULL,           -- YYYY-MM-DD (UTC)
        count         INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, channel_id, user_id, day)
      );
      CREATE INDEX message_counts_day ON message_counts (day);

      CREATE TABLE command_usage (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id      TEXT,
        user_id       TEXT NOT NULL,
        command       TEXT NOT NULL,
        subcommand    TEXT,
        success       INTEGER NOT NULL,
        duration_ms   INTEGER NOT NULL,
        used_at       INTEGER NOT NULL
      );
      CREATE INDEX command_usage_used_at ON command_usage (used_at);
    `,
  },
]
