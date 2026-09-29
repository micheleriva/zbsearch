// Refuses to publish a package whose manifest still contains `workspace:` ranges.
//
// pnpm rewrites `workspace:*` to the real version when it publishes, but npm and
// yarn ship the manifest as-is. That produced 4.0.0 plugins depending on
// "zbsearch@workspace:*", which no package manager can install outside this repo
// (https://github.com/micheleriva/zbsearch/issues/58). Each published package runs
// this as its `prepublishOnly` hook so a stray `npm publish` fails instead.
//
// pnpm runs prepublishOnly before it rewrites the manifest, so the check keys off
// the package manager that started the publish rather than the manifest contents.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const userAgent = process.env.npm_config_user_agent ?? ''
const tool = userAgent.split('/')[0] || 'an unknown tool'

if (tool === 'pnpm') {
  process.exit(0)
}

const manifestPath = resolve(process.cwd(), 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

const fields = ['dependencies', 'optionalDependencies', 'peerDependencies']
const unresolved = []

for (const field of fields) {
  for (const [name, range] of Object.entries(manifest[field] ?? {})) {
    if (typeof range === 'string' && range.startsWith('workspace:')) {
      unresolved.push(`${field}.${name} = "${range}"`)
    }
  }
}

if (unresolved.length === 0) {
  process.exit(0)
}

console.error(
  `\x1b[31mRefusing to publish ${manifest.name}@${manifest.version}: the manifest still contains workspace ranges.\x1b[0m`
)
for (const entry of unresolved) {
  console.error(`  - ${entry}`)
}
console.error(
  `\nThis publish was started with ${tool}, which does not rewrite the workspace protocol.\n` +
    `Release with \`pnpm publish-packages\` from the repository root, or \`pnpm publish\` from the package folder.`
)
process.exit(1)
