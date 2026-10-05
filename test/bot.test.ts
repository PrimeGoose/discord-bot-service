import { EventEmitter } from 'node:events'
import type { Client } from 'discord.js'
import { pino } from 'pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachHandlers, discordDelivery } from '../src/bot/client.js'
import { Dispatcher } from '../src/commands/dispatcher.js'
import { commands, componentHandlers } from '../src/commands/index.js'
import type { Services } from '../src/commands/types.js'
import type { Store } from '../src/db/store.js'
import { defaultRuntime } from '../src/demo/fake-context.js'
import { DemoSimulator } from '../src/demo/simulator.js'
import { memoryStore, NOW } from './helpers.js'

/**
 * The gateway is replaced by an EventEmitter and interactions by small fakes —
 * enough to verify the wiring without network access or a token.
 */
let store: Store
let services: Services
let client: EventEmitter
const dispatcher = new Dispatcher(commands, componentHandlers)
const flush = () => new Promise((r) => setImmediate(r))

beforeEach(() => {
  store = memoryStore()
  services = { store, logger: pino({ level: 'silent' }), now: () => NOW, runtime: () => defaultRuntime() }
  client = new EventEmitter()
  attachHandlers(client as unknown as Client, services, dispatcher)
})
afterEach(() => {
  store.close()
})

const message = (over: Record<string, unknown> = {}) => ({
  inGuild: () => true,
  guildId: 'g1',
  channelId: 'c1',
  author: { id: 'u1', bot: false },
  system: false,
  ...over,
})

describe('gateway event wiring', () => {
  it('tracks guilds on ready, join, rename and leave', () => {
    const guild = { id: 'g1', name: 'Alpha', memberCount: 5 }
    client.emit('clientReady', { user: { tag: 'Toolkit#0001' }, guilds: { cache: new Map([['g1', guild]]) } })
    expect(store.guilds.get('g1')?.name).toBe('Alpha')
    client.emit('guildCreate', { id: 'g2', name: 'Beta', memberCount: 9 })
    client.emit('guildUpdate', guild, { ...guild, name: 'Alpha 2' })
    expect(store.guilds.get('g1')?.name).toBe('Alpha 2')
    client.emit('guildDelete', { id: 'g2' })
    expect(store.guilds.overview(NOW).map((g) => g.id)).toEqual(['g1'])
  })

  it('counts human guild messages only, without reading content', () => {
    const content = vi.fn()
    const human = message()
    Object.defineProperty(human, 'content', { get: content })
    client.emit('messageCreate', human)
    client.emit('messageCreate', message({ author: { id: 'bot', bot: true } }))
    client.emit('messageCreate', message({ system: true }))
    client.emit('messageCreate', message({ inGuild: () => false }))
    expect(store.stats.guildActivity('g1', 1, NOW).total).toBe(1)
    expect(content).not.toHaveBeenCalled()
  })

  it('answers slash commands and stores the poll message id', async () => {
    const reply = vi.fn(() => Promise.resolve())
    const fetchReply = vi.fn(() => Promise.resolve({ id: 'posted-1' }))
    const values: Record<string, string> = { question: 'Lunch?', options: 'Pizza | Sushi' }
    client.emit('interactionCreate', {
      id: 'i1',
      isChatInputCommand: () => true,
      isButton: () => false,
      commandName: 'poll',
      user: { id: 'u1', username: 'ava' },
      guild: { id: 'g1', name: 'Alpha' },
      channelId: 'c1',
      options: { getSubcommand: () => null, getString: (n: string) => values[n] ?? null, getInteger: () => null },
      reply,
      fetchReply,
    })
    await flush()
    await flush()
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ allowedMentions: { parse: [], users: [] } }))
    expect(store.polls.get(1)?.messageId).toBe('posted-1')
  })

  it('routes button presses to update + private follow-up', async () => {
    store.polls.create({ guildId: 'g1', channelId: 'c1', authorId: 'a', question: 'Q', options: ['A', 'B'], createdAt: NOW, closesAt: null })
    const update = vi.fn(() => Promise.resolve())
    const followUp = vi.fn(() => Promise.resolve())
    client.emit('interactionCreate', {
      id: 'i2',
      isChatInputCommand: () => false,
      isButton: () => true,
      customId: 'poll:vote:1:1',
      user: { id: 'u9', username: 'ben' },
      guild: { id: 'g1', name: 'Alpha' },
      update,
      followUp,
    })
    await flush()
    expect(update).toHaveBeenCalledOnce()
    expect(followUp).toHaveBeenCalledWith(expect.objectContaining({ flags: 64 }))
    expect(store.polls.results(1)?.counts).toEqual([0, 1])
  })
})

describe('discordDelivery', () => {
  const reminder = { id: 1, guildId: 'g', channelId: 'c', userId: 'u', message: 'hi', remindAt: NOW, createdAt: NOW }

  it('sends to the original channel when possible', async () => {
    const send = vi.fn(() => Promise.resolve())
    const fake = { channels: { fetch: () => Promise.resolve({ isSendable: () => true, send }) }, users: { fetch: vi.fn() } }
    await discordDelivery(fake as unknown as Client, services).sendReminder(reminder)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ allowedMentions: { parse: [], users: ['u'] } }))
    expect(fake.users.fetch).not.toHaveBeenCalled()
  })

  it('falls back to a DM when the channel is gone', async () => {
    const dm = vi.fn(() => Promise.resolve())
    const fake = { channels: { fetch: () => Promise.reject(new Error('Unknown Channel')) }, users: { fetch: () => Promise.resolve({ send: dm }) } }
    await discordDelivery(fake as unknown as Client, services).sendReminder(reminder)
    expect(dm).toHaveBeenCalledOnce()
  })
})

describe('DemoSimulator', () => {
  it('produces activity through the real dispatcher', async () => {
    const sim = new DemoSimulator(services, dispatcher)
    for (let i = 0; i < 40; i++) await sim.step()
    expect(store.stats.dailyMessages(1, NOW)[0]?.count).toBeGreaterThan(0)
    expect(store.stats.commandUsage(0).length).toBeGreaterThan(0)
  })
})
