import { html, raw } from 'hono/html'
import { formatDuration } from '../lib/duration.js'
import { activityChart, meterSvg, sparklineSvg } from './charts.js'
import type { DashboardData } from './data.js'

const n = (v: number) => v.toLocaleString('en-US')

function delta(current: number, previous: number) {
  if (previous === 0) return html`<span class="delta flat">new</span>`
  const pct = Math.round(((current - previous) / previous) * 100)
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'
  return html`<span class="delta ${cls}">${pct > 0 ? '▲' : pct < 0 ? '▼' : '•'} ${Math.abs(pct)}% vs prev. 7d</span>`
}

function ago(ms: number, now: number) {
  const diff = now - ms
  return diff < 60_000 ? 'just now' : `${formatDuration(diff).split(' ')[0] ?? ''} ago`
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()

function hue(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}

const STYLES = `
:root{--bg:#1e1f22;--panel:#2b2d31;--panel2:#313338;--line:#3f4147;--text:#f2f3f5;--muted:#b5bac1;--dim:#80848e;--brand:#5865f2;--green:#57f287;--yellow:#fee75c;--red:#ed4245}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 "gg sans","Noto Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:#00a8fc}header{display:flex;align-items:center;gap:16px;padding:18px 32px;border-bottom:1px solid var(--line);background:#232428;position:sticky;top:0;z-index:1}
.logo{width:40px;height:40px;border-radius:12px;background:var(--brand);display:grid;place-items:center;font-size:22px}
h1{font-size:18px;margin:0}header p{margin:0;color:var(--muted);font-size:13px}.spacer{flex:1}
.pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;letter-spacing:.02em}
.pill.demo{background:rgba(254,231,92,.12);color:var(--yellow);border:1px solid rgba(254,231,92,.35)}
.pill.live{background:rgba(87,242,135,.12);color:var(--green);border:1px solid rgba(87,242,135,.35)}
.pill.off{background:rgba(237,66,69,.12);color:var(--red);border:1px solid rgba(237,66,69,.35)}
.dot{width:8px;height:8px;border-radius:50%;background:currentColor}
.meta{color:var(--dim);font-size:12px;text-align:right}
main{max-width:1280px;margin:0 auto;padding:24px 32px 48px}
.kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-bottom:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
.kpi .label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.kpi .value{font-size:26px;font-weight:700;margin:4px 0 2px}.delta{font-size:12px}.delta.up{color:var(--green)}.delta.down{color:var(--red)}.delta.flat{color:var(--dim)}
.sub{color:var(--dim);font-size:12px}
.grid2{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:16px}
h2{font-size:14px;margin:0 0 12px;display:flex;align-items:center;gap:8px}h2 .sub{font-weight:400}
.legend{display:flex;gap:14px;font-size:12px;color:var(--muted);margin-left:auto;font-weight:400}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.chart{width:100%;height:auto}.chart .grid{stroke:var(--line);stroke-width:1}.chart .axis{fill:var(--dim);font-size:11px}.chart .axis-c{fill:#3ba55c}
.chart .bar{fill:var(--brand);opacity:.9}.chart .bar:hover{opacity:1;fill:#7984f5}.chart .line{fill:none;stroke:var(--green);stroke-width:2.5;stroke-linejoin:round}
table{width:100%;border-collapse:collapse}th{text-align:left;color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line)}
td{padding:10px;border-bottom:1px solid #35373c;vertical-align:middle}tr:last-child td{border-bottom:0}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.guild{display:flex;align-items:center;gap:10px}.avatar{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:12px;color:#fff;flex:none}
.spark-line{fill:none;stroke:var(--brand);stroke-width:1.8}.spark-fill{fill:rgba(88,101,242,.18);stroke:none}
.meter-bg{fill:#1e1f22}.meter-fg{fill:var(--brand)}
code{background:#1e1f22;border-radius:4px;padding:2px 6px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ok{color:var(--green)}.fail{color:var(--red)}.badge{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--panel2);color:var(--muted)}
.log td{padding:7px 10px;font-size:13px}
footer{max-width:1280px;margin:0 auto;padding:0 32px 32px;color:var(--dim);font-size:12px;display:flex;gap:16px;flex-wrap:wrap}
@media (max-width:1100px){.kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.grid2{grid-template-columns:1fr}}
@media (max-width:640px){header{padding:14px 16px;flex-wrap:wrap}main{padding:16px}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.hide-sm{display:none}.meta{text-align:left;width:100%}}
`

export function renderDashboard(d: DashboardData, nonce: string) {
  const { kpis, runtime } = d
  const maxUses = Math.max(1, ...d.commandUsage.map((c) => c.uses))
  const status = runtime.demo
    ? html`<span class="pill demo"><span class="dot"></span>DEMO MODE · seeded data</span>`
    : runtime.wsPingMs !== null && runtime.wsPingMs >= 0
      ? html`<span class="pill live"><span class="dot"></span>CONNECTED · ${runtime.wsPingMs} ms</span>`
      : html`<span class="pill off"><span class="dot"></span>CONNECTING…</span>`

  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Server Toolkit · Admin dashboard</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧰</text></svg>">
<style>${raw(STYLES)}</style>
</head>
<body>
<header>
  <div class="logo" aria-hidden="true">🧰</div>
  <div><h1>Server Toolkit</h1><p>Admin dashboard · official Discord bot</p></div>
  ${status}
  <div class="spacer"></div>
  <div class="meta">v${runtime.version} · up ${formatDuration(d.generatedAt - runtime.startedAt)}<br>updated <span id="updated">${new Date(d.generatedAt).toISOString().slice(11, 19)} UTC</span></div>
</header>
<main id="main">
  <section class="kpis" aria-label="Key metrics">
    <div class="card kpi"><div class="label">Servers</div><div class="value">${n(kpis.servers)}</div><div class="sub">${n(kpis.members)} members reached</div></div>
    <div class="card kpi"><div class="label">Messages · 7d</div><div class="value">${n(kpis.messages7d)}</div>${delta(kpis.messages7d, kpis.messagesPrev7d)}</div>
    <div class="card kpi"><div class="label">Commands · 7d</div><div class="value">${n(kpis.commands7d)}</div>${delta(kpis.commands7d, kpis.commandsPrev7d)}</div>
    <div class="card kpi"><div class="label">Avg / day</div><div class="value">${n(Math.round(kpis.messages7d / 7))}</div><div class="sub">messages counted</div></div>
    <div class="card kpi"><div class="label">Reminders</div><div class="value">${n(kpis.pendingReminders)}</div><div class="sub">pending delivery</div></div>
    <div class="card kpi"><div class="label">Polls</div><div class="value">${n(kpis.openPolls)}</div><div class="sub">open right now</div></div>
  </section>

  <section class="grid2">
    <div class="card">
      <h2>Activity <span class="sub">last ${d.activity.length} days</span>
        <span class="legend"><span><i style="background:var(--brand)"></i>messages</span><span><i style="background:var(--green)"></i>commands</span></span></h2>
      ${raw(activityChart(d.activity))}
    </div>
    <div class="card">
      <h2>Command usage <span class="sub">last 7 days</span></h2>
      <table>
        <thead><tr><th>Command</th><th class="hide-sm"></th><th class="num">Uses</th><th class="num">Avg ms</th></tr></thead>
        <tbody>
        ${d.commandUsage.map(
          (c) => html`<tr>
            <td><code>/${c.command}</code>${c.failures > 0 ? html` <span class="badge" title="failed runs">${c.failures} err</span>` : ''}</td>
            <td class="hide-sm">${raw(meterSvg(c.uses / maxUses, 110))}</td>
            <td class="num">${n(c.uses)}</td><td class="num">${c.avgMs}</td></tr>`,
        )}
        </tbody>
      </table>
    </div>
  </section>

  <section class="card" style="margin-bottom:16px">
    <h2>Servers <span class="sub">the bot is currently in</span></h2>
    <table>
      <thead><tr><th>Server</th><th class="num">Members</th><th class="num">Messages · 7d</th><th class="hide-sm">14-day trend</th><th class="num">Commands · 7d</th><th class="num hide-sm">Reminders</th><th class="num hide-sm">Polls</th><th class="num hide-sm">Joined</th></tr></thead>
      <tbody>
      ${d.guilds.map(
        (g) => html`<tr>
          <td><div class="guild"><div class="avatar" style="background:hsl(${hue(g.id)} 55% 45%)">${initials(g.name)}</div><div><strong>${g.name}</strong><div class="sub">${g.id}</div></div></div></td>
          <td class="num">${n(g.memberCount)}</td>
          <td class="num">${n(g.messages7d)}</td>
          <td class="hide-sm">${raw(sparklineSvg(g.trend))}</td>
          <td class="num">${n(g.commands7d)}</td>
          <td class="num hide-sm">${n(g.activeReminders)}</td>
          <td class="num hide-sm">${n(g.openPolls)}</td>
          <td class="num hide-sm">${ago(g.joinedAt, d.generatedAt)}</td></tr>`,
      )}
      </tbody>
    </table>
  </section>

  <section class="card">
    <h2>Recent commands</h2>
    <table class="log">
      <thead><tr><th>When</th><th>Server</th><th>Command</th><th>Status</th><th class="num">Latency</th></tr></thead>
      <tbody>
      ${d.recent.map(
        (r) => html`<tr>
          <td class="sub">${ago(r.usedAt, d.generatedAt)}</td>
          <td>${r.guildName ?? 'Direct message'}</td>
          <td><code>/${r.command}${r.subcommand ? ` ${r.subcommand}` : ''}</code></td>
          <td>${r.success ? html`<span class="ok">● ok</span>` : html`<span class="fail">● error</span>`}</td>
          <td class="num">${r.durationMs} ms</td></tr>`,
      )}
      </tbody>
    </table>
  </section>
</main>
<footer>
  <span>🤖 Official Discord bot: bot token + slash commands via the Discord API. Not a self-bot.</span>
  <span>🔒 Stores message <em>counts</em> only, never message content.</span>
  <span><a href="/api/summary">JSON API</a> · <a href="/healthz">health</a></span>
</footer>
<script nonce="${nonce}">
  // Refresh the numbers every 15s without a full reload or a front-end framework.
  setInterval(async () => {
    try {
      const res = await fetch(location.pathname, { headers: { 'x-partial': '1' } })
      if (!res.ok) return
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html')
      const next = doc.getElementById('main'); const stamp = doc.getElementById('updated')
      if (next) document.getElementById('main').replaceWith(next)
      if (stamp) document.getElementById('updated').textContent = stamp.textContent
    } catch {}
  }, 15000)
</script>
</body>
</html>`
}
