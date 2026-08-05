import type { EncoderRequest, EncoderResponse } from '@/workers/encoder.worker'

export type EncoderStatus =
  | { state: 'cold' }
  | { state: 'loading'; received: number; total: number }
  | { state: 'ready'; device: string; dimensions: number; loadMs: number }
  | { state: 'failed'; message: string }

export interface Encoding {
  vector: number[]
  /** Encode time in milliseconds, or 0 when the vector came from the cache. */
  ms: number
  cached: boolean
}

/**
 * The main-thread half of the query encoder.
 *
 * Everything expensive happens in the worker; this is the promise-shaped door to it, plus
 * a cache. The cache matters more than it looks: every slider in the console re-runs the
 * current query, and re-encoding the same six words each time would make the whole
 * console feel slow for no reason.
 */
export class Encoder {
  private worker: Worker | undefined
  private pending = new Map<number, { resolve: (value: Encoding) => void; reject: (error: Error) => void }>()
  private cache = new Map<string, number[]>()
  private files = new Map<string, { loaded: number; total: number }>()
  private nextId = 1

  status: EncoderStatus = { state: 'cold' }

  constructor(
    private model: string,
    private onStatus: (status: EncoderStatus) => void
  ) {}

  /** Starts the download. Safe to call repeatedly; only the first call does anything. */
  warm(): void {
    if (this.worker) {
      return
    }

    this.worker = new Worker(new URL('../workers/encoder.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = event => this.receive(event.data)
    this.worker.onerror = event => this.fail(event.message || 'The encoder worker could not be started')

    this.set({ state: 'loading', received: 0, total: 0 })
    this.send({ type: 'warm', model: this.model })
  }

  /**
   * Encodes a query. Warms the model first if that has not happened yet, so callers can
   * treat the download as an implementation detail and simply await the vector.
   */
  embed(text: string): Promise<Encoding> {
    const key = text.trim()
    const hit = this.cache.get(key)

    if (hit) {
      return Promise.resolve({ vector: hit, ms: 0, cached: true })
    }

    this.warm()

    const id = this.nextId++

    return new Promise<Encoding>((resolve, reject) => {
      this.pending.set(id, {
        resolve: encoding => {
          this.cache.set(key, encoding.vector)
          resolve(encoding)
        },
        reject,
      })

      this.send({ type: 'embed', id, text: key })
    })
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = undefined

    for (const { reject } of this.pending.values()) {
      reject(new Error('The encoder was disposed'))
    }

    this.pending.clear()
  }

  private send(request: EncoderRequest): void {
    this.worker?.postMessage(request)
  }

  private set(status: EncoderStatus): void {
    this.status = status
    this.onStatus(status)
  }

  private fail(message: string): void {
    this.set({ state: 'failed', message })

    for (const { reject } of this.pending.values()) {
      reject(new Error(message))
    }

    this.pending.clear()
  }

  private receive(message: EncoderResponse): void {
    switch (message.type) {
      case 'progress': {
        /*
         * Progress arrives per file — weights, tokeniser, config — so the numbers have to
         * be summed rather than shown one at a time, or the bar restarts on every file.
         */
        this.files.set(message.file, { loaded: message.loaded, total: message.total })

        let received = 0
        let total = 0

        for (const file of this.files.values()) {
          received += file.loaded
          total += file.total
        }

        this.set({ state: 'loading', received, total })
        return
      }

      case 'ready':
        this.set({
          state: 'ready',
          device: message.device,
          dimensions: message.dimensions,
          loadMs: message.ms,
        })
        return

      case 'embedded': {
        const waiting = this.pending.get(message.id)
        this.pending.delete(message.id)
        waiting?.resolve({ vector: message.vector, ms: message.ms, cached: false })
        return
      }

      case 'failed': {
        if (message.id === undefined) {
          this.fail(message.message)
          return
        }

        const waiting = this.pending.get(message.id)
        this.pending.delete(message.id)
        waiting?.reject(new Error(message.message))
      }
    }
  }
}
