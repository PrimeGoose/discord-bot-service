import { describe, expect, it } from 'vitest'
import { formatDuration, parseDuration } from '../src/lib/duration.js'

describe('parseDuration', () => {
  it.each([
    ['10s', 10_000],
    ['10m', 600_000],
    ['1h30m', 5_400_000],
    ['1h 30m', 5_400_000],
    ['2 days', 172_800_000],
    ['1w, 2d', 777_600_000],
    ['1 hour and 15 minutes', 4_500_000],
    ['1.5h', 5_400_000],
    ['  45 MIN ', 2_700_000],
  ])('parses %j', (input, expected) => {
    expect(parseDuration(input)).toBe(expected)
  })

  it.each(['', 'abc', '10', '10x', '10m banana', '-5m', '0m', 'm10'])('rejects %j', (input) => {
    expect(parseDuration(input)).toBeNull()
  })
})

describe('formatDuration', () => {
  it('formats to at most two units', () => {
    expect(formatDuration(5_400_000)).toBe('1h 30m')
    expect(formatDuration(90_061_000)).toBe('1d 1h')
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(250)).toBe('250ms')
  })
})
