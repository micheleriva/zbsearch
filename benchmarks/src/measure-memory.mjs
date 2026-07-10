import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const workerPath = join(__dirname, 'memory-worker.mjs')

export function measureEngineMemory(engine, options = {}) {
  const { searches = 0 } = options
  const result = spawnSync(
    process.execPath,
    ['--expose-gc', workerPath, engine, String(searches)],
    {
      encoding: 'utf8',
      env: process.env
    }
  )

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `memory worker failed for ${engine}`)
  }

  return JSON.parse(result.stdout.trim())
}

export function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function formatDelta(label, bytes, baseline) {
  const pct = baseline === 0 ? 0 : ((bytes - baseline) / baseline) * 100
  const sign = bytes >= baseline ? '+' : ''
  return `${label}: ${formatBytes(bytes)} (${sign}${pct.toFixed(1)}% vs Orama)`
}
