import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import type { ShardStorage } from './storage.js'

const TEMP_SUFFIX = '.zbsearch-tmp'

function assertSafeKey(key: string): void {
  if (key.length === 0 || key.startsWith('/') || key.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`[zbsearch-sharded] invalid storage key "${key}"`)
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

/**
 * Stores every key as a file below `directory` (Node.js, Electron, Bun, Deno
 * with Node compatibility). Writes go to a temporary file that is renamed over
 * the destination, so a crash never leaves a half-written snapshot or state.
 */
export class FileSystemStorage implements ShardStorage {
  constructor(readonly directory: string) {}

  private path(key: string): string {
    assertSafeKey(key)
    return join(this.directory, ...key.split('/'))
  }

  async get(key: string): Promise<{ body: Uint8Array } | null> {
    try {
      const body = await readFile(this.path(key))
      return { body: new Uint8Array(body.buffer, body.byteOffset, body.byteLength) }
    } catch (error) {
      if (isMissing(error)) {
        return null
      }
      throw error
    }
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    const path = this.path(key)
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${TEMP_SUFFIX}`
    await writeFile(temp, body)
    await rename(temp, path)
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true })
  }

  async *list(prefix: string): AsyncIterable<{ key: string }> {
    // Walk only the deepest directory the prefix names.
    const slash = prefix.lastIndexOf('/')
    const base = slash === -1 ? this.directory : join(this.directory, ...prefix.slice(0, slash).split('/'))
    const keys: string[] = []

    const walk = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch (error) {
        if (isMissing(error)) {
          return
        }
        throw error
      }

      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
        } else if (!entry.name.endsWith(TEMP_SUFFIX)) {
          const key = relative(this.directory, full).split(sep).join('/')
          if (key.startsWith(prefix)) {
            keys.push(key)
          }
        }
      }
    }

    await walk(base)
    keys.sort()
    for (const key of keys) {
      yield { key }
    }
  }
}
