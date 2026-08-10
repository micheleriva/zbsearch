import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const packageRoot = path.dirname(fileURLToPath(import.meta.url))
const cliPath = path.join(packageRoot, '../src/cli.ts')

const validEnv = {
  ...process.env,
  R2_BUCKET: 'test-bucket',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret'
}

describe('cli', () => {
  it('prints usage for unknown commands when env is configured', () => {
    const result = spawnSync('node', ['--import', 'tsx', cliPath, 'unknown-command'], {
      encoding: 'utf8',
      env: validEnv
    })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /zbsearch-edge-builder (rebuild|import)/)
  })

  it('exits with error when env vars are missing', () => {
    const result = spawnSync('node', ['--import', 'tsx', cliPath, 'rebuild', 'test'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        R2_BUCKET: '',
        R2_ACCESS_KEY_ID: '',
        R2_SECRET_ACCESS_KEY: ''
      }
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Missing R2_BUCKET/)
  })
})
