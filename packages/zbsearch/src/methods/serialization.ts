import { Language } from '../index.js'
import { AnyZBSearch } from '../types.js'
import { yieldToEventLoop } from '../utils.js'

export interface RawData {
  internalDocumentIDStore: unknown
  index: unknown
  docs: unknown
  sorting: unknown
  pinning: unknown
  language: Language
}

export const CHUNKED_FORMAT_VERSION = 2

export const DEFAULT_CHUNK_SIZE = 512 * 1024

const MAX_KEYS_TO_DESCEND = 32

type ChunkPartKind = 'value' | 'record' | 'array'

type ChunkPart = {
  p: string[]
  k: ChunkPartKind
  n: number
}

type ChunkHeader = {
  v: number
  parts: ChunkPart[]
}

export interface ChunkedRawData {
  version: number
  chunks: string[]
}

export type SaveFormat = 'default' | 'chunked'

export type SaveOptions = {
  format?: SaveFormat
  chunkSize?: number
}

export function isChunkedRawData(data: RawData | ChunkedRawData): data is ChunkedRawData {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as ChunkedRawData).version === 'number' &&
    Array.isArray((data as ChunkedRawData).chunks)
  )
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function splitArray(value: unknown[], chunkSize: number, chunks: string[]): number {
  let start = 0
  let emitted = 0

  while (start < value.length) {
    let end = start
    let length = 2

    while (end < value.length) {
      const piece = JSON.stringify(value[end]) ?? 'null'
      if (length + piece.length + 1 > chunkSize && end > start) break
      length += piece.length + 1
      end++
    }

    chunks.push(JSON.stringify(value.slice(start, end)))
    emitted++
    start = end
  }

  return emitted
}

function splitRecord(value: Record<string, unknown>, chunkSize: number, chunks: string[]): number {
  const keys = Object.keys(value)
  let start = 0
  let emitted = 0

  while (start < keys.length) {
    const slice: Record<string, unknown> = {}
    let length = 2
    let end = start

    while (end < keys.length) {
      const key = keys[end]
      const piece = JSON.stringify(value[key])
      if (piece === undefined) {
        end++
        continue
      }
      const cost = piece.length + key.length + 4
      if (length + cost > chunkSize && end > start) break
      slice[key] = value[key]
      length += cost
      end++
    }

    if (end === start) end++

    chunks.push(JSON.stringify(slice))
    emitted++
    start = end
  }

  return emitted
}

function splitValue(value: unknown, path: string[], chunkSize: number, chunks: string[], parts: ChunkPart[]): void {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return

  if (serialized.length <= chunkSize) {
    parts.push({ p: path, k: 'value', n: 1 })
    chunks.push(serialized)
    return
  }

  if (Array.isArray(value)) {
    const n = splitArray(value, chunkSize, chunks)
    parts.push({ p: path, k: 'array', n })
    return
  }

  if (isPlainRecord(value)) {
    const keys = Object.keys(value)

    if (keys.length <= MAX_KEYS_TO_DESCEND) {
      for (const key of keys) {
        splitValue(value[key], [...path, key], chunkSize, chunks, parts)
      }
      return
    }

    const n = splitRecord(value, chunkSize, chunks)
    parts.push({ p: path, k: 'record', n })
    return
  }

  parts.push({ p: path, k: 'value', n: 1 })
  chunks.push(serialized)
}

export function toChunkedRawData(raw: RawData, chunkSize: number = DEFAULT_CHUNK_SIZE): ChunkedRawData {
  if (!Number.isInteger(chunkSize) || chunkSize < 1024) {
    throw new TypeError(`chunkSize must be an integer of at least 1024, got "${chunkSize}"`)
  }

  const chunks: string[] = []
  const parts: ChunkPart[] = []

  splitValue(raw, [], chunkSize, chunks, parts)

  const header: ChunkHeader = { v: CHUNKED_FORMAT_VERSION, parts }
  chunks.unshift(JSON.stringify(header))

  return { version: CHUNKED_FORMAT_VERSION, chunks }
}

export function stringifyChunked(data: ChunkedRawData): string {
  return data.chunks.join('\n')
}

export function parseChunked(text: string): ChunkedRawData {
  const chunks = text.split('\n')
  const header = JSON.parse(chunks[0]) as ChunkHeader

  return { version: header.v, chunks }
}

function containerAt(root: Record<string, unknown>, path: string[]): { parent: Record<string, unknown>; key: string } {
  let node = root
  const full = ['root', ...path]

  for (let i = 0; i < full.length - 1; i++) {
    const key = full[i]
    if (!isPlainRecord(node[key])) node[key] = {}
    node = node[key] as Record<string, unknown>
  }

  return { parent: node, key: full[full.length - 1] }
}

type PartSlot = {
  parent: Record<string, unknown>
  key: string
  target: unknown
}

function beginPart(root: Record<string, unknown>, part: ChunkPart): PartSlot {
  const { parent, key } = containerAt(root, part.p)

  if (part.k === 'value') return { parent, key, target: null }

  const target = part.k === 'array' ? [] : {}
  parent[key] = target

  return { parent, key, target }
}

function applyPiece(slot: PartSlot, part: ChunkPart, piece: unknown): void {
  if (part.k === 'value') {
    slot.parent[slot.key] = piece
    return
  }

  if (part.k === 'array') {
    const target = slot.target as unknown[]
    for (const item of piece as unknown[]) target.push(item)
    return
  }

  Object.assign(slot.target as Record<string, unknown>, piece)
}

function readHeader(data: ChunkedRawData): ChunkHeader {
  if (data.version !== CHUNKED_FORMAT_VERSION) {
    throw new TypeError(
      `unsupported chunked index version ${data.version}, this build understands ${CHUNKED_FORMAT_VERSION}`
    )
  }

  if (!data.chunks.length) {
    throw new TypeError('chunked index is empty')
  }

  return JSON.parse(data.chunks[0]) as ChunkHeader
}

export function fromChunkedRawData(data: ChunkedRawData): RawData {
  const header = readHeader(data)
  const root: Record<string, unknown> = {}
  let cursor = 1

  for (const part of header.parts) {
    const slot = beginPart(root, part)
    for (let i = 0; i < part.n; i++) {
      applyPiece(slot, part, JSON.parse(data.chunks[cursor++]))
    }
  }

  return root['root'] as RawData
}

export async function fromChunkedRawDataAsync(data: ChunkedRawData): Promise<RawData> {
  const header = readHeader(data)
  const root: Record<string, unknown> = {}
  let cursor = 1

  for (const part of header.parts) {
    const slot = beginPart(root, part)
    for (let i = 0; i < part.n; i++) {
      applyPiece(slot, part, JSON.parse(data.chunks[cursor++]))
      if (cursor < data.chunks.length) await yieldToEventLoop()
    }
  }

  return root['root'] as RawData
}

export function load<T extends AnyZBSearch>(zbsearch: T, raw: RawData | ChunkedRawData): void {
  const data = isChunkedRawData(raw) ? fromChunkedRawData(raw) : raw

  zbsearch.internalDocumentIDStore.load(zbsearch, data.internalDocumentIDStore)
  zbsearch.data.index = zbsearch.index.load(zbsearch.internalDocumentIDStore, data.index, zbsearch.indexes)
  zbsearch.data.docs = zbsearch.documentsStore.load(zbsearch.internalDocumentIDStore, data.docs)
  zbsearch.data.sorting = zbsearch.sorter.load(zbsearch.internalDocumentIDStore, data.sorting)
  zbsearch.data.pinning = zbsearch.pinning.load(zbsearch.internalDocumentIDStore, data.pinning)
  zbsearch.tokenizer.language = data.language
}

export async function loadAsync<T extends AnyZBSearch>(zbsearch: T, raw: RawData | ChunkedRawData): Promise<void> {
  const data = isChunkedRawData(raw) ? await fromChunkedRawDataAsync(raw) : raw

  zbsearch.internalDocumentIDStore.load(zbsearch, data.internalDocumentIDStore)
  await yieldToEventLoop()

  zbsearch.data.index = zbsearch.index.loadAsync
    ? await zbsearch.index.loadAsync(zbsearch.internalDocumentIDStore, data.index, zbsearch.indexes)
    : zbsearch.index.load(zbsearch.internalDocumentIDStore, data.index, zbsearch.indexes)
  await yieldToEventLoop()

  zbsearch.data.docs = zbsearch.documentsStore.load(zbsearch.internalDocumentIDStore, data.docs)
  await yieldToEventLoop()

  zbsearch.data.sorting = zbsearch.sorter.loadAsync
    ? await zbsearch.sorter.loadAsync(zbsearch.internalDocumentIDStore, data.sorting)
    : zbsearch.sorter.load(zbsearch.internalDocumentIDStore, data.sorting)
  await yieldToEventLoop()

  zbsearch.data.pinning = zbsearch.pinning.load(zbsearch.internalDocumentIDStore, data.pinning)
  zbsearch.tokenizer.language = data.language
}

export function save<T extends AnyZBSearch>(zbsearch: T): RawData
export function save<T extends AnyZBSearch>(zbsearch: T, options: SaveOptions & { format: 'chunked' }): ChunkedRawData
export function save<T extends AnyZBSearch>(zbsearch: T, options?: SaveOptions): RawData | ChunkedRawData
export function save<T extends AnyZBSearch>(zbsearch: T, options?: SaveOptions): RawData | ChunkedRawData {
  const raw: RawData = {
    internalDocumentIDStore: zbsearch.internalDocumentIDStore.save(zbsearch.internalDocumentIDStore),
    index: zbsearch.index.save(zbsearch.data.index),
    docs: zbsearch.documentsStore.save(zbsearch.data.docs),
    sorting: zbsearch.sorter.save(zbsearch.data.sorting),
    pinning: zbsearch.pinning.save(zbsearch.data.pinning),
    language: zbsearch.tokenizer.language
  }

  if (options?.format !== 'chunked') return raw

  return toChunkedRawData(raw, options.chunkSize ?? DEFAULT_CHUNK_SIZE)
}
