import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const PACKAGE_ROOT = resolve(__dirname, '..')
export const TEMPLATES_DIR = resolve(__dirname, 'templates')
export const SECRET_NAMES = ['API_KEY', 'BUILDER_WEBHOOK_URL']
export const CONFIG_BASENAME = 'zbsearch.edge.config.json'

const requireFromPackage = createRequire(resolve(PACKAGE_ROOT, 'package.json'))

let deployDirOverride = null

export function setDeployDirOverride(path) {
  deployDirOverride = path
}

export function getProjectRoot() {
  return process.cwd()
}

export function isMonorepo(projectRoot = getProjectRoot()) {
  return (
    existsSync(resolve(projectRoot, 'pnpm-workspace.yaml')) &&
    existsSync(resolve(projectRoot, 'packages/runtime-cloudflare/package.json'))
  )
}

export function resolveDeployDir(projectRoot = getProjectRoot()) {
  if (deployDirOverride) {
    return resolve(projectRoot, deployDirOverride)
  }
  if (isMonorepo(projectRoot) && existsSync(resolve(projectRoot, 'deploy/cloudflare'))) {
    return resolve(projectRoot, 'deploy/cloudflare')
  }
  return projectRoot
}

export function getPaths(projectRoot = getProjectRoot()) {
  const deployDir = resolveDeployDir(projectRoot)
  return {
    projectRoot,
    deployDir,
    wranglerConfig: resolve(deployDir, 'wrangler.toml'),
    envFile: resolve(deployDir, '.env'),
    configFile: resolve(deployDir, CONFIG_BASENAME),
    wrangler: resolveWrangler(projectRoot)
  }
}

export function resolveWrangler(projectRoot = getProjectRoot()) {
  const local = resolve(projectRoot, 'node_modules/.bin/wrangler')
  if (existsSync(local)) {
    return local
  }
  return 'wrangler'
}

export function workerMainRelative(deployDir, projectRoot = getProjectRoot()) {
  if (isMonorepo(projectRoot)) {
    const workerPath = resolve(projectRoot, 'packages/runtime-cloudflare/src/worker.ts')
    return relative(deployDir, workerPath).split('\\').join('/')
  }
  return 'node_modules/@zbsearch/runtime-cloudflare/src/worker.ts'
}

export const DEFAULT_CONFIG = {
  workerName: 'zbsearch-edge',
  r2: {
    bucket: 'zbsearch-edge',
    previewBucket: 'zbsearch-edge-preview',
    createPreviewBucket: true,
    accountId: '',
    accessKeyId: '',
    secretAccessKey: ''
  },
  secrets: {
    apiKey: '',
    builderWebhookUrl: ''
  },
  rebuild: {
    thresholdOps: 500,
    cron: '*/5 * * * *'
  },
  routes: [],
  deploy: {
    buildBeforeDeploy: null
  },
  limits: {
    cpuMs: null
  }
}

export function defaultBuildBeforeDeploy(projectRoot = getProjectRoot()) {
  return isMonorepo(projectRoot)
}

export function parseArgs(argv) {
  const flags = new Set()
  const options = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--yes' || arg === '-y') {
      flags.add('yes')
    } else if (arg === '--dry-run') {
      flags.add('dry-run')
    } else if (arg === '--keep-buckets') {
      flags.add('keep-buckets')
    } else if (arg === '--init') {
      flags.add('init')
    } else if (arg === '--write-only') {
      flags.add('write-only')
    } else if (arg === '--skip-deploy') {
      flags.add('skip-deploy')
    } else if (arg === '--help' || arg === '-h') {
      flags.add('help')
    } else if (arg === '--config') {
      options.config = argv[++i]
    } else if (arg === '--deploy-dir') {
      options.deployDir = argv[++i]
    } else if (!arg.startsWith('-')) {
      options.config ??= arg
    }
  }

  return { flags, options }
}

function parseJson(text, source) {
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`Invalid JSON in ${source}: ${err instanceof Error ? err.message : err}`)
  }
}

function parseSimpleYaml(text, source) {
  const result = {}
  const stack = [{ indent: -1, value: result }]
  const lines = text.split('\n')

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const raw = lines[lineNo]
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const indent = raw.match(/^\s*/)?.[0].length ?? 0
    const match = trimmed.match(/^([^:]+):\s*(.*)$/)
    if (!match) {
      throw new Error(`Invalid YAML in ${source} at line ${lineNo + 1}`)
    }

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop()
    }

    const key = match[1].trim()
    let value = match[2].trim()

    if (value === '') {
      const child = {}
      stack[stack.length - 1].value[key] = child
      stack.push({ indent, value: child })
      continue
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else if (value === 'true') {
      value = true
    } else if (value === 'false') {
      value = false
    } else if (/^-?\d+$/.test(value)) {
      value = Number(value)
    }

    stack[stack.length - 1].value[key] = value
  }

  return result
}

export function loadConfigFile(path) {
  if (!existsSync(path)) {
    return null
  }

  const text = readFileSync(path, 'utf8')
  const parsed =
    path.endsWith('.yaml') || path.endsWith('.yml')
      ? parseSimpleYaml(text, path)
      : parseJson(text, path)

  return normalizeConfig(parsed)
}

export function normalizeConfig(input = {}, projectRoot = getProjectRoot()) {
  const config = structuredClone(DEFAULT_CONFIG)

  if (input.workerName) {
    config.workerName = String(input.workerName)
  }

  if (input.r2) {
    Object.assign(config.r2, input.r2)
  }

  if (input.secrets) {
    Object.assign(config.secrets, input.secrets)
  }

  if (input.rebuild) {
    Object.assign(config.rebuild, input.rebuild)
  }

  if (Array.isArray(input.routes)) {
    config.routes = input.routes
  }

  if (input.deploy) {
    Object.assign(config.deploy, input.deploy)
  }

  if (input.limits) {
    Object.assign(config.limits, input.limits)
  }

  if (config.deploy.buildBeforeDeploy === null) {
    config.deploy.buildBeforeDeploy = defaultBuildBeforeDeploy(projectRoot)
  }

  return config
}

export function saveConfigFile(path, config) {
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

export function templatePath(name) {
  return resolve(TEMPLATES_DIR, name)
}

export function r2Endpoint(accountId) {
  return `https://${accountId}.r2.cloudflarestorage.com`
}

export function renderWranglerToml(config, paths = getPaths()) {
  const routes =
    config.routes.length > 0
      ? `\nroutes = [\n${config.routes
          .map(route => `  { pattern = "${route.pattern}", zone_name = "${route.zoneName}" }`)
          .join(',\n')}\n]\n`
      : ''

  const workerMain = workerMainRelative(paths.deployDir, paths.projectRoot)
  const cpuLimit =
    config.limits?.cpuMs != null
      ? `\n[limits]\ncpu_ms = ${config.limits.cpuMs}\n`
      : '\n# Optional paid-plan CPU limit (uncomment and set limits.cpuMs in config):\n# [limits]\n# cpu_ms = 300000\n'

  return `name = "${config.workerName}"
main = "${workerMain}"
compatibility_date = "2025-03-01"
compatibility_flags = ["nodejs_compat"]

[observability]
enabled = true

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "${config.r2.bucket}"
preview_bucket_name = "${config.r2.previewBucket}"

[triggers]
crons = ["${config.rebuild.cron}"]

[vars]
REBUILD_THRESHOLD_OPS = "${config.rebuild.thresholdOps}"

# Set via zbsearch-edge-setup or \`wrangler secret put API_KEY\`
# Set via zbsearch-edge-setup or \`wrangler secret put BUILDER_WEBHOOK_URL\`
${cpuLimit}${routes}`
}

export function renderEnvFile(config) {
  const endpoint = config.r2.accountId
    ? r2Endpoint(config.r2.accountId)
    : 'https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com'

  return `# Generated by zbsearch-edge-setup
R2_BUCKET=${config.r2.bucket}
R2_ACCESS_KEY_ID=${config.r2.accessKeyId}
R2_SECRET_ACCESS_KEY=${config.r2.secretAccessKey}
R2_ENDPOINT=${endpoint}

API_KEY=${config.secrets.apiKey}
REBUILD_THRESHOLD_OPS=${config.rebuild.thresholdOps}
BUILDER_WEBHOOK_URL=${config.secrets.builderWebhookUrl}
`
}

export function writeGeneratedFiles(config, { dryRun = false, paths = getPaths() } = {}) {
  const wranglerToml = renderWranglerToml(config, paths)
  const envFile = renderEnvFile(config)

  if (dryRun) {
    console.log(`  [dry-run] write ${paths.wranglerConfig}`)
    console.log(`  [dry-run] write ${paths.envFile}`)
    return
  }

  mkdirSync(paths.deployDir, { recursive: true })
  writeFileSync(paths.wranglerConfig, wranglerToml, 'utf8')
  writeFileSync(paths.envFile, envFile, 'utf8')
}

export function readWranglerConfig(path) {
  const text = readFileSync(path, 'utf8')
  const name = text.match(/^name\s*=\s*"([^"]+)"/m)?.[1]
  const bucketName = text.match(/bucket_name\s*=\s*"([^"]+)"/)?.[1]
  const previewBucketName = text.match(/preview_bucket_name\s*=\s*"([^"]+)"/)?.[1]
  if (!name || !bucketName) {
    throw new Error(`Could not parse worker or bucket name from ${path}`)
  }
  return { name, bucketName, previewBucketName }
}

export function loadEnv(path) {
  if (!existsSync(path)) {
    return {}
  }

  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const idx = trimmed.indexOf('=')
    if (idx === -1) {
      continue
    }
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
  }
  return env
}

export function getR2Credentials(configOrEnv) {
  const accessKeyId = configOrEnv.r2?.accessKeyId ?? configOrEnv.R2_ACCESS_KEY_ID
  const secretAccessKey = configOrEnv.r2?.secretAccessKey ?? configOrEnv.R2_SECRET_ACCESS_KEY
  const endpoint = configOrEnv.r2?.accountId
    ? r2Endpoint(configOrEnv.r2.accountId)
    : configOrEnv.R2_ENDPOINT

  if (!accessKeyId || !secretAccessKey || !endpoint) {
    return null
  }

  return { accessKeyId, secretAccessKey, endpoint }
}

export function step(message) {
  console.log(`\n→ ${message}`)
}

export async function run(command, args, { allowFailure = false, dryRun = false, input, cwd } = {}) {
  const printable = [command, ...args].join(' ')
  if (dryRun) {
    console.log(`  [dry-run] ${printable}`)
    return 0
  }

  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: cwd ?? getProjectRoot(),
      stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit']
    })
    child.on('error', reject)
    if (input !== undefined) {
      child.stdin.write(input)
      child.stdin.end()
    }
    child.on('close', code => {
      if (code !== 0 && !allowFailure) {
        reject(new Error(`Command failed (${code}): ${printable}`))
        return
      }
      resolvePromise(code ?? 0)
    })
  })
}

export async function putSecret(name, value, { dryRun = false, paths = getPaths() } = {}) {
  if (!value) {
    return
  }
  await run(
    paths.wrangler,
    ['secret', 'put', name, '--config', paths.wranglerConfig],
    {
      dryRun,
      input: value,
      cwd: paths.projectRoot
    }
  )
}

export async function emptyBucket({ bucket, endpoint, accessKeyId, secretAccessKey, dryRun }) {
  const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } =
    requireFromPackage('@aws-sdk/client-s3')

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true
  })

  let token
  let deleted = 0

  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: token
      })
    )

    const objects = (list.Contents ?? [])
      .filter(item => item.Key)
      .map(item => ({ Key: item.Key }))

    if (objects.length > 0) {
      if (dryRun) {
        deleted += objects.length
      } else {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects }
          })
        )
        deleted += objects.length
      }
    }

    token = list.IsTruncated ? list.NextContinuationToken : undefined
  } while (token)

  return deleted
}

export function bucketsFromConfig(config) {
  const buckets = [config.r2.bucket]
  if (config.r2.createPreviewBucket && config.r2.previewBucket) {
    buckets.push(config.r2.previewBucket)
  }
  return buckets
}

export function resolveConfigFile(paths = getPaths()) {
  if (existsSync(paths.configFile)) {
    return paths.configFile
  }
  const legacyJson = resolve(paths.deployDir, 'config.json')
  if (existsSync(legacyJson)) {
    return legacyJson
  }
  const legacyYaml = resolve(paths.deployDir, 'config.yaml')
  if (existsSync(legacyYaml)) {
    return legacyYaml
  }
  return null
}

export function resolveTeardownConfig(paths = getPaths()) {
  const configPath = resolveConfigFile(paths)
  const fileConfig = configPath ? loadConfigFile(configPath) : null
  if (fileConfig) {
    return {
      workerName: fileConfig.workerName,
      buckets: bucketsFromConfig(fileConfig),
      r2Credentials: getR2Credentials(fileConfig)
    }
  }

  const wrangler = readWranglerConfig(paths.wranglerConfig)
  const env = loadEnv(paths.envFile)
  return {
    workerName: wrangler.name,
    buckets: [wrangler.bucketName, wrangler.previewBucketName].filter(Boolean),
    r2Credentials: getR2Credentials(env)
  }
}

