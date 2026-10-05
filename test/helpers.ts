import { createStore, type Store } from '../src/db/store.js'

/** 2026-03-10T12:00:00Z — a fixed clock so date bucketing is deterministic. */
export const NOW = Date.UTC(2026, 2, 10, 12, 0, 0)

export function memoryStore(): Store {
  return createStore(':memory:')
}
