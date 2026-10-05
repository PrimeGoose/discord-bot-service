/** Tiny dependency-free SVG charts. All inputs are numbers/ISO dates, so output is safe to inline. */

const fmt = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)))

function niceMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) if (step * magnitude >= value) return step * magnitude
  return 10 * magnitude
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDay = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''} ${Number(iso.slice(8, 10))}`

/** Bars for messages per day, with a line for commands per day on a secondary axis. */
export function activityChart(points: { day: string; messages: number; commands: number }[]): string {
  const W = 760
  const H = 240
  const pad = { top: 16, right: 44, bottom: 28, left: 44 }
  const iw = W - pad.left - pad.right
  const ih = H - pad.top - pad.bottom
  const maxM = niceMax(Math.max(0, ...points.map((p) => p.messages)))
  const maxC = niceMax(Math.max(0, ...points.map((p) => p.commands)))
  const n = Math.max(1, points.length)
  const slot = iw / n
  const bw = Math.max(2, slot * 0.68)
  const y = (v: number, max: number) => pad.top + ih - (v / max) * ih

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const gy = pad.top + ih - f * ih
      return `<line x1="${pad.left}" x2="${W - pad.right}" y1="${gy}" y2="${gy}" class="grid"/>
        <text x="${pad.left - 8}" y="${gy + 4}" text-anchor="end" class="axis">${fmt(maxM * f)}</text>
        <text x="${W - pad.right + 8}" y="${gy + 4}" class="axis axis-c">${fmt(maxC * f)}</text>`
    })
    .join('')

  const bars = points
    .map((p, i) => {
      const x = pad.left + i * slot + (slot - bw) / 2
      const top = y(p.messages, maxM)
      return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${(pad.top + ih - top).toFixed(1)}" rx="2" class="bar"><title>${shortDay(p.day)}: ${p.messages.toLocaleString('en-US')} messages, ${p.commands} commands</title></rect>`
    })
    .join('')

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(pad.left + i * slot + slot / 2).toFixed(1)},${y(p.commands, maxC).toFixed(1)}`)
    .join(' ')

  const labelEvery = Math.ceil(n / 8)
  const labels = points
    .map((p, i) =>
      i % labelEvery === 0 || i === n - 1
        ? `<text x="${(pad.left + i * slot + slot / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="axis">${shortDay(p.day)}</text>`
        : '',
    )
    .join('')

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Messages and commands per day">
    ${grid}${bars}<path d="${line}" class="line"/>${labels}</svg>`
}

/** Inline sparkline for table rows. */
export function sparklineSvg(values: number[], width = 120, height = 28): string {
  if (values.length < 2) return ''
  const max = Math.max(1, ...values)
  const step = width / (values.length - 1)
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`)
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="spark" aria-hidden="true">
    <polyline points="0,${height} ${pts.join(' ')} ${width},${height}" class="spark-fill"/>
    <polyline points="${pts.join(' ')}" class="spark-line"/></svg>`
}

/** Horizontal bar (0..1) used in the command table. */
export function meterSvg(fraction: number, width = 160): string {
  const w = Math.max(0, Math.min(1, fraction)) * width
  return `<svg viewBox="0 0 ${width} 10" width="${width}" height="10" class="meter" aria-hidden="true">
    <rect width="${width}" height="10" rx="5" class="meter-bg"/><rect width="${w.toFixed(1)}" height="10" rx="5" class="meter-fg"/></svg>`
}
