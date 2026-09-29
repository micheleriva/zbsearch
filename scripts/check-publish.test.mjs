import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const guard = fileURLToPath(new URL('./check-publish.mjs', import.meta.url))

// Runs the guard the way a package manager would: from the package folder,
// with `npm_config_user_agent` describing the tool that started the publish.
function runGuard(manifest, userAgent) {
  const cwd = mkdtempSync(join(tmpdir(), 'zbsearch-check-publish-'))
  writeFileSync(join(cwd, 'package.json'), JSON.stringify(manifest))

  const env = { ...process.env }
  delete env.npm_config_user_agent
  if (userAgent !== undefined) {
    env.npm_config_user_agent = userAgent
  }

  try {
    const result = spawnSync(process.execPath, [guard], { cwd, env, encoding: 'utf-8' })
    return { status: result.status, stderr: result.stderr }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

const workspaceManifest = {
  name: '@zbsearch/plugin-fixture',
  version: '4.0.0',
  dependencies: { zbsearch: 'workspace:*', dpack: '^0.6.22' }
}

test('rejects an npm publish whose dependencies still hold workspace ranges', () => {
  const { status, stderr } = runGuard(workspaceManifest, 'npm/11.13.0 node/v24.16.0 darwin arm64')

  assert.equal(status, 1)
  assert.match(stderr, /Refusing to publish @zbsearch\/plugin-fixture@4\.0\.0/)
  assert.match(stderr, /dependencies\.zbsearch = "workspace:\*"/)
  assert.match(stderr, /started with npm/)
  assert.doesNotMatch(stderr, /dpack/)
})

test('rejects a publish started outside any package manager', () => {
  const { status } = runGuard(workspaceManifest, undefined)

  assert.equal(status, 1)
})

test('lets pnpm through because it rewrites workspace ranges itself', () => {
  const { status, stderr } = runGuard(workspaceManifest, 'pnpm/11.10.0 npm/? node/v24.16.0 darwin arm64')

  assert.equal(status, 0)
  assert.equal(stderr, '')
})

test('lets npm publish a manifest with no workspace ranges', () => {
  const { status } = runGuard(
    { name: 'zbsearch', version: '4.0.0', dependencies: { '@zbsearch/stemmers': '4.0.0' } },
    'npm/11.13.0 node/v24.16.0 darwin arm64'
  )

  assert.equal(status, 0)
})

test('ignores workspace ranges in devDependencies, which consumers never install', () => {
  const { status } = runGuard(
    { name: 'zbsearch', version: '4.0.0', devDependencies: { '@zbsearch/tokenizers': 'workspace:*' } },
    'npm/11.13.0 node/v24.16.0 darwin arm64'
  )

  assert.equal(status, 0)
})

test('checks optional and peer dependencies too', () => {
  for (const field of ['optionalDependencies', 'peerDependencies']) {
    const { status, stderr } = runGuard(
      { name: 'zbsearch', version: '4.0.0', [field]: { '@zbsearch/highlight': 'workspace:^' } },
      'npm/11.13.0 node/v24.16.0 darwin arm64'
    )

    assert.equal(status, 1, field)
    assert.match(stderr, new RegExp(`${field}\\.@zbsearch/highlight = "workspace:\\^"`))
  }
})
