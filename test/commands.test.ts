import { SlashCommandBuilder, type EmbedBuilder } from 'discord.js'
import { pino } from 'pino'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commandPayload, commands, componentHandlers } from '../src/commands/index.js'
import { Dispatcher } from '../src/commands/dispatcher.js'
import { parsePollOptions } from '../src/commands/poll.js'
import { REMINDER_LIMITS } from '../src/commands/remind.js'
import type { CommandResponse, Services, SlashCommand } from '../src/commands/types.js'
import { UserFacingError } from '../src/commands/types.js'
import { DAY_MS } from '../src/db/repos/stats.js'
import type { Store } from '../src/db/store.js'
import { defaultRuntime, fakeCommandContext, fakeComponentContext, type FakeInvocation } from '../src/demo/fake-context.js'
import { memoryStore, NOW } from './helpers.js'

let store: Store
let services: Services
let clock: number
const dispatcher = new Dispatcher(commands, componentHandlers)

beforeEach(() => {
  store = memoryStore()
  clock = NOW
  services = { store, logger: pino({ level: 'silent' }), now: () => clock, runtime: () => defaultRuntime({ startedAt: NOW - 3_600_000 }) }
})
afterEach(() => {
  store.close()
})

const run = (inv: FakeInvocation) => dispatcher.runCommand(fakeCommandContext(services, inv))
const embed = (r: CommandResponse, i = 0) => (r.embeds?.[i] as EmbedBuilder).toJSON()
const fieldValue = (r: CommandResponse, name: string) => embed(r).fields?.find((f) => f.name === name)?.value

describe('command registry', () => {
  it('exposes the five slash commands with valid payloads', () => {
    const payload = commandPayload()
    expect(payload.map((c) => c.name).sort()).toEqual(['help', 'ping', 'poll', 'remind', 'stats'])
    for (const c of payload) {
      expect(c.description.length).toBeGreaterThan(0)
      expect(c.description.length).toBeLessThanOrEqual(100)
    }
  })
})

describe('/ping', () => {
  it('reports gateway, database and uptime', async () => {
    const r = await run({ command: 'ping' })
    expect(r.ephemeral).toBe(true)
    expect(embed(r).title).toContain('Pong')
    expect(fieldValue(r, 'Gateway')).toBe('demo (offline)')
    expect(fieldValue(r, 'Uptime')).toBe('1h')
    expect(store.stats.commandUsage(0)).toEqual([expect.objectContaining({ command: 'ping', uses: 1, failures: 0 })])
  })
})

describe('/remind', () => {
  it('creates a reminder and lists it', async () => {
    const r = await run({ command: 'remind', options: { subcommand: 'set', in: '1h30m', message: 'Stand-up notes' } })
    expect(embed(r).title).toBe('⏰ Reminder set')
    expect(fieldValue(r, 'In')).toBe('1h 30m')
    const [saved] = store.reminders.listPendingForUser('100000000000000001')
    expect(saved).toMatchObject({ message: 'Stand-up notes', remindAt: NOW + 5_400_000, guildId: '200000000000000001' })

    const list = await run({ command: 'remind', options: { subcommand: 'list' } })
    expect(embed(list).description).toContain('Stand-up notes')
  })

  it.each([
    [{ in: 'soonish', message: 'x' }, /couldn't understand/],
    [{ in: '2s', message: 'x' }, /between 10 seconds and 365 days/],
    [{ in: '400d', message: 'x' }, /between 10 seconds and 365 days/],
    [{ in: '10m', message: '   ' }, /1–500 characters/],
  ])('validates input %j', async (options, error) => {
    const r = await run({ command: 'remind', options: { subcommand: 'set', ...options } })
    expect(r).toMatchObject({ ephemeral: true })
    expect(r.content).toMatch(error)
    expect(store.reminders.countPending()).toBe(0)
  })

  it('caps pending reminders per user', async () => {
    for (let i = 0; i < REMINDER_LIMITS.maxPendingPerUser; i++) {
      store.reminders.create({ guildId: null, channelId: 'c', userId: '100000000000000001', message: 'x', remindAt: NOW + 1e6, createdAt: NOW })
    }
    const r = await run({ command: 'remind', options: { subcommand: 'set', in: '10m', message: 'one more' } })
    expect(r.content).toMatch(/already have 25 pending/)
  })

  it('cancels only your own reminders', async () => {
    const mine = store.reminders.create({ guildId: null, channelId: 'c', userId: '100000000000000001', message: 'x', remindAt: NOW + 1e6, createdAt: NOW })
    const theirs = store.reminders.create({ guildId: null, channelId: 'c', userId: 'someone', message: 'y', remindAt: NOW + 1e6, createdAt: NOW })
    expect((await run({ command: 'remind', options: { subcommand: 'cancel', id: theirs.id } })).content).toMatch(/No pending reminder/)
    expect((await run({ command: 'remind', options: { subcommand: 'cancel', id: mine.id } })).content).toMatch(/cancelled/)
  })

  it('handles an empty list', async () => {
    expect((await run({ command: 'remind', options: { subcommand: 'list' } })).content).toMatch(/no pending reminders/)
  })
})

describe('/poll', () => {
  it('parses options with separators, trimming and de-duplication', () => {
    expect(parsePollOptions(' Pizza | sushi ;Pizza\n Salad || ')).toEqual(['Pizza', 'sushi', 'Salad'])
  })

  it('creates a poll with a button per option and stores the message id', async () => {
    const r = await run({ command: 'poll', options: { question: 'Lunch?', options: 'Pizza | Sushi | Salad', duration: '1h' } })
    expect(embed(r).title).toBe('📊 Lunch?')
    const [voteRow, controlRow] = (r.components ?? []).map((row) => row.toJSON())
    expect(voteRow?.components).toHaveLength(3)
    expect(controlRow?.components).toHaveLength(1)
    r.onPosted?.('message-1')
    const [poll] = [store.polls.get(1)]
    expect(poll).toMatchObject({ messageId: 'message-1', closesAt: NOW + 3_600_000, options: ['Pizza', 'Sushi', 'Salad'] })
  })

  it.each([
    [{ question: 'Q', options: 'Only one' }, /2–5 distinct options/],
    [{ question: 'Q', options: 'a|b|c|d|e|f' }, /2–5 distinct options/],
    [{ question: 'Q', options: `a|${'b'.repeat(81)}` }, /at most 80/],
    [{ question: 'Q', options: 'a|b', duration: '10s' }, /between 1 minute and 7 days/],
  ])('validates %j', async (options, error) => {
    expect((await run({ command: 'poll', options })).content).toMatch(error)
  })

  it('is guild-only', async () => {
    expect((await run({ command: 'poll', guild: null, options: { question: 'Q', options: 'a|b' } })).content).toMatch(/inside a server/)
  })

  it('handles votes, vote changes and author-only closing via buttons', async () => {
    await run({ command: 'poll', options: { question: 'Lunch?', options: 'Pizza | Sushi' } })
    const press = (customId: string, userId = '100000000000000001') =>
      dispatcher.runComponent(fakeComponentContext(services, customId, { id: userId, username: userId }))

    const first = await press('poll:vote:1:0')
    expect(first.reply?.content).toMatch(/Vote recorded for \*\*Pizza\*\*/)
    expect((first.update?.embeds?.[0] as EmbedBuilder).toJSON().description).toContain('100% · 1 vote')

    expect((await press('poll:vote:1:1')).reply?.content).toMatch(/changed to \*\*Sushi\*\*/)
    await press('poll:vote:1:1', 'other-user')
    expect(store.polls.results(1)?.counts).toEqual([0, 2])

    expect((await press('poll:close:1', 'other-user')).reply?.content).toMatch(/Only the person who started/)
    const closed = await press('poll:close:1')
    expect(closed.update?.components).toEqual([])
    expect((closed.update?.embeds?.[0] as EmbedBuilder).toJSON().description).toContain('🏆')
    expect((await press('poll:vote:1:0')).reply?.content).toMatch(/closed/)
  })

  it('rejects unknown button ids', async () => {
    expect((await dispatcher.runComponent(fakeComponentContext(services, 'mystery:1'))).reply?.content).toMatch(/no longer supported/)
  })
})

describe('/stats', () => {
  it('summarises recorded activity for the current guild', async () => {
    const guildId = '200000000000000001'
    store.stats.recordMessage({ guildId, channelId: 'chan-general', userId: 'alice', at: NOW }, 30)
    store.stats.recordMessage({ guildId, channelId: 'chan-dev', userId: 'bob', at: NOW - DAY_MS }, 12)
    store.stats.recordMessage({ guildId: 'another-guild', channelId: 'x', userId: 'eve', at: NOW }, 500)
    await run({ command: 'ping' })

    const r = await run({ command: 'stats', options: { days: 7 } })
    expect(embed(r).title).toBe('📈 Demo Server — last 7 days')
    expect(fieldValue(r, 'Messages')).toBe('42')
    expect(fieldValue(r, 'Active members')).toBe('2')
    expect(fieldValue(r, 'Commands run')).toBe('1')
    expect(fieldValue(r, 'Top channels')).toBe('1. <#chan-general> — 30\n2. <#chan-dev> — 12')
    expect(embed(r).description).toMatch(/Daily activity `[▁-█]{7}`/)
  })

  it('explains when there is no data yet', async () => {
    const r = await run({ command: 'stats' })
    expect(embed(r).description).toMatch(/No messages recorded/)
  })
})

describe('/help', () => {
  it('lists every command grouped by category, including subcommands', async () => {
    const r = await run({ command: 'help' })
    const text = JSON.stringify(embed(r).fields)
    for (const name of ['/ping', '/remind set|list|cancel', '/poll', '/stats', '/help']) expect(text).toContain(name)
    expect(embed(r).fields?.map((f) => f.name)).toEqual(['Utility', 'Community', 'Insights'])
  })
})

const testCommand = (name: string, execute: SlashCommand['execute']): SlashCommand => ({
  category: 'Utility',
  data: new SlashCommandBuilder().setName(name).setDescription('test'),
  execute,
})

describe('Dispatcher error handling', () => {
  it('logs unexpected errors, returns a generic reply and records a failure', async () => {
    const boom = testCommand('boom', () => {
      throw new Error('database on fire')
    })
    const d = new Dispatcher([boom], [])
    const r = await d.runCommand(fakeCommandContext(services, { command: 'boom' }))
    expect(r.content).toMatch(/Something went wrong/)
    expect(r.content).not.toMatch(/database on fire/)
    expect(store.stats.commandUsage(0)).toEqual([expect.objectContaining({ command: 'boom', failures: 1 })])
  })

  it('treats UserFacingError as a successful, handled outcome', async () => {
    const polite = testCommand('polite', () => {
      throw new UserFacingError('Nope.')
    })
    const r = await new Dispatcher([polite], []).runCommand(fakeCommandContext(services, { command: 'polite' }))
    expect(r.content).toBe('⚠️ Nope.')
    expect(store.stats.commandUsage(0)[0]?.failures).toBe(0)
  })

  it('answers unknown commands', async () => {
    expect((await run({ command: 'nope' })).content).toMatch(/Unknown command/)
  })
})
