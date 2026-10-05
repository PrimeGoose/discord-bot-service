const SPARKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const

/** Unicode sparkline, e.g. [1,5,3] → "▁█▄". */
export function sparkline(values: readonly number[]): string {
  if (values.length === 0) return ''
  const max = Math.max(...values)
  if (max <= 0) return SPARKS[0].repeat(values.length)
  return values.map((v) => SPARKS[Math.min(SPARKS.length - 1, Math.round((v / max) * (SPARKS.length - 1)))]).join('')
}

/** Fixed-width progress bar, e.g. bar(0.5, 10) → "█████░░░░░". */
export function bar(fraction: number, width = 12): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** Discord timestamp markup, rendered in each viewer's own timezone. */
export function discordTime(ms: number, style: 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R' = 'f'): string {
  return `<t:${Math.floor(ms / 1000)}:${style}>`
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? word : pluralWord}`
}

export const COLORS = {
  brand: 0x5865f2,
  success: 0x57f287,
  warning: 0xfee75c,
  danger: 0xed4245,
  neutral: 0x99aab5,
} as const
