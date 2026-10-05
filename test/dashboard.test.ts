import { pino } from 'pino'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { activityChart, sparklineSvg } from '../src/dashboard/charts.js'
import { collectDashboardData } from '../src/dashboard/data.js'
import { createDashboardApp } from '../src/dashboard/server.js'
import type { Store } from '../src/db/store.js'
import { defaultRuntime } from '../src/demo/fake-context.js'
import { FIXTURE_USERS } from '../src/demo/fixtures.js'
import { seedDemoData } from '../src/demo/seed.js'
import { memoryStore, NOW } from './helpers.js'

let store: Store
const logger = pino({ level: 'silent' })
const runtime = () => defaultRuntime({ startedAt: NOW - 3_600_000 })

beforeEach(() => {
  store = memoryStore()
  seedDemoData(store, NOW)
})
afterEach(() => {
  store.close()
})

describe('dashboard data', () => {
  it('collects KPIs, 30 days of activity and per-guild trends', () => {
    const d = collectDashboardData(store, NOW, runtime())
    expect(d.kpis.servers).toBe(5)
    expect(d.kpis.messages7d).toBeGreaterThan(0)
    expect(d.kpis.pendingReminders).toBe(5)
    expect(d.activity).toHaveLength(30)
    expect(d.guilds.every((g) => g.trend.length === 14)).toBe(true)
    expect(d.recent.length).toBeGreaterThan(0)
  })
})

describe('dashboard HTTP app', () => {
  const app = () => createDashboardApp({ store, now: () => NOW, runtime, logger })

  it('serves the HTML dashboard with a strict CSP and nonce', async () => {
    const res = await app().request('/')
    expect(res.status).toBe(200)
    const csp = res.headers.get('content-security-policy') ?? ''
    expect(csp).toMatch(/script-src 'nonce-/)
    const body = await res.text()
    expect(body).toContain('Synthwave Producers')
    expect(body).toContain('DEMO MODE')
    const nonce = /nonce-([^']+)'/.exec(csp)?.[1]
    expect(body).toContain(`<script nonce="${nonce ?? 'missing'}">`)
  })

  it('never leaks member IDs into the dashboard', async () => {
    const body = await (await app().request('/')).text()
    for (const u of FIXTURE_USERS) expect(body).not.toContain(u.id)
  })

  it('escapes guild names (stored XSS guard)', async () => {
    store.guilds.upsert({ id: '1', name: '<img src=x onerror=alert(1)>', memberCount: 1 }, NOW)
    const body = await (await app().request('/')).text()
    expect(body).not.toContain('<img src=x')
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('exposes JSON endpoints and a public health check', async () => {
    const summary = (await (await app().request('/api/summary')).json()) as { kpis: { servers: number } }
    expect(summary.kpis.servers).toBe(5)
    const commands = (await (await app().request('/api/commands?days=30')).json()) as unknown[]
    expect(commands.length).toBe(5)
    expect(await (await app().request('/healthz')).json()).toMatchObject({ status: 'ok', mode: 'demo', gateway: 'demo' })
    expect((await app().request('/nope')).status).toBe(404)
  })

  it('protects everything except /healthz with basic auth when a password is set', async () => {
    const secured = createDashboardApp({ store, now: () => NOW, runtime, logger, password: 's3cret' })
    expect((await secured.request('/')).status).toBe(401)
    expect((await secured.request('/api/summary')).status).toBe(401)
    expect((await secured.request('/healthz')).status).toBe(200)
    const auth = { Authorization: `Basic ${Buffer.from('admin:s3cret').toString('base64')}` }
    expect((await secured.request('/', { headers: auth })).status).toBe(200)
  })
})

describe('charts', () => {
  it('renders one bar per day and handles empty data', () => {
    const svg = activityChart([
      { day: '2026-03-09', messages: 10, commands: 1 },
      { day: '2026-03-10', messages: 20, commands: 3 },
    ])
    expect(svg.match(/class="bar"/g)).toHaveLength(2)
    expect(activityChart([{ day: '2026-03-10', messages: 0, commands: 0 }])).toContain('<svg')
    expect(sparklineSvg([1])).toBe('')
  })
})
