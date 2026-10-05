import type { CommandResponse } from '../commands/types.js'
import { formatDuration } from '../lib/duration.js'
import { CHANNEL_NAMES, USER_NAMES } from './fixtures.js'

export interface RenderOptions {
  now: number
  color?: boolean
  channelNames?: Map<string, string>
  userNames?: Map<string, string>
}

const ESC = '\u001b['
const style = (on: boolean, code: string, text: string) => (on ? `${ESC}${code}m${text}${ESC}0m` : text)

/** Convert Discord markup (timestamps, mentions, bold) into readable terminal text. */
export function renderMarkup(text: string, opts: RenderOptions): string {
  const color = opts.color ?? false
  const channels = opts.channelNames ?? CHANNEL_NAMES
  const users = opts.userNames ?? USER_NAMES
  return text
    .replace(/<t:(\d+):([tTdDfFR])>/g, (_, secs: string, fmt: string) => {
      const ms = Number(secs) * 1000
      if (fmt === 'R') {
        const diff = ms - opts.now
        return diff >= 0 ? `in ${formatDuration(diff)}` : `${formatDuration(-diff)} ago`
      }
      return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
    })
    .replace(/<#(\d+)>/g, (_, id: string) => style(color, '38;5;111', `#${channels.get(id) ?? id}`))
    .replace(/<@!?(\d+)>/g, (_, id: string) => style(color, '38;5;111', `@${users.get(id) ?? id}`))
    .replace(/\*\*(.+?)\*\*/g, (_, inner: string) => style(color, '1', inner))
    .replace(/^-# (.*)$/gm, (_, inner: string) => style(color, '2', inner))
    .replace(/`([^`\n]+)`/g, (_, inner: string) => style(color, '38;5;180', inner))
    .replace(/\\([*_`~|>])/g, '$1')
}

const hex = (n: number) => [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(';')

/** Render a bot response roughly as Discord would show it, for terminals and READMEs. */
export function renderResponse(r: CommandResponse, opts: RenderOptions): string {
  const color = opts.color ?? false
  const out: string[] = []
  const md = (t: string) => renderMarkup(t, opts)

  if (r.content) out.push(...md(r.content).split('\n'))

  for (const builder of r.embeds ?? []) {
    const e = builder.toJSON()
    const barChar = style(color, `38;2;${hex(e.color ?? 0x99aab5)}`, '▌')
    const lines: string[] = []
    if (e.title) lines.push(style(color, '1', md(e.title)))
    if (e.description) lines.push(...md(e.description).split('\n'))
    const fields = e.fields ?? []
    for (let i = 0; i < fields.length; ) {
      const field = fields[i]
      if (!field) break
      if (field.inline) {
        // Discord lays inline fields out in rows of up to three.
        const group = []
        while (i < fields.length && fields[i]?.inline && group.length < 3) group.push(fields[i++])
        const multiLine = group.some((f) => f?.value.includes('\n'))
        if (multiLine) {
          for (const f of group) {
            if (!f) continue
            lines.push(style(color, '1', f.name), ...md(f.value).split('\n'))
          }
        } else {
          lines.push(group.map((f) => (f ? `${style(color, '1', f.name)}: ${md(f.value)}` : '')).join('   '))
        }
      } else {
        lines.push(style(color, '1', field.name), ...md(field.value).split('\n'))
        i++
      }
    }
    if (e.footer?.text) lines.push(style(color, '2', e.footer.text))
    out.push(...lines.map((l) => `${barChar} ${l}`))
  }

  for (const row of r.components ?? []) {
    const labels = row.toJSON().components.map((c) => ('label' in c && c.label ? `[ ${c.label} ]` : '[ • ]'))
    out.push(style(color, '38;5;111', labels.join(' ')))
  }

  if (r.ephemeral) out.push(style(color, '2;3', '👁  Only you can see this'))
  return out.join('\n')
}
