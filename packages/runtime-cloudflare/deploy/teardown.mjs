#!/usr/bin/env node
import readline from 'node:readline/promises'
import {
  SECRET_NAMES,
  emptyBucket,
  getPaths,
  parseArgs,
  resolveTeardownConfig,
  run,
  setDeployDirOverride,
  step
} from './lib.mjs'

async function confirm(plan) {
  console.log('\nThis will remove the following Cloudflare resources:')
  for (const line of plan) {
    console.log(`  - ${line}`)
  }
  console.log('\nThis cannot be undone.')

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  const answer = await rl.question('Type "teardown" to continue: ')
  rl.close()
  return answer.trim() === 'teardown'
}

function printHelp() {
  console.log(`Usage: zbsearch-edge-teardown [options]

Remove ZBSearch Edge from Cloudflare (Worker, secrets, and R2 buckets).

Options:
  --deploy-dir <dir> Directory with wrangler.toml and config (default: project root)
  --yes, -y         Skip confirmation prompt
  --dry-run         Print planned actions without making changes
  --keep-buckets    Delete only the Worker; leave R2 buckets and data intact
  -h, --help        Show this help

Examples:
  npx zbsearch-edge-teardown --dry-run
  npx zbsearch-edge-teardown --yes
  npx zbsearch-edge-teardown --keep-buckets --yes
`)
}

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2))

  if (options.deployDir) {
    setDeployDirOverride(options.deployDir)
  }

  const paths = getPaths()

  if (flags.has('help')) {
    printHelp()
    return
  }

  const dryRun = flags.has('dry-run')
  const keepBuckets = flags.has('keep-buckets')
  const { workerName, buckets, r2Credentials } = resolveTeardownConfig(paths)

  const plan = [`Worker "${workerName}"`]
  for (const secret of SECRET_NAMES) {
    plan.push(`Worker secret "${secret}" (if present)`)
  }
  if (!keepBuckets) {
    for (const bucket of buckets) {
      plan.push(`All objects in R2 bucket "${bucket}"`)
      plan.push(`R2 bucket "${bucket}"`)
    }
  }

  if (!dryRun && !flags.has('yes')) {
    const ok = await confirm(plan)
    if (!ok) {
      console.log('Aborted.')
      return
    }
  } else if (dryRun) {
    console.log('Dry run - no changes will be made.')
    for (const line of plan) {
      console.log(`  - ${line}`)
    }
  }

  step(`Deleting Worker "${workerName}"`)
  for (const secret of SECRET_NAMES) {
    await run(
      paths.wrangler,
      ['secret', 'delete', secret, '--config', paths.wranglerConfig],
      {
        allowFailure: true,
        dryRun,
        cwd: paths.projectRoot
      }
    )
  }
  await run(
    paths.wrangler,
    ['delete', workerName, '--config', paths.wranglerConfig, '--force'],
    {
      allowFailure: true,
      dryRun,
      cwd: paths.projectRoot
    }
  )

  if (keepBuckets) {
    console.log('\nDone. R2 buckets were left intact (--keep-buckets).')
    return
  }

  if (!r2Credentials) {
    console.log(
      `\nNote: R2 API credentials are missing from config or .env. Object deletion will be skipped.`
    )
    console.log('Fill zbsearch.edge.config.json or .env and rerun,')
    console.log('or empty buckets manually in the Cloudflare dashboard.\n')
  }

  for (const bucket of buckets) {
    if (r2Credentials) {
      step(`Emptying R2 bucket "${bucket}"`)
      const deleted = await emptyBucket({
        bucket,
        ...r2Credentials,
        dryRun
      })
      console.log(`  Removed ${deleted} object(s).`)
    }

    step(`Deleting R2 bucket "${bucket}"`)
    await run(paths.wrangler, ['r2', 'bucket', 'delete', bucket], {
      allowFailure: true,
      dryRun,
      cwd: paths.projectRoot
    })
  }

  console.log('\nDone. ZBSearch Edge resources were removed from Cloudflare.')
  if (!dryRun) {
    console.log('To deploy again: npx zbsearch-edge-setup')
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
