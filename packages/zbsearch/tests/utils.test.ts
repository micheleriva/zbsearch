import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatNanoseconds,
  getOwnProperty,
  getNested,
  flattenObject,
  setUnion,
  setIntersection,
  isAsyncFunction
} from '../src/utils.js'

describe('utils', () => {
  it('should correctly format bytes', async () => {
    expect(formatBytes(0)).toBe('0 Bytes')
    expect(formatBytes(1)).toBe('1 Bytes')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1024 ** 2)).toBe('1 MB')
    expect(formatBytes(1024 ** 3)).toBe('1 GB')
    expect(formatBytes(1024 ** 4)).toBe('1 TB')
    expect(formatBytes(1024 ** 5)).toBe('1 PB')
    expect(formatBytes(1024 ** 6)).toBe('1 EB')
    expect(formatBytes(1024 ** 7)).toBe('1 ZB')
  })

  it('should correctly format nanoseconds', async () => {
    expect(formatNanoseconds(1n)).toBe('1ns')
    expect(formatNanoseconds(10n)).toBe('10ns')
    expect(formatNanoseconds(100n)).toBe('100ns')
    expect(formatNanoseconds(1_000n)).toBe('1μs')
    expect(formatNanoseconds(10_000n)).toBe('10μs')
    expect(formatNanoseconds(100_000n)).toBe('100μs')
    expect(formatNanoseconds(1_000_000n)).toBe('1ms')
    expect(formatNanoseconds(10_000_000n)).toBe('10ms')
    expect(formatNanoseconds(100_000_000n)).toBe('100ms')
    expect(formatNanoseconds(1000_000_000n)).toBe('1s')
    expect(formatNanoseconds(10_000_000_000n)).toBe('10s')
    expect(formatNanoseconds(100_000_000_000n)).toBe('100s')
    expect(formatNanoseconds(1000_000_000_000n)).toBe('1000s')
  })

  describe('should check object properties', () => {
    it('should return the value of the property or undefined', async () => {
      const myObject = {
        foo: 'bar'
      }

      expect(getOwnProperty(myObject, 'foo')).toBe('bar')
      expect(getOwnProperty(myObject, 'bar')).toBe(undefined)
    })

    it('should return even if the hasOwn method is not available', async () => {
      // @ts-expect-error - we are testing the fallback
      globalThis.Object.hasOwn = undefined

      const myObject = {
        foo: 'bar'
      }

      expect(getOwnProperty(myObject, 'foo')).toBe('bar')
      expect(getOwnProperty(myObject, 'bar')).toBe(undefined)
    })
  })

  it('should get value from a nested object', async () => {
    const myObject = {
      foo: 'bar',
      nested: {
        nested2: {
          nested3: {
            bar: 'baz'
          }
        },
        null: null,
        noop: () => null
      }
    }

    expect(await getNested(myObject, 'foo')).toBe('bar')
    expect(await getNested(myObject, 'nested')).toEqual(undefined)
    expect(await getNested(myObject, 'nested.nested2')).toEqual(undefined)
    expect(await getNested(myObject, 'nested.nested2.nested3')).toEqual(undefined)
    expect(await getNested(myObject, 'nested.nested2.nested3.bar')).toBe('baz')
    expect(await getNested(myObject, 'nested1.nested3.bar')).toBe(undefined)
    expect(await getNested(myObject, 'nested.noop.bar')).toBe(undefined)
  })

  it('should flatten an object', async () => {
    const myObject = {
      foo: 'bar',
      nested: {
        nested2: {
          nested3: {
            bar: 'baz'
          }
        },
        null: null,
        noop: () => null
      }
    }

    const flattened = flattenObject(myObject)

    expect((flattened as Record<string, string>).foo).toBe('bar')
    expect(flattened['nested.nested2.nested3.bar']).toBe('baz')
  })

  it('should correctly detect an async function', async () => {
    async function asyncFunction() {
      return 'async'
    }

    function returnPromise() {
      return new Promise((resolve) => {
        resolve('promise')
      })
    }

    function syncFunction() {
      return 'sync'
    }

    expect(isAsyncFunction(asyncFunction)).toBe(true)
    expect(isAsyncFunction(returnPromise)).toBe(false) // Returing a promise is not async, JS cannot detect it as async
    expect(isAsyncFunction(syncFunction)).toBe(false)
  })
})

it('setUnion', async () => {
  const set1 = new Set([1, 2, 3])
  const set2 = new Set([2, 3, 4])

  expect(setUnion(undefined, set2)).toStrictEqual(set2)
  expect(setUnion(set1, set2)).toStrictEqual(new Set([1, 2, 3, 4]))
  expect(setUnion(set2, set1)).toStrictEqual(new Set([1, 2, 3, 4]))
})

it('setIntersection', async () => {
  const set1 = new Set([1, 2, 3])
  const set2 = new Set([2, 3, 4])
  const set3 = new Set([2, 3, 5])

  // empty set
  expect(setIntersection()).toStrictEqual(new Set())

  // single set
  expect(setIntersection(set1)).toStrictEqual(set1)

  // two sets
  expect(setIntersection(set1, set2)).toStrictEqual(new Set([2, 3]))
  expect(setIntersection(set2, set1)).toStrictEqual(new Set([2, 3]))

  // three sets
  expect(setIntersection(set1, set2, set3)).toStrictEqual(new Set([2, 3]))
  expect(setIntersection(set1, set3, set2)).toStrictEqual(new Set([2, 3]))
  expect(setIntersection(set2, set1, set3)).toStrictEqual(new Set([2, 3]))
  expect(setIntersection(set2, set3, set1)).toStrictEqual(new Set([2, 3]))
  expect(setIntersection(set3, set1, set2)).toStrictEqual(new Set([2, 3]))
  expect(setIntersection(set3, set2, set1)).toStrictEqual(new Set([2, 3]))
})
