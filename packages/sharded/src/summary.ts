import { BloomFilter, type BloomFilterJSON } from './bloom.js'

export type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'geopoint' | 'vector'

export interface FieldInfo {
  kind: FieldKind
  isArray: boolean
}

/** Classifies a ZBSearch searchable type ("string[]", "vector[384]", ...). */
export function fieldInfo(type: string): FieldInfo {
  if (type.startsWith('vector[')) {
    return { kind: 'vector', isArray: false }
  }
  const isArray = type.endsWith('[]')
  const base = isArray ? type.slice(0, -2) : type
  return { kind: base as FieldKind, isArray }
}

/** Value sets larger than this are dropped: the field then never prunes the shard. */
const MAX_ENUM_VALUES = 1024

interface FieldSummary {
  min?: number
  max?: number
  hasTrue?: boolean
  hasFalse?: boolean
  /** Distinct values, or null once there were too many to track. */
  values?: Set<string | number | boolean> | null
}

interface FieldSummaryJSON {
  min?: number
  max?: number
  hasTrue?: boolean
  hasFalse?: boolean
  values?: (string | number | boolean)[] | null
}

interface VectorBound {
  /** Unit-length routing centroid. */
  centroid: Float64Array
  /** Largest angle (radians) between the centroid and a member vector: every member lies in this cone. */
  maxAngle: number
  /** Whether some member is a zero vector (similarity 0 with everything). */
  hasZero: boolean
}

interface VectorBoundJSON {
  centroid: number[]
  maxAngle: number
  hasZero: boolean
}

export interface ShardSummaryJSON {
  terms: BloomFilterJSON
  fields: Record<string, FieldSummaryJSON>
  vectors: Record<string, VectorBoundJSON>
}

/** Bits per key of the term Bloom filters: about 1% false positives at capacity. */
const BLOOM_BITS_PER_KEY = 10

function termKey(prop: string, term: string): string {
  return `${prop}\u0001${term}`
}

function normalize(vector: ArrayLike<number>): Float64Array | undefined {
  const out = new Float64Array(vector.length)
  let norm = 0
  for (let i = 0; i < vector.length; i++) {
    out[i] = vector[i]
    norm += out[i] * out[i]
  }
  norm = Math.sqrt(norm)
  if (!norm) {
    return undefined
  }
  for (let i = 0; i < out.length; i++) {
    out[i] /= norm
  }
  return out
}

function dot(a: Float64Array, b: Float64Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i]
  }
  return sum
}

function angle(a: Float64Array, b: Float64Array): number {
  return Math.acos(Math.min(1, Math.max(-1, dot(a, b))))
}

/**
 * What the global layer remembers about a shard so that queries can skip it
 * without loading it: a Bloom filter of its (property, term) pairs, value
 * ranges and value sets of its filterable fields, and a cone bounding the
 * direction of its vectors. Everything is conservative: a summary may claim a
 * shard can match when it cannot (it only grows between rebuilds), never the
 * opposite.
 */
export class ShardSummary {
  terms: BloomFilter
  readonly fields: Record<string, FieldSummary> = {}
  readonly vectors: Record<string, VectorBound> = {}

  constructor(expectedTerms = 1024) {
    this.terms = BloomFilter.create(expectedTerms, BLOOM_BITS_PER_KEY)
  }

  /** True when the Bloom filter holds more keys than it was sized for. */
  get saturated(): boolean {
    return this.terms.n > this.terms.capacity(BLOOM_BITS_PER_KEY)
  }

  addTerms(prop: string, terms: Iterable<string>): void {
    for (const term of terms) {
      this.terms.add(termKey(prop, term))
    }
  }

  hasTerm(prop: string, term: string): boolean {
    return this.terms.has(termKey(prop, term))
  }

  addValue(prop: string, info: FieldInfo, value: unknown): void {
    if (value === undefined || value === null) {
      return
    }

    if (info.kind === 'vector') {
      this.addVector(prop, value as ArrayLike<number>)
      return
    }

    const values = info.isArray && Array.isArray(value) ? value : [value]
    const field = (this.fields[prop] ??= {})

    for (const item of values) {
      switch (info.kind) {
        case 'number': {
          const n = item as number
          if (field.min === undefined || n < field.min) field.min = n
          if (field.max === undefined || n > field.max) field.max = n
          break
        }
        case 'boolean': {
          if (item) field.hasTrue = true
          else field.hasFalse = true
          break
        }
        case 'enum': {
          if (field.values === null) break
          field.values ??= new Set()
          field.values.add(item as string | number)
          if (field.values.size > MAX_ENUM_VALUES) field.values = null
          break
        }
      }
    }
  }

  addVector(prop: string, value: ArrayLike<number>): void {
    const unit = normalize(value)
    const bound = this.vectors[prop]

    if (!unit) {
      if (bound) {
        bound.hasZero = true
      } else {
        this.vectors[prop] = { centroid: new Float64Array(value.length), maxAngle: Math.PI, hasZero: true }
      }
      return
    }

    if (!bound) {
      this.vectors[prop] = { centroid: unit, maxAngle: 0, hasZero: false }
      return
    }

    bound.maxAngle = Math.max(bound.maxAngle, angle(bound.centroid, unit))
  }

  /** Rebuilds a tight cone from all the vectors of the shard. */
  setVectors(prop: string, vectors: ArrayLike<number>[]): void {
    delete this.vectors[prop]
    const units: Float64Array[] = []
    let hasZero = false
    let sum: Float64Array | undefined

    for (const vector of vectors) {
      const unit = normalize(vector)
      if (!unit) {
        hasZero = true
        continue
      }
      units.push(unit)
      sum ??= new Float64Array(unit.length)
      for (let i = 0; i < unit.length; i++) sum[i] += unit[i]
    }

    const centroid = sum && (normalize(sum) ?? units[0])
    if (!centroid) {
      if (hasZero) {
        this.vectors[prop] = { centroid: new Float64Array(vectors[0].length), maxAngle: Math.PI, hasZero }
      }
      return
    }

    let maxAngle = 0
    for (const unit of units) {
      maxAngle = Math.max(maxAngle, angle(centroid, unit))
    }
    this.vectors[prop] = { centroid, maxAngle, hasZero }
  }

  /**
   * An upper bound of the cosine similarity between `query` (unit length) and
   * any vector of the shard, or -Infinity when the shard has none.
   */
  vectorUpperBound(prop: string, query: Float64Array): number {
    const bound = this.vectors[prop]
    if (!bound) {
      return -Infinity
    }
    if (bound.maxAngle >= Math.PI) {
      return 1
    }
    const best = Math.cos(Math.max(0, angle(bound.centroid, query) - bound.maxAngle))
    return bound.hasZero ? Math.max(best, 0) : best
  }

  /** Cosine similarity between `query` (unit length) and the routing centroid. */
  centroidSimilarity(prop: string, query: Float64Array): number {
    const bound = this.vectors[prop]
    return bound && bound.maxAngle < Math.PI ? dot(bound.centroid, query) : -Infinity
  }

  /**
   * Whether some document of the shard can satisfy `where`. `tokenize`
   * turns a string filter value into the terms core looks up.
   */
  mayMatchWhere(
    where: Record<string, unknown>,
    schema: Record<string, FieldInfo>,
    tokenize: (value: string, prop: string) => string[]
  ): boolean {
    // Same precedence as core's searchByWhereClause: and, or, not, then properties.
    if ('and' in where && Array.isArray(where.and)) {
      return where.and.every((clause) => this.mayMatchWhere(clause as Record<string, unknown>, schema, tokenize))
    }
    if ('or' in where && Array.isArray(where.or)) {
      return where.or.some((clause) => this.mayMatchWhere(clause as Record<string, unknown>, schema, tokenize))
    }
    if ('not' in where && where.not) {
      return true
    }

    for (const [prop, operation] of Object.entries(where)) {
      const info = schema[prop]
      if (info && !this.mayMatchField(prop, info, operation, tokenize)) {
        return false
      }
    }
    return true
  }

  private mayMatchField(
    prop: string,
    info: FieldInfo,
    operation: unknown,
    tokenize: (value: string, prop: string) => string[]
  ): boolean {
    const field = this.fields[prop]

    switch (info.kind) {
      case 'string': {
        if (typeof operation !== 'string' && !Array.isArray(operation)) {
          return true
        }
        const terms = ([operation].flat() as string[]).flatMap((value) => tokenize(value, prop))
        return terms.length === 0 || terms.some((term) => this.hasTerm(prop, term))
      }
      case 'boolean': {
        return operation ? Boolean(field?.hasTrue) : Boolean(field?.hasFalse)
      }
      case 'number': {
        if (!field || field.min === undefined || field.max === undefined) {
          return false
        }
        const op = operation as Record<string, unknown>
        const [key] = Object.keys(op ?? {})
        const value = op?.[key] as number
        switch (key) {
          case 'eq':
            return value >= field.min && value <= field.max
          case 'gt':
            return field.max > value
          case 'gte':
            return field.max >= value
          case 'lt':
            return field.min < value
          case 'lte':
            return field.min <= value
          case 'between': {
            const [low, high] = op.between as [number, number]
            return field.max >= low && field.min <= high
          }
          default:
            return true
        }
      }
      case 'enum': {
        if (!field) {
          return false
        }
        const values = field.values
        if (!values) {
          return true
        }
        const op = operation as Record<string, unknown>
        const [key] = Object.keys(op ?? {})
        const list = op?.[key] as (string | number | boolean)[]
        switch (key) {
          case 'eq':
            return values.has(op.eq as string)
          case 'in':
          case 'containsAny':
            return list.some((value) => values.has(value))
          case 'containsAll':
            return list.every((value) => values.has(value))
          case 'nin':
            return [...values].some((value) => !list.includes(value))
          default:
            return true
        }
      }
      default:
        return true
    }
  }

  toJSON(): ShardSummaryJSON {
    const fields: Record<string, FieldSummaryJSON> = {}
    for (const [prop, field] of Object.entries(this.fields)) {
      fields[prop] = {
        ...field,
        values: field.values === undefined ? undefined : field.values === null ? null : [...field.values]
      }
    }

    const vectors: Record<string, VectorBoundJSON> = {}
    for (const [prop, bound] of Object.entries(this.vectors)) {
      vectors[prop] = { centroid: Array.from(bound.centroid), maxAngle: bound.maxAngle, hasZero: bound.hasZero }
    }

    return { terms: this.terms.toJSON(), fields, vectors }
  }

  static fromJSON(json: ShardSummaryJSON): ShardSummary {
    const summary = new ShardSummary(1)
    summary.terms = BloomFilter.fromJSON(json.terms)
    for (const [prop, field] of Object.entries(json.fields)) {
      summary.fields[prop] = {
        ...field,
        values: field.values === undefined ? undefined : field.values === null ? null : new Set(field.values)
      }
    }
    for (const [prop, bound] of Object.entries(json.vectors)) {
      summary.vectors[prop] = {
        centroid: Float64Array.from(bound.centroid),
        maxAngle: bound.maxAngle,
        hasZero: bound.hasZero
      }
    }
    return summary
  }

  /** Approximate resident size in bytes. */
  get bytes(): number {
    let total = this.terms.bits.byteLength + 256
    for (const bound of Object.values(this.vectors)) {
      total += bound.centroid.byteLength + 64
    }
    for (const field of Object.values(this.fields)) {
      total += 64 + (field.values ? field.values.size * 48 : 0)
    }
    return total
  }
}
