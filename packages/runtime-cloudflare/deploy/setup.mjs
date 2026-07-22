#!/usr/bin/env node
import readline from 'node:readline/promises'
import {
  CONFIG_BASENAME,
  bucketsFromConfig,
  defaultBuildBeforeDeploy,
  getPaths,
  loadConfigFile,
  normalizeConfig,
  parseArgs,
  putSecret,
  run,
  saveConfigFile,
  resolveConfigFile,
  setDeployDirOverride,
  step,
  templatePath,
  writeGeneratedFiles
} from './lib.mjs'

function printHelp(paths) {
  console.log(`Usage: zbsearch-edge-setup [options] [config-file]

Configure and deploy ZBSearch Edge to Cloudflare.

Install (no repo clone required):
  npm init -y
  npm install @zbsearch/runtime-cloudflare wrangler
  npx zbsearch-edge-setup --init

Modes:
  Interactive wizard     npx zbsearch-edge-setup --init
  Config file            npx zbsearch-edge-setup --config ${CONFIG_BASENAME}
  Default config path    npx zbsearch-edge-setup

Options:
  --init            Run the interactive wizard and save ${CONFIG_BASENAME}
  --config <path>   Load JSON or YAML config (also accepts positional path)
  --deploy-dir <dir> Directory for wrangler.toml, .env, and config (default: project root)
  --write-only      Write wrangler.toml and .env only; do not provision or deploy
  --skip-deploy     Provision buckets/secrets/build, but skip Worker deploy
  --dry-run         Print planned actions without making changes
  --yes, -y         Skip confirmation before deploy
  -h, --help        Show this help

Generated files (in deploy directory):
  ${paths.wranglerConfig}
  ${paths.envFile}
  ${paths.configFile}

Examples:
  npx zbsearch-edge-setup --init
  cp ${templatePath('config.example.json')} ${CONFIG_BASENAME}
  npx zbsearch-edge-setup
`)
}

async function ask(rl, question, { defaultValue = '', secret = false } = {}) {
  const suffix = defaultValue === '' ? '' : ` [${defaultValue}]`
  if (secret) {
    console.log('(input will be visible)')
  }
  const answer = await rl.question(`${question}${suffix}: `)

  const trimmed = answer.trim()
  if (!trimmed) {
    return defaultValue
  }
  return trimmed
}

async function askYesNo(rl, question, defaultYes = true) {
  const hint = defaultYes ? 'Y/n' : 'y/N'
  const answer = (await rl.question(`${question} (${hint}): `)).trim().toLowerCase()
  if (!answer) {
    return defaultYes
  }
  return answer === 'y' || answer === 'yes'
}

async function runWizard(paths) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  console.log('\nZBSearch Edge setup wizard')
  console.log('Press Enter to accept defaults shown in [brackets].\n')

  const config = normalizeConfig()

  config.workerName = await ask(rl, 'Worker name', { defaultValue: config.workerName })
  config.r2.bucket = await ask(rl, 'R2 bucket name', { defaultValue: config.r2.bucket })
  config.r2.previewBucket = await ask(rl, 'Preview R2 bucket name', {
    defaultValue: config.r2.previewBucket
  })
  config.r2.createPreviewBucket = await askYesNo(rl, 'Create preview bucket in Cloudflare?', true)

  console.log('\nR2 S3 API credentials (for rebuild CLI and teardown). Leave blank to skip.')
  config.r2.accountId = await ask(rl, 'Cloudflare account ID', { defaultValue: config.r2.accountId })
  config.r2.accessKeyId = await ask(rl, 'R2 access key ID', { defaultValue: config.r2.accessKeyId })
  config.r2.secretAccessKey = await ask(rl, 'R2 secret access key', {
    defaultValue: config.r2.secretAccessKey,
    secret: true
  })

  console.log('\nWorker secrets (optional). Leave blank to skip.')
  config.secrets.writeApiKey = await ask(rl, 'Write API key (full access: writes + reads)', {
    defaultValue: config.secrets.writeApiKey,
    secret: true
  })
  config.secrets.readApiKey = await ask(rl, 'Read-only API key (search + status only)', {
    defaultValue: config.secrets.readApiKey,
    secret: true
  })
  config.secrets.builderWebhookUrl = await ask(rl, 'External rebuild webhook URL', {
    defaultValue: config.secrets.builderWebhookUrl
  })

  config.rebuild.thresholdOps = Number(
    await ask(rl, 'Auto-rebuild threshold (pending ops)', {
      defaultValue: String(config.rebuild.thresholdOps)
    })
  )
  config.rebuild.cron = await ask(rl, 'Cron schedule for rebuild checks', {
    defaultValue: config.rebuild.cron
  })

  if (defaultBuildBeforeDeploy(paths.projectRoot)) {
    config.deploy.buildBeforeDeploy = await askYesNo(rl, 'Build monorepo packages before deploy?', true)
  }

  rl.close()
  return config
}

async function confirmDeploy(config) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  console.log('\nReady to provision and deploy:')
  console.log(`  Worker: ${config.workerName}`)
  console.log(`  R2 bucket: ${config.r2.bucket}`)
  if (config.r2.createPreviewBucket) {
    console.log(`  Preview bucket: ${config.r2.previewBucket}`)
  }
  console.log(`  Write API key: ${config.secrets.writeApiKey ? 'set' : 'not set'}`)
  console.log(`  Read API key: ${config.secrets.readApiKey ? 'set' : 'not set'}`)
  console.log(`  Rebuild webhook: ${config.secrets.builderWebhookUrl ? 'set' : 'not set'}`)

  const answer = await rl.question('\nContinue? (y/N): ')
  rl.close()
  return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes'
}

async function ensureLoggedIn(paths, dryRun) {
  step('Checking Cloudflare authentication')
  await run(paths.wrangler, ['whoami'], { dryRun, allowFailure: false, cwd: paths.projectRoot })
}

async function createBuckets(config, paths, dryRun) {
  for (const bucket of bucketsFromConfig(config)) {
    step(`Ensuring R2 bucket "${bucket}" exists`)
    await run(paths.wrangler, ['r2', 'bucket', 'create', bucket], {
      dryRun,
      allowFailure: true,
      cwd: paths.projectRoot
    })
  }
}

async function setSecrets(config, paths, dryRun) {
  if (!config.secrets.readApiKey && !config.secrets.writeApiKey && !config.secrets.builderWebhookUrl) {
    return
  }

  step('Setting Worker secrets')
  await putSecret('READ_API_KEY', config.secrets.readApiKey, { dryRun, paths })
  await putSecret('WRITE_API_KEY', config.secrets.writeApiKey, { dryRun, paths })
  await putSecret('BUILDER_WEBHOOK_URL', config.secrets.builderWebhookUrl, { dryRun, paths })
}

async function buildPackages(paths, dryRun) {
  step('Building edge packages')
  await run('pnpm', ['--filter', '@zbsearch/edge-core', 'build'], {
    dryRun,
    cwd: paths.projectRoot
  })
  await run('pnpm', ['--filter', '@zbsearch/runtime-cloudflare', 'build'], {
    dryRun,
    cwd: paths.projectRoot
  })
}

async function deployWorker(paths, dryRun) {
  step('Deploying Worker')
  await run(paths.wrangler, ['deploy', '--config', paths.wranglerConfig], {
    dryRun,
    cwd: paths.projectRoot
  })
}

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2))

  if (options.deployDir) {
    setDeployDirOverride(options.deployDir)
  }

  const paths = getPaths()

  if (flags.has('help')) {
    printHelp(paths)
    return
  }

  const dryRun = flags.has('dry-run')
  const configPath =
    options.config ??
    resolveConfigFile(paths)

  let config
  if (flags.has('init')) {
    config = await runWizard(paths)
    if (!dryRun) {
      saveConfigFile(paths.configFile, config)
      console.log(`\nSaved ${paths.configFile}`)
    } else {
      console.log(`\n[dry-run] would save ${paths.configFile}`)
    }
  } else if (configPath) {
    config = loadConfigFile(configPath)
    if (!config) {
      throw new Error(`Config file not found: ${configPath}`)
    }
    console.log(`Using config: ${configPath}`)
  } else {
    console.log(`No config file found. Run: npx zbsearch-edge-setup --init`)
    console.log(
      `Or copy ${templatePath('config.example.json')} to ${CONFIG_BASENAME} in your project directory`
    )
    process.exit(1)
  }

  step('Writing wrangler.toml and .env')
  writeGeneratedFiles(config, { dryRun, paths })

  if (flags.has('write-only')) {
    console.log('\nDone. Generated wrangler.toml and .env only (--write-only).')
    return
  }

  if (!dryRun && !flags.has('yes')) {
    const ok = await confirmDeploy(config)
    if (!ok) {
      console.log('Aborted before provisioning.')
      return
    }
  }

  await ensureLoggedIn(paths, dryRun)
  await createBuckets(config, paths, dryRun)
  await setSecrets(config, paths, dryRun)

  if (config.deploy.buildBeforeDeploy) {
    await buildPackages(paths, dryRun)
  }

  if (flags.has('skip-deploy')) {
    console.log('\nDone. Provisioning complete (--skip-deploy).')
    return
  }

  await deployWorker(paths, dryRun)

  console.log('\nDone. ZBSearch Edge is deployed.')
  if (!dryRun) {
    console.log(`Worker name: ${config.workerName}`)
    console.log('To remove everything later: npx zbsearch-edge-teardown')
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
