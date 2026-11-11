import type { AnyDocument, GeosearchDistanceUnit, Optional, SearchableValue, TokenScore } from './types.js'
import { createError } from './errors.js'

const baseId = Date.now().toString().slice(5)
let lastId = 0

const k = 1024
const nano = BigInt(1e3)
const milli = BigInt(1e6)
const second = BigInt(1e9)

type NodeProcessLike = {
  release?: { name?: string }
  hrtime?: { bigint?: () => bigint }
}

function getNodeProcess(): NodeProcessLike | undefined {
  return (globalThis as { process?: NodeProcessLike }).process
}

export const isServer = typeof window === 'undefined'

/**
 * This value can be increased up to 100_000
 * But i don't know if this value change from nodejs to nodejs
 * So I will keep a safer value here.
 */
export const MAX_ARGUMENT_FOR_STACK = 65535

/**
 * This method is needed to used because of issues like: https://github.com/oramasearch/orama/issues/301
 * that issue is caused because the array that is pushed is huge (>100k)
 *
 * @example
 * ```ts
 * safeArrayPush(myArray, [1, 2])
 * ```
 */
export function safeArrayPush<T>(arr: T[], newArr: T[]): void {
  if (newArr.length < MAX_ARGUMENT_FOR_STACK) {
    Array.prototype.push.apply(arr, newArr)
  } else {
    const newArrLength = newArr.length
    for (let i = 0; i < newArrLength; i += MAX_ARGUMENT_FOR_STACK) {
      Array.prototype.push.apply(arr, newArr.slice(i, i + MAX_ARGUMENT_FOR_STACK))
    }
  }
}

export function sprintf(template: string, ...args: Array<string | number>): string {
  return template.replace(
    /%(?:(?<position>\d+)\$)?(?<width>-?\d*\.?\d*)(?<type>[dfs])/g,
    function (...replaceArgs: Array<string | number | Record<string, string>>): string {
      const groups = replaceArgs[replaceArgs.length - 1] as Record<string, string>
      const { width: rawWidth, type, position } = groups

      const replacement = position ? args[Number.parseInt(position) - 1]! : args.shift()!
      const width = rawWidth === '' ? 0 : Number.parseInt(rawWidth)

      switch (type) {
        case 'd':
          return replacement.toString().padStart(width, '0')
        case 'f': {
          let value = replacement
          const [padding, precision] = rawWidth.split('.').map((w) => Number.parseFloat(w))

          if (typeof precision === 'number' && precision >= 0) {
            value = (value as number).toFixed(precision)
          }

          return typeof padding === 'number' && padding >= 0 ? value.toString().padStart(width, '0') : value.toString()
        }
        case 's':
          return width < 0
            ? (replacement as string).toString().padEnd(-width, ' ')
            : (replacement as string).toString().padStart(width, ' ')

        default:
          return replacement as string
      }
    }
  )
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) {
    return '0 Bytes'
  }
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export function isInsideWebWorker(): boolean {
  // @ts-expect-error - WebWorker global scope
  return typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope
}

export function isInsideNode(): boolean {
  const nodeProcess = getNodeProcess()
  return nodeProcess?.release?.name === 'node'
}

export function getNanosecondTimeViaPerformance() {
  return BigInt(Math.floor(performance.now() * 1e6))
}

export function formatNanoseconds(value: number | bigint): string {
  if (typeof value === 'number') {
    value = BigInt(value)
  }

  if (value < nano) {
    return `${value}ns`
  } else if (value < milli) {
    return `${value / nano}μs`
  } else if (value < second) {
    return `${value / milli}ms`
  }

  return `${value / second}s`
}

export function getNanosecondsTime(): bigint {
  if (isInsideWebWorker()) {
    return getNanosecondTimeViaPerformance()
  }

  if (isInsideNode()) {
    const nodeProcess = getNodeProcess()
    if (nodeProcess?.hrtime?.bigint) {
      return nodeProcess.hrtime.bigint()
    }
  }

  const nodeProcess = getNodeProcess()
  if (typeof nodeProcess?.hrtime?.bigint === 'function') {
    return nodeProcess.hrtime.bigint()
  }

  if (typeof performance !== 'undefined') {
    return getNanosecondTimeViaPerformance()
  }

  // @todo: fallback to V8 native method to get microtime
  return BigInt(0)
}

export function uniqueId(): string {
  return `${baseId}-${lastId++}`
}

export function getOwnProperty<T = unknown>(object: Record<string, T>, property: string): T | undefined {
  // Checks if `hasOwn` method is defined avoiding errors with older Node.js versions
  if (Object.hasOwn === undefined) {
    return Object.prototype.hasOwnProperty.call(object, property) ? object[property] : undefined
  }

  return Object.hasOwn(object, property) ? object[property] : undefined
}

export function getTokenFrequency(token: string, tokens: string[]): number {
  let count = 0

  for (const t of tokens) {
    if (t === token) {
      count++
    }
  }

  return count
}

export function insertSortedValue(
  arr: TokenScore[],
  el: TokenScore,
  compareFn = sortTokenScorePredicate
): TokenScore[] {
  let low = 0
  let high = arr.length
  let mid

  while (low < high) {
    mid = (low + high) >>> 1
    if (compareFn(el, arr[mid]) < 0) {
      high = mid
    } else {
      low = mid + 1
    }
  }

  arr.splice(low, 0, el)

  return arr
}

export function sortTokenScorePredicate(a: TokenScore, b: TokenScore): number {
  if (b[1] === a[1]) {
    return a[0] - b[0]
  }

  return b[1] - a[1]
}

// Sorts `tokenScores` in place, with the same result as `tokenScores.sort(sortTokenScorePredicate)`. Scored results
// usually arrive already ordered by score, or nearly so, and a stable insertion sort handles those faster than
// Array.prototype.sort. Once the input proves too unordered, the array is handed to the native sort: the insertion
// pass only moves elements past strictly greater ones, and without NaN scores the predicate is a consistent ordering,
// so the final result is unchanged.
export function sortTokenScores(tokenScores: TokenScore[]): TokenScore[] {
  const length = tokenScores.length

  for (let i = 0; i < length; i++) {
    const score = tokenScores[i][1]
    if (score !== score) {
      return tokenScores.sort(sortTokenScorePredicate)
    }
  }

  let movesLeft = length + 32

  for (let i = 1; i < length; i++) {
    const item = tokenScores[i]
    let j = i - 1

    if (!(sortTokenScorePredicate(tokenScores[j], item) > 0)) {
      continue
    }

    do {
      tokenScores[j + 1] = tokenScores[j]
      j--
      movesLeft--
    } while (j >= 0 && sortTokenScorePredicate(tokenScores[j], item) > 0)

    tokenScores[j + 1] = item

    if (movesLeft < 0) {
      return tokenScores.sort(sortTokenScorePredicate)
    }
  }

  return tokenScores
}

// Intersection function taken from https://github.com/lovasoa/fast_array_intersect.
// MIT Licensed at the time of writing.
export function intersect<T>(arrays: Array<readonly T[]>): T[] {
  if (arrays.length === 0) {
    return []
  } else if (arrays.length === 1) {
    return arrays[0] as T[]
  }

  for (let i = 1; i < arrays.length; i++) {
    if (arrays[i].length < arrays[0].length) {
      const tmp = arrays[0]
      arrays[0] = arrays[i]
      arrays[i] = tmp
    }
  }

  const set = new Map()
  for (const elem of arrays[0]) {
    set.set(elem, 1)
  }
  for (let i = 1; i < arrays.length; i++) {
    let found = 0
    for (const elem of arrays[i]) {
      const count = set.get(elem)
      if (count === i) {
        set.set(elem, count + 1)
        found++
      }
    }
    if (found === 0) return []
  }

  return arrays[0].filter((e) => {
    const count = set.get(e)
    if (count !== undefined) set.set(e, 0)
    return count === arrays.length
  })
}

export function getDocumentProperties(doc: AnyDocument, paths: string[]): Record<string, SearchableValue> {
  const properties: Record<string, SearchableValue> = {}

  const pathsLength = paths.length
  for (let i = 0; i < pathsLength; i++) {
    const path = paths[i]
    const pathTokens = path.split('.')

    let current: SearchableValue | AnyDocument | undefined = doc
    const pathTokensLength = pathTokens.length
    for (let j = 0; j < pathTokensLength; j++) {
      current = current[pathTokens[j]!]

      // We found an object but we were supposed to be done
      if (typeof current === 'object') {
        if (
          current !== null &&
          'lat' in current &&
          'lon' in current &&
          typeof current.lat === 'number' &&
          typeof current.lon === 'number'
        ) {
          current = properties[path] = current as SearchableValue
          break
        } else if (!Array.isArray(current) && current !== null && j === pathTokensLength - 1) {
          current = undefined
          break
        }
      } else if ((current === null || typeof current !== 'object') && j < pathTokensLength - 1) {
        // We can't recurse anymore but we were supposed to
        current = undefined
        break
      }
    }

    if (typeof current !== 'undefined') {
      properties[path] = current as SearchableValue
    }
  }

  return properties
}

export function getNested<T = SearchableValue>(obj: object, path: string): Optional<T> {
  const props = getDocumentProperties(obj as AnyDocument, [path])

  return props[path] as T | undefined
}

export function flattenObject(obj: object, prefix = ''): AnyDocument {
  const result: AnyDocument = {}

  for (const key in obj) {
    const prop = `${prefix}${key}`
    const objKey = (obj as AnyDocument)[key]

    if (typeof objKey === 'object' && objKey !== null) {
      Object.assign(result, flattenObject(objKey, `${prop}.`))
    } else {
      result[prop] = objKey
    }
  }
  return result
}

const mapDistanceToMeters = {
  cm: 0.01,
  m: 1,
  km: 1000,
  ft: 0.3048,
  yd: 0.9144,
  mi: 1609.344
}

export function convertDistanceToMeters(distance: number, unit: GeosearchDistanceUnit): number {
  const ratio = mapDistanceToMeters[unit]

  if (ratio === undefined) {
    throw new Error(createError('INVALID_DISTANCE_SUFFIX', distance).message)
  }

  return distance * ratio
}

// The instance behind each document view (see `copyDocument`)
const viewInstances = new WeakMap<object, object>()

// Whether the prototype chain below `Object.prototype` defines accessors or methods: class code, which may only work
// on the instance itself (it can read `#private` fields, or the internal slots of a built-in, that a copy lacks).
function hasClassCode(proto: object | null): boolean {
  for (
    let current = proto;
    current !== null && current !== Object.prototype;
    current = Object.getPrototypeOf(current)
  ) {
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current, key)!
      if (key !== 'constructor' && (descriptor.get || descriptor.set || typeof descriptor.value === 'function')) {
        return true
      }
    }
  }
  return false
}

function findClassProperty(proto: object | null, key: PropertyKey): PropertyDescriptor | undefined {
  for (
    let current = proto;
    current !== null && current !== Object.prototype;
    current = Object.getPrototypeOf(current)
  ) {
    const descriptor = Reflect.getOwnPropertyDescriptor(current, key)
    if (descriptor) {
      return descriptor
    }
  }
  return undefined
}

// Whether `toJSON` may have returned something keyed like the document, whose keys `filterSerialized` can filter.
// Arrays, maps, sets and typed arrays are left as they are.
function isSerializedRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !ArrayBuffer.isView(value) &&
    !(value instanceof Map) &&
    !(value instanceof Set)
  )
}

// Applies to `serialized`, what the instance's `toJSON` returned, the differences between the view and the instance,
// key by key: a key the view hides is dropped, and a key the view sets to another value (an unstored vector nulled or
// rebuilt on a search hit, a nested object copied without its unstored paths) takes the view's value. Nested views
// filter their own `toJSON` the same way. Values that `toJSON` returns under other keys are not seen.
function filterSerialized(serialized: unknown, copy: object, instance: object): unknown {
  if (!isSerializedRecord(serialized)) {
    return serialized
  }

  // A copy, never the object `toJSON` returned: it may be the instance itself, or data it shares
  const filtered: Record<string, unknown> = { ...serialized }
  for (const key of Object.keys(filtered)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(copy, key)
    if (descriptor === undefined) {
      if (Object.hasOwn(instance, key)) {
        delete filtered[key]
      }
      continue
    }

    if (isPlaceholder(descriptor)) {
      const value = descriptor.get!()
      if (value === undefined) {
        delete filtered[key]
      } else {
        filtered[key] = value
      }
      continue
    }

    if ('value' in descriptor) {
      const original = Reflect.getOwnPropertyDescriptor(instance, key)
      if (original === undefined || !('value' in original) || original.value !== descriptor.value) {
        filtered[key] = descriptor.value
      }
    }
  }
  return filtered
}

// Wraps `copy` so that what it inherits from its class is read from `instance`: getters run, and methods are bound,
// with `this` set to the instance. Everything else (own properties, keys, prototype, writes) is the copy's.
// An inherited `toJSON` also runs on the instance, but its result is filtered (see `filterSerialized`), so that
// `JSON.stringify` and snapshots serialize what the view shows, not the instance's unstored values.
function createDocumentView(copy: object, instance: object): object {
  let boundMethods: WeakMap<Function, Function> | undefined

  const view = new Proxy(copy, {
    get(target, key, receiver) {
      if (Object.hasOwn(target, key)) {
        return Reflect.get(target, key, receiver)
      }

      const proto = Reflect.getPrototypeOf(target)
      const descriptor = findClassProperty(proto, key)
      if (descriptor === undefined) {
        return proto === null ? undefined : Reflect.get(proto, key, receiver)
      }
      if (descriptor.get || descriptor.set) {
        return descriptor.get ? Reflect.apply(descriptor.get, instance, []) : undefined
      }

      const value = descriptor.value
      if (typeof value !== 'function' || key === 'constructor') {
        return value
      }
      boundMethods ??= new WeakMap()
      let method = boundMethods.get(value)
      if (method === undefined) {
        method =
          key === 'toJSON'
            ? (...args: unknown[]) => filterSerialized(Reflect.apply(value, instance, args), target, instance)
            : (value.bind(instance) as Function)
        boundMethods.set(value, method)
      }
      return method
    }
  })

  viewInstances.set(view, instance)
  return view
}

/**
 * A copy of the document `obj` with the own properties `descriptors`, keeping the prototype of `obj`.
 *
 * When the class of `obj` has accessors or methods, a plain copy may break them: they can read `#private` fields
 * (or internal slots) that only the instance has. The copy is then wrapped in a view that reads what it inherits
 * from the instance (see `createDocumentView`), so its getters and methods keep working. The view keeps the instance
 * referenced, with all its data, including the properties the copy leaves out: for such documents, leaving
 * properties out of the documents store hides them but does not save memory. Plain objects, and instances of
 * classes without accessors or methods, are copied without a view and do not keep the original referenced.
 */
export function copyDocument(obj: object, descriptors: PropertyDescriptorMap): any {
  const proto = Object.getPrototypeOf(obj)
  const copy = Object.create(proto, descriptors)
  return hasClassCode(proto) ? createDocumentView(copy, viewInstances.get(obj) ?? obj) : copy
}

// Shallow clone of `obj` that keeps its prototype and every own property (including non-enumerable ones and
// accessors), except `key`, which becomes a plain writable data property holding `value`. Defining `key` up front,
// instead of assigning it on the clone, never invokes a copied setter (which could write to state shared with the
// stored document) and works when the original property is read-only or getter-only.
// A property set over a placeholder (see `placeholderProperty`) is enumerable, as if the placeholder was not there.
// The clone of a class instance reads its getters and methods from the instance (see `copyDocument`).
export function cloneWithDataProperty(obj: object, key: string, value: unknown): any {
  const descriptors = Object.getOwnPropertyDescriptors(obj)
  const previous = getPathValue(descriptors, key) as PropertyDescriptor | undefined
  const enumerable = previous === undefined || isPlaceholder(previous) ? true : previous.enumerable
  setOwnValue(descriptors, key, { value, writable: true, enumerable, configurable: true })
  return copyDocument(obj, descriptors)
}

/**
 * Reads the property `key` of `obj` as a segment of a document path. `__proto__` is read only when it is an own
 * property (a document parsed from JSON can have one): otherwise it is the prototype of `obj`, which walking a path
 * must never reach.
 */
export function getPathValue(obj: object, key: string): unknown {
  return key === '__proto__' && !Object.hasOwn(obj, key) ? undefined : (obj as Record<string, unknown>)[key]
}

/**
 * Sets `obj[key]` to `value` as an own data property. Unlike an assignment, a `__proto__` key never sets the
 * prototype of `obj`.
 */
export function setOwnValue(obj: object, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true })
  } else {
    ;(obj as Record<string, unknown>)[key] = value
  }
}

const placeholderGetters = new WeakSet<() => unknown>()

function readsUndefined(): undefined {
  return undefined
}
placeholderGetters.add(readsUndefined)

/**
 * The descriptor of an own property that a copy of a document defines in place of an inherited one, so that reading
 * it gives `value` (`undefined` hides the inherited value). Like the inherited properties of a class, it is not
 * enumerable: it stays out of `Object.keys`, JSON and snapshots, and `cloneWithDataProperty` treats it as absent.
 */
export function placeholderProperty(value: unknown): PropertyDescriptor {
  let get: () => unknown = readsUndefined
  if (value !== undefined) {
    get = () => value
    placeholderGetters.add(get)
  }
  return { get, enumerable: false, configurable: true }
}

function isPlaceholder(descriptor: PropertyDescriptor): boolean {
  return descriptor.get !== undefined && placeholderGetters.has(descriptor.get)
}

// Returns a copy of `obj` with the value at `path` set to `value`, copying every object along the path.
// `obj` itself, and the nested objects it references, are left untouched.
export function cloneWithValueAtPath(obj: object, path: string[], value: unknown): any {
  const [key, ...rest] = path
  if (rest.length === 0) {
    return cloneWithDataProperty(obj, key, value)
  }
  const next = getPathValue(obj, key)
  const child = next != null && typeof next === 'object' ? next : {}
  return cloneWithDataProperty(obj, key, cloneWithValueAtPath(child, rest, value))
}

export function isPromise(obj: any): obj is Promise<unknown> {
  return !!obj && (typeof obj === 'object' || typeof obj === 'function') && typeof obj.then === 'function'
}

/**
 * Checks if the provided input is an async function or if the input is an array
 * containing at least one async function.
 *
 * @param func - A single function or an array of functions to check.
 *               Non-function values are ignored.
 * @returns `true` if the input is an async function or an array containing at least
 *          one async function, otherwise `false`.
 */
export function isAsyncFunction(func: any): boolean {
  if (Array.isArray(func)) {
    return func.some((item) => isAsyncFunction(item))
  }

  return func?.constructor?.name === 'AsyncFunction'
}

const withIntersection = 'intersection' in new Set()

export function setIntersection<V>(...sets: Set<V>[]): Set<V> {
  // Fast path 1
  if (sets.length === 0) {
    return new Set()
  }
  // Fast path 2
  if (sets.length === 1) {
    return sets[0]
  }
  // Fast path 3
  if (sets.length === 2) {
    const set1 = sets[0]
    const set2 = sets[1]

    if (withIntersection) {
      return set1.intersection(set2)
    }
    const result = new Set<V>()
    const base = set1.size < set2.size ? set1 : set2
    const other = base === set1 ? set2 : set1
    for (const value of base) {
      if (other.has(value)) {
        result.add(value)
      }
    }
    return result
  }

  // Slow path
  // Find the smallest set
  const min = {
    index: 0,
    size: sets[0].size
  }
  for (let i = 1; i < sets.length; i++) {
    if (sets[i].size < min.size) {
      min.index = i
      min.size = sets[i].size
    }
  }

  if (withIntersection) {
    let base = sets[min.index]
    for (let i = 0; i < sets.length; i++) {
      if (i === min.index) {
        continue
      }
      base = base.intersection(sets[i])
    }

    return base
  }

  // manual implementation:
  // intersect all sets with a copy of the smallest set (input sets might be owned by an index and must not be mutated)
  const base = new Set(sets[min.index])
  for (let i = 0; i < sets.length; i++) {
    if (i === min.index) {
      continue
    }
    const other = sets[i]
    for (const value of base) {
      if (!other.has(value)) {
        base.delete(value)
      }
    }
  }

  return base
}

const withUnion = 'union' in new Set()
export function setUnion<V>(set1: Set<V> | undefined, set2: Set<V>) {
  if (withUnion) {
    if (set1) {
      return set1.union(set2)
    }
    return set2
  }

  if (!set1) {
    return new Set(set2)
  }
  return new Set([...set1, ...set2])
}

export function setDifference<V>(set1: Set<V>, set2: Set<V>): Set<V> {
  const result = new Set<V>()
  for (const value of set1) {
    if (!set2.has(value)) {
      result.add(value)
    }
  }
  return result
}

// This code is taken from https://github.com/davidmarkclements/atomic-sleep, MIT licensed at the time of commit b8149d3ca276c84a54fa8fa1478f9cc79aabc15a.
// All credits go to the original author (David Mark Clements, https://github.com/davidmarkclements).
export function sleep(ms: number) {
  if (typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined') {
    const nil = new Int32Array(new SharedArrayBuffer(4))
    const valid = ms > 0 && ms < Infinity
    if (valid === false) {
      if (typeof ms !== 'number' && typeof ms !== 'bigint') {
        throw TypeError('sleep: ms must be a number')
      }
      throw RangeError('sleep: ms must be a number that is greater than 0 but less than Infinity')
    }

    Atomics.wait(nil, 0, 0, Number(ms))
  } else {
    const valid = ms > 0 && ms < Infinity
    if (valid === false) {
      if (typeof ms !== 'number' && typeof ms !== 'bigint') {
        throw TypeError('sleep: ms must be a number')
      }
      throw RangeError('sleep: ms must be a number that is greater than 0 but less than Infinity')
    }
    const target = Date.now() + Number(ms)
    while (target > Date.now()) {
      /* empty */
    }
  }
}

type SchedulerLike = { yield?: () => Promise<void> }
type SetImmediateLike = (callback: () => void) => unknown

const pendingYields: Array<() => void> = []
let yieldChannel: MessageChannel | undefined

function drainPendingYields(): void {
  pendingYields.shift()?.()
}

export function yieldToEventLoop(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler

  if (typeof scheduler?.yield === 'function') {
    return scheduler.yield()
  }

  const setImmediateFn = (globalThis as { setImmediate?: SetImmediateLike }).setImmediate
  if (typeof setImmediateFn === 'function') {
    return new Promise((resolve) => {
      setImmediateFn(resolve as () => void)
    })
  }

  if (typeof MessageChannel !== 'undefined') {
    if (!yieldChannel) {
      yieldChannel = new MessageChannel()
      yieldChannel.port1.onmessage = drainPendingYields
    }

    return new Promise((resolve) => {
      pendingYields.push(resolve as () => void)
      yieldChannel!.port2.postMessage(null)
    })
  }

  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

// Query terms are matched once each, however many times the user repeats them, so query-side
// tokenization drops duplicates even when the tokenizer keeps them for indexing.
export function uniqueTokens(tokens: string[]): string[] {
  return tokens.length > 1 ? Array.from(new Set(tokens)) : tokens
}
