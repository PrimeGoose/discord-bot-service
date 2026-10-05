// Captures README screenshots in demo mode (no Discord token needed).
//   npm run build && npm run screenshots
// Uses a locally installed Chrome/Chromium via puppeteer-core (set CHROME_PATH if needed).
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const OUT = 'docs/screenshots'
const PORT = 3456
const chrome = process.env.CHROME_PATH ?? '/usr/bin/google-chrome'
mkdirSync(OUT, { recursive: true })

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/index.js', '--demo'], {
  env: { ...process.env, DEMO_MODE: 'true', DASHBOARD_PORT: String(PORT), LOG_FORMAT: 'json', LOG_LEVEL: 'warn' },
  stdio: 'inherit',
})

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('demo server did not start')
}

// Minimal ANSI → HTML for the terminal transcript.
/* eslint-disable no-control-regex */
const PALETTE = { 111: '#7aa2f7', 141: '#bb9af7', 180: '#e0af68' }
function ansiToHtml(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  let out = ''
  let open = 0
  for (const part of text.split(/(\u001b\[[\d;]*m)/)) {
    const m = /^\u001b\[([\d;]*)m$/.exec(part)
    if (!m) {
      out += esc(part)
      continue
    }
    const codes = m[1].split(';').map(Number)
    if (codes[0] === 0) {
      out += '</span>'.repeat(open)
      open = 0
      continue
    }
    const css = []
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]
      if (c === 1) css.push('font-weight:700;color:#e6e6f0')
      else if (c === 2) css.push('opacity:.6')
      else if (c === 3) css.push('font-style:italic')
      else if (c === 38 && codes[i + 1] === 5) {
        css.push(`color:${PALETTE[codes[i + 2]] ?? '#ccc'}`)
        i += 2
      } else if (c === 38 && codes[i + 1] === 2) {
        css.push(`color:rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`)
        i += 4
      }
    }
    out += `<span style="${css.join(';')}">`
    open++
  }
  return out + '</span>'.repeat(open)
}

try {
  await waitForServer()
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  const page = await browser.newPage()

  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 })
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle0' })
  await page.screenshot({ path: `${OUT}/dashboard.png`, fullPage: true })
  console.log(`saved ${OUT}/dashboard.png`)

  await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 })
  await page.reload({ waitUntil: 'networkidle0' })
  await page.screenshot({ path: `${OUT}/dashboard-mobile.png`, fullPage: true })
  console.log(`saved ${OUT}/dashboard-mobile.png`)

  const transcript = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/demo/transcript.js'], {
    env: { ...process.env, FORCE_COLOR: '1' },
    encoding: 'utf8',
  })
  // Two screenshots: the full transcript is tall, so split it at the /stats command.
  const sections = transcript.split(/\n(?=.*used.*\/stats)/)
  const terminalPage = (body, title) => `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0f1117;padding:28px;font:14px/1.45 "DejaVu Sans Mono",ui-monospace,Menlo,monospace}
    .win{background:#1a1b26;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.5);width:980px;overflow:hidden;border:1px solid #2a2c3d}
    .bar{background:#24263a;padding:10px 14px;display:flex;gap:8px;align-items:center;color:#8b8fa8;font-size:12px}
    .bar i{width:12px;height:12px;border-radius:50%;display:inline-block}
    pre{margin:0;padding:18px 22px;color:#c0caf5;white-space:pre-wrap}</style>
    <div class="win"><div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span style="margin-left:10px">${title}</span></div>
    <pre>${ansiToHtml(body)}</pre></div>`
  const shots = [
    ['terminal-demo.png', sections[0] ?? transcript, '~/discord-bot-service — npm run demo:commands'],
    ['terminal-demo-stats.png', sections[1] ?? '', '~/discord-bot-service — npm run demo:commands (continued)'],
  ]
  await page.setViewport({ width: 1040, height: 600, deviceScaleFactor: 1.5 })
  for (const [file, body, title] of shots) {
    if (!body.trim()) continue
    await page.setContent(terminalPage(body.trimEnd(), title))
    const el = await page.$('body')
    await el.screenshot({ path: `${OUT}/${file}` })
    console.log(`saved ${OUT}/${file}`)
  }
  await browser.close()
} finally {
  server.kill('SIGTERM')
}
