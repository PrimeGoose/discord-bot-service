// Boots the compiled bot in demo mode, checks the HTTP surface, then sends SIGTERM
// and asserts a clean, graceful exit. Used by CI; needs no Discord token.
import { spawn } from 'node:child_process'

const PORT = 3999
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/index.js', '--demo'], {
  env: { ...process.env, DASHBOARD_PORT: String(PORT), LOG_FORMAT: 'json', LOG_LEVEL: 'info' },
  stdio: ['ignore', 'pipe', 'inherit'],
})
let logs = ''
child.stdout.on('data', (d) => (logs += d))

const fail = (msg) => {
  console.error(`✖ smoke: ${msg}\n${logs}`)
  child.kill('SIGKILL')
  process.exit(1)
}

async function get(path) {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}${path}`)
      if (res.ok) return res
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return fail(`GET ${path} never succeeded`)
}

const health = await (await get('/healthz')).json()
if (health.mode !== 'demo') fail(`unexpected health payload ${JSON.stringify(health)}`)
const summary = await (await get('/api/summary')).json()
if (summary.kpis.servers < 1) fail('demo data missing')
const html = await (await get('/')).text()
if (!html.includes('Server Toolkit')) fail('dashboard HTML missing')

const exitCode = await new Promise((resolve) => {
  child.on('exit', resolve)
  child.kill('SIGTERM')
})
if (exitCode !== 0) fail(`expected graceful exit 0, got ${exitCode}`)
if (!logs.includes('"shutting down"')) fail('no graceful shutdown log')
console.log(`✔ smoke: demo booted, served ${summary.kpis.servers} servers, shut down cleanly`)
