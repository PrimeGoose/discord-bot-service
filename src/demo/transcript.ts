/**
 * `npm run demo:commands` — a scripted, offline walkthrough of every slash command.
 * Uses the real dispatcher, handlers, SQLite store and scheduler; only the Discord
 * transport is replaced by a terminal renderer.
 */
import { pino } from 'pino'
import { reminderMessage } from '../bot/client.js'
import { Scheduler } from '../bot/scheduler.js'
import { Dispatcher } from '../commands/dispatcher.js'
import { commands, componentHandlers } from '../commands/index.js'
import type { CommandResponse, Services } from '../commands/types.js'
import { createStore } from '../db/store.js'
import { VERSION } from '../version.js'
import { fakeCommandContext, fakeComponentContext, type OptionValues } from './fake-context.js'
import { FIXTURE_GUILDS, FIXTURE_USERS } from './fixtures.js'
import { renderMarkup, renderResponse } from './render.js'
import { seedDemoData } from './seed.js'

const color = process.stdout.isTTY || process.env.FORCE_COLOR === '1'
const dim = (t: string) => (color ? `\u001b[2m${t}\u001b[0m` : t)
const bold = (t: string) => (color ? `\u001b[1m${t}\u001b[0m` : t)
const accent = (t: string) => (color ? `\u001b[38;5;141m${t}\u001b[0m` : t)

let clock = Date.parse('2026-10-05T10:00:00Z')
const store = createStore(':memory:')
seedDemoData(store, clock)
const services: Services = {
  store,
  logger: pino({ level: 'silent' }),
  now: () => clock,
  runtime: () => ({ demo: true, startedAt: clock - 4 * 3_600_000 - 12 * 60_000, wsPingMs: null, guildCount: FIXTURE_GUILDS.length, version: VERSION }),
}
const dispatcher = new Dispatcher(commands, componentHandlers)
const guildFixture = FIXTURE_GUILDS[1] ?? FIXTURE_GUILDS[0]
if (!guildFixture?.channels[2]) throw new Error('fixtures missing')
const guild = { id: guildFixture.id, name: guildFixture.name }
const channel = guildFixture.channels[2]
const [ava, ben] = FIXTURE_USERS
if (!ava || !ben) throw new Error('fixtures missing')

const show = (r: CommandResponse) => {
  console.log(renderResponse(r, { now: clock, color }).replace(/^/gm, '  '))
  console.log()
}

async function slash(user: { id: string; username: string }, command: string, options: OptionValues = {}) {
  const shown = Object.entries(options)
    .filter(([k]) => k !== 'subcommand')
    .map(([k, v]) => `${k}:${String(v)}`)
  const sub = options.subcommand ? ` ${options.subcommand}` : ''
  console.log(`${accent(`@${user.username}`)} ${dim('used')} ${bold(`/${command}${sub}`)} ${dim(shown.join(' '))}`)
  const r = await dispatcher.runCommand(fakeCommandContext(services, { command, options, user, guild, channelId: channel.id }))
  show(r)
  return r
}

async function click(user: { id: string; username: string }, customId: string, label: string) {
  console.log(`${accent(`@${user.username}`)} ${dim('clicked')} ${bold(`[ ${label} ]`)}`)
  const result = await dispatcher.runComponent(fakeComponentContext(services, customId, user))
  if (result.reply) show(result.reply)
  return result
}

console.log()
console.log(bold(`🧰 Server Toolkit v${VERSION} — offline command walkthrough`))
console.log(dim(`   demo mode · in-memory SQLite seeded with fictional servers · #${channel.name} in ${guild.name}`))
console.log()

await slash(ava, 'help')
await slash(ava, 'ping')
await slash(ava, 'remind', { subcommand: 'set', in: '25m', message: 'Submit the jam build before the deadline' })
await slash(ava, 'remind', { subcommand: 'set', in: 'whenever', message: 'oops' })
const poll = await slash(ben, 'poll', { question: 'Which engine for the next jam?', options: 'Godot | Unity | Bevy | Love2D', duration: '1d' })
poll.onPosted?.('demo-message-1')
const firstButton = poll.components?.[0]?.toJSON().components[0]
const pollId = Number((firstButton && 'custom_id' in firstButton ? firstButton.custom_id : '').split(':')[2])
await click(ava, `poll:vote:${pollId}:0`, '1. Godot')
for (const [i, u] of FIXTURE_USERS.slice(2, 9).entries()) {
  await dispatcher.runComponent(fakeComponentContext(services, `poll:vote:${pollId}:${i % 3 === 2 ? 2 : i % 2}`, u))
}
const update = await click(ben, `poll:vote:${pollId}:2`, '3. Bevy')
if (update.update) {
  console.log(dim('  poll message updates live:'))
  show(update.update)
}
await slash(ava, 'stats', { days: 7 })

clock += 25 * 60_000
console.log(dim('⏩ 25 minutes later… the scheduler wakes up'))
const scheduler = new Scheduler(store, {
  sendReminder: (reminder) => {
    console.log(`${accent('Server Toolkit')} ${dim('BOT')} ${dim('in')} #${channel.name}`)
    show(reminderMessage(reminder))
    return Promise.resolve()
  },
  updatePollMessage: () => Promise.resolve(),
}, services.logger, () => clock, { intervalMs: 60_000 })
const tick = await scheduler.tick()
console.log(dim(renderMarkup(`  scheduler: ${tick.remindersDelivered} reminder(s) delivered, ${tick.pollsClosed} poll(s) closed`, { now: clock })))
console.log()
store.close()
