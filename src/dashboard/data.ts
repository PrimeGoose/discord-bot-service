import type { RuntimeInfo } from '../commands/types.js'
import type { GuildOverview } from '../db/repos/guilds.js'
import { DAY_MS, type CommandStat, type RecentCommand } from '../db/repos/stats.js'
import type { Store } from '../db/store.js'

export interface DashboardData {
  generatedAt: number
  runtime: RuntimeInfo
  kpis: {
    servers: number
    members: number
    messages7d: number
    messagesPrev7d: number
    commands7d: number
    commandsPrev7d: number
    pendingReminders: number
    openPolls: number
  }
  activity: { day: string; messages: number; commands: number }[]
  commandUsage: CommandStat[]
  guilds: (GuildOverview & { trend: number[] })[]
  recent: RecentCommand[]
}

const sum = (xs: { count: number }[]) => xs.reduce((s, x) => s + x.count, 0)

/** Everything the dashboard shows, in one read-only snapshot (also served as JSON). */
export function collectDashboardData(store: Store, now: number, runtime: RuntimeInfo, days = 30): DashboardData {
  const messages = store.stats.dailyMessages(days, now)
  const commands = store.stats.dailyCommands(days, now)
  const guilds = store.guilds.overview(now)
  const last14 = store.stats.dailyMessages(14, now)
  const commands14 = store.stats.dailyCommands(14, now)

  return {
    generatedAt: now,
    runtime,
    kpis: {
      servers: guilds.length,
      members: guilds.reduce((s, g) => s + g.memberCount, 0),
      messages7d: sum(last14.slice(7)),
      messagesPrev7d: sum(last14.slice(0, 7)),
      commands7d: sum(commands14.slice(7)),
      commandsPrev7d: sum(commands14.slice(0, 7)),
      pendingReminders: store.reminders.countPending(),
      openPolls: store.polls.countOpen(),
    },
    activity: messages.map((m, i) => ({ day: m.day, messages: m.count, commands: commands[i]?.count ?? 0 })),
    commandUsage: store.stats.commandUsage(now - 7 * DAY_MS),
    guilds: guilds.map((g) => ({ ...g, trend: store.stats.dailyMessages(14, now, g.id).map((d) => d.count) })),
    recent: store.stats.recentCommands(12),
  }
}
