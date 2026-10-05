const UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
} as const

type Unit = keyof typeof UNIT_MS

const ALIASES: Record<string, Unit> = {
  s: 's', sec: 's', secs: 's', second: 's', seconds: 's',
  m: 'm', min: 'm', mins: 'm', minute: 'm', minutes: 'm',
  h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
  d: 'd', day: 'd', days: 'd',
  w: 'w', week: 'w', weeks: 'w',
}

/**
 * Parse a human duration such as `10m`, `1h30m`, `2 days`, `1w 2d` into milliseconds.
 * Returns `null` for anything that isn't a valid, positive duration.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase()
  const separator = /(?:[\s,]+|and\b)/y
  const token = /(\d+(?:\.\d+)?)\s*([a-z]+)/y
  let index = 0
  let total = 0
  while (index < text.length) {
    separator.lastIndex = index
    if (separator.exec(text)) {
      index = separator.lastIndex
      continue
    }
    token.lastIndex = index
    const match = token.exec(text)
    if (!match) return null
    const unit = ALIASES[match[2] ?? '']
    if (!unit) return null
    total += Number(match[1]) * UNIT_MS[unit]
    index = token.lastIndex
  }
  return total > 0 ? Math.round(total) : null
}

/** Format milliseconds as a compact human string: 5400000 → "1h 30m". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const parts: string[] = []
  let rest = Math.round(ms / 1000)
  for (const [unit, size] of [['d', 86_400], ['h', 3_600], ['m', 60], ['s', 1]] as const) {
    const n = Math.floor(rest / size)
    if (n > 0) parts.push(`${n}${unit}`)
    rest -= n * size
  }
  return parts.slice(0, 2).join(' ')
}
