import { EmbedBuilder } from 'discord.js'
import { describe, expect, it } from 'vitest'
import { renderMarkup, renderResponse } from '../src/demo/render.js'
import { NOW } from './helpers.js'

const opts = { now: NOW, channelNames: new Map([['1', 'general']]), userNames: new Map([['2', 'ava']]) }

describe('terminal renderer', () => {
  it('turns Discord markup into readable text', () => {
    const at = Math.floor((NOW + 90 * 60_000) / 1000)
    expect(renderMarkup(`<@2> in <#1>: **hi** <t:${at}:R> / <t:${at}:f>`, opts)).toBe('@ava in #general: hi in 1h 30m / 2026-03-10 13:30 UTC')
    expect(renderMarkup(`<t:${Math.floor((NOW - 60_000) / 1000)}:R>`, opts)).toBe('1m ago')
  })

  it('renders embeds with inline rows of three and an ephemeral hint', () => {
    const embed = new EmbedBuilder()
      .setTitle('Title')
      .addFields(
        { name: 'A', value: '1', inline: true },
        { name: 'B', value: '2', inline: true },
        { name: 'C', value: '3', inline: true },
        { name: 'D', value: '4', inline: true },
      )
      .setFooter({ text: 'foot' })
    expect(renderResponse({ embeds: [embed], ephemeral: true }, opts).split('\n')).toEqual([
      '▌ Title',
      '▌ A: 1   B: 2   C: 3',
      '▌ D: 4',
      '▌ foot',
      '👁  Only you can see this',
    ])
  })
})
