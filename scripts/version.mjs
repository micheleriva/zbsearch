import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { inc, valid } from 'semver'
import { simpleGit } from 'simple-git'
import { fileURLToPath } from 'url'

const zbsearchPackage = JSON.parse(readFileSync('../packages/zbsearch/package.json', 'utf-8'))

const dryRun = process.env.DRY_RUN === 'true'
const skipGit = process.env.SKIP_GIT === 'true'
const skip = (process.env.SKIP ?? '').split(/\s*,\s*/).map(s => s.trim())

const REPO_URL = 'https://github.com/micheleriva/zbsearch'

// Every published package (kept in sync with scripts/release.mjs).
const packages = [
  'zbsearch',
  'edge-core',
  'edge-index-builder',
  'runtime-cloudflare',
  'storage-s3',
  'plugin-data-persistence',
  'plugin-parsedoc',
  'plugin-embeddings',
  'plugin-match-highlight',
  'plugin-qps',
  'plugin-pt15',
  'highlight',
  'searchbox-react',
  'plugin-docusaurus',
  'stemmers',
  'stopwords',
  'tokenizers',
].filter(p => !skip.includes(p))

async function updatePackage(path, version) {
  const packageJson = JSON.parse(await readFile(path))

  console.log(
    `\x1b[32mUpdating package \x1b[1m${packageJson.name}\x1b[22m from \x1b[1m${packageJson.version}\x1b[22m to version \x1b[1m${version}\x1b[22m ...\x1b[0m`,
  )
  packageJson.version = version

  if (!dryRun) {
    await writeFile(path, JSON.stringify(packageJson, null, 2), 'utf-8')
  }
}

// Roll the changelog: move everything under "## [Unreleased]" into a new
// "## [version] - date" section, leave a fresh empty Unreleased, and update the
// compare-link references at the bottom. Follows the Keep a Changelog format.
async function updateChangelog(newVersion, prevVersion, date) {
  const path = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url))

  if (!existsSync(path)) {
    console.log('\x1b[33mNo CHANGELOG.md found; skipping changelog update.\x1b[0m')
    return false
  }

  let content = await readFile(path, 'utf-8')

  const header = '## [Unreleased]'
  const start = content.indexOf(header)
  if (start === -1) {
    console.log('\x1b[33mNo "## [Unreleased]" section in CHANGELOG.md; skipping changelog update.\x1b[0m')
    return false
  }

  // The Unreleased body runs from just after its header to the next "## [" (the previous release).
  const afterHeader = start + header.length
  const rest = content.slice(afterHeader)
  const next = rest.match(/\n## \[/)
  const bodyEnd = next ? afterHeader + next.index : content.length
  const body = content.slice(afterHeader, bodyEnd).trim()

  const releaseBody = body.length && body !== '_Nothing yet._' ? body : '_No notable changes._'

  const replacement = `${header}\n\n_Nothing yet._\n\n## [${newVersion}] - ${date}\n\n${releaseBody}\n`
  content = content.slice(0, start) + replacement + content.slice(bodyEnd)

  // Point the [Unreleased] compare link at the freshly released version.
  content = content.replace(/^\[Unreleased\]:.*$/m, `[Unreleased]: ${REPO_URL}/compare/v${newVersion}...HEAD`)
  // Add the new version's compare link right below the [Unreleased] line.
  content = content.replace(
    /^(\[Unreleased\]:.*\n)/m,
    `$1[${newVersion}]: ${REPO_URL}/compare/v${prevVersion}...v${newVersion}\n`,
  )

  if (!dryRun) {
    await writeFile(path, content, 'utf-8')
  }
  console.log(
    `\x1b[32mUpdated \x1b[1mCHANGELOG.md\x1b[22m: released Unreleased as \x1b[1m${newVersion}\x1b[22m (${date}).\x1b[0m`,
  )
  return true
}

async function main() {
  if (!process.argv[2]) {
    console.error('\x1b[33mUsage: node version.mjs [VERSION | CHANGE [PRERELEASE]]\x1b[0m')
    process.exit(1)
  }

  const previousVersion = zbsearchPackage.version

  // Check if the new version is absolute, otherwise we take it from zbsearch and increase
  let version = process.argv[2]

  if (!valid(version)) {
    version = inc(zbsearchPackage.version, version, process.argv[3])
  }

  if (!valid(version)) {
    console.error(
      `\x1b[31mCannot increase version \x1b[1m${zbsearchPackage.version}\x1b[22m using operator \x1b[1m${process.argv[2]}\x1b[22m.\x1b[0m`,
    )
    process.exit(1)
  }

  // Update the root package.json
  await updatePackage(fileURLToPath(new URL(`../package.json`, import.meta.url)), version)

  // Update every published package
  for (const pkg of packages) {
    await updatePackage(fileURLToPath(new URL(`../packages/${pkg}/package.json`, import.meta.url)), version)
  }

  // Roll the changelog from Unreleased into this version
  const date = new Date().toISOString().slice(0, 10)
  const changelogUpdated = await updateChangelog(version, previousVersion, date)

  // Make the commit, including the tag
  if (!dryRun && !skipGit) {
    const git = simpleGit({ baseDir: fileURLToPath(new URL('..', import.meta.url)) })
    console.log(`\x1b[32mCommitting changes and creating a tag (pushing is left to you) ...\x1b[0m`)

    const files = ['package.json', ...packages.map(p => `packages/${p}/package.json`)]
    if (changelogUpdated) {
      files.push('CHANGELOG.md')
    }

    await git.commit('chore: updates version for release', files, { '--no-verify': true })
    await git.addTag(`v${version}`)
  }
}

await main()
