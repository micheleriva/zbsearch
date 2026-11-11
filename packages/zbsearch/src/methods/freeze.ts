import { createIndex, freezeIndex, search as builtinSearch, type Index } from '../components/index.js'
import { createError } from '../errors.js'
import type { AnyZBSearch, FreezeConfig, FreezeSettings } from '../types.js'

// Documents inserted or removed since the last freeze, per database (by its internal document id store, which
// survives load())
const pendingChanges = new WeakMap<object, number>()

const builtinIndex = createIndex()

export function resolveFreezeConfig(config: FreezeConfig | undefined): FreezeSettings | undefined {
  if (config === undefined || config === null) {
    return undefined
  }

  if (typeof config !== 'object' || Array.isArray(config)) {
    throw createError('INVALID_FREEZE_CONFIG', 'expected an object')
  }

  const { threshold } = config
  if (threshold === undefined) {
    return undefined
  }

  if (typeof threshold !== 'number' || !Number.isInteger(threshold) || threshold < 1) {
    throw createError('INVALID_FREEZE_CONFIG', '"threshold" must be a positive integer')
  }

  return { threshold }
}

/** Throws unless the database uses the built-in index component, the only one that can be frozen. */
export function assertFreezable<T extends AnyZBSearch>(zbsearch: T): void {
  if (zbsearch.index.search !== builtinSearch || zbsearch.index.insert !== builtinIndex.insert) {
    throw createError('FREEZE_NOT_SUPPORTED')
  }
}

/**
 * Freezes the full-text index of `zbsearch`: the postings and term frequencies of every string property move from
 * the mutable structures (a radix tree, a postings array and a `{ term: frequency }` object per document) to one
 * immutable, compact segment per property (a sorted term dictionary and delta-encoded postings in typed arrays),
 * which takes several times less memory.
 *
 * Search results and scores do not change. Documents inserted afterwards go to the mutable structures again (the
 * mutable tail); updating or removing a frozen document marks it as removed in its segment (a tombstone). The next
 * `freeze` merges the segments, the tail and the tombstones into one new segment.
 *
 * Freezing takes time proportional to the size of the index: call it after bulk inserts or after loading, or let
 * `create({ freeze: { threshold } })` freeze the tail automatically.
 */
export function freeze<T extends AnyZBSearch>(zbsearch: T): void {
  assertFreezable(zbsearch)
  freezeIndex(zbsearch.data.index as unknown as Index, true)
  pendingChanges.delete(zbsearch.internalDocumentIDStore)
}

/**
 * Counts an inserted or removed document toward the automatic freeze threshold (create({ freeze: { threshold } })),
 * and freezes the mutable tail into a new segment once it is reached.
 */
export function trackFreezeChange<T extends AnyZBSearch>(zbsearch: T): void {
  const settings = zbsearch.freeze
  if (!settings) {
    return
  }

  const key = zbsearch.internalDocumentIDStore
  const changes = (pendingChanges.get(key) ?? 0) + 1
  if (changes < settings.threshold) {
    pendingChanges.set(key, changes)
    return
  }

  pendingChanges.delete(key)
  freezeIndex(zbsearch.data.index as unknown as Index, false)
}
