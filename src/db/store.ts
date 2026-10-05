import { Database } from './database.js'
import { GuildRepository } from './repos/guilds.js'
import { PollRepository } from './repos/polls.js'
import { ReminderRepository } from './repos/reminders.js'
import { StatsRepository } from './repos/stats.js'

export interface Store {
  db: Database
  guilds: GuildRepository
  reminders: ReminderRepository
  polls: PollRepository
  stats: StatsRepository
  close(): void
}

export function createStore(path: string): Store {
  const db = new Database(path)
  return {
    db,
    guilds: new GuildRepository(db),
    reminders: new ReminderRepository(db),
    polls: new PollRepository(db),
    stats: new StatsRepository(db),
    close: () => {
      db.close()
    },
  }
}
