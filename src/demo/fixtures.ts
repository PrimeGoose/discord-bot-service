/**
 * Fictional servers, channels and members for demo mode. IDs are snowflake-shaped
 * but made up; nothing here comes from a real Discord server.
 */
export interface FixtureGuild {
  id: string
  name: string
  memberCount: number
  /** Average human messages per day. */
  dailyMessages: number
  channels: { id: string; name: string }[]
}

const snowflake = (prefix: number, n: number) => `${prefix}${String(n).padStart(17 - String(prefix).length + 1, '0')}`

const guild = (n: number, name: string, memberCount: number, dailyMessages: number, channels: string[]): FixtureGuild => ({
  id: snowflake(91, n),
  name,
  memberCount,
  dailyMessages,
  channels: channels.map((c, i) => ({ id: snowflake(92, n * 100 + i), name: c })),
})

export const FIXTURE_GUILDS: FixtureGuild[] = [
  guild(1, 'Synthwave Producers', 2310, 940, ['general', 'feedback', 'gear-talk', 'collabs', 'releases']),
  guild(2, 'Indie Game Jam', 1840, 720, ['general', 'team-finding', 'devlogs', 'art', 'audio', 'jam-announcements']),
  guild(3, 'TypeScript Study Group', 960, 410, ['general', 'help', 'type-challenges', 'show-and-tell']),
  guild(4, 'Trail Running Club', 420, 160, ['general', 'race-calendar', 'routes', 'gear']),
  guild(5, 'Board Game Night', 155, 55, ['general', 'scheduling', 'house-rules']),
]

/** A server the bot was removed from — shows that left guilds drop off the dashboard. */
export const FIXTURE_LEFT_GUILD: FixtureGuild = guild(9, 'Old Test Server', 3, 2, ['general'])

const NAMES = [
  'ava', 'ben', 'chloe', 'dev', 'elin', 'finn', 'gus', 'hana', 'ivo', 'jules', 'kai', 'lena', 'milo', 'nora',
  'oskar', 'pia', 'quinn', 'rafa', 'sami', 'tess', 'uma', 'vik', 'wren', 'xan', 'yara', 'zoe',
]

export const FIXTURE_USERS: { id: string; username: string }[] = NAMES.map((username, i) => ({
  id: snowflake(93, i + 1),
  username,
}))

export const DEMO_USER = FIXTURE_USERS[0] ?? { id: snowflake(93, 1), username: 'ava' }

/** Lookup tables so the terminal renderer can show #channel / @user instead of raw IDs. */
export const CHANNEL_NAMES = new Map(
  [...FIXTURE_GUILDS, FIXTURE_LEFT_GUILD].flatMap((g) => g.channels.map((c) => [c.id, c.name] as const)),
)
export const USER_NAMES = new Map(FIXTURE_USERS.map((u) => [u.id, u.username] as const))
