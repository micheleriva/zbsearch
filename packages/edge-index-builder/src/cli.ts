#!/usr/bin/env node
import { rebuildIndex, listIndexMetas } from '@zbsearch/edge-core'
import { createS3StorageFromEnv } from '@zbsearch/storage-s3'

async function main(): Promise<void> {
  const [command, indexId] = process.argv.slice(2)
  const storage = createS3StorageFromEnv()

  if (command === 'rebuild') {
    if (indexId && indexId !== '--all') {
      const meta = await rebuildIndex(storage, indexId)
      console.log(JSON.stringify({ indexId: meta.id, liveVersion: meta.liveVersion, documents: meta.documents }))
      return
    }

    const indexes = await listIndexMetas(storage)
    for (const index of indexes) {
      if (index.pendingOps === 0 && index.status === 'ready' && index.liveVersion) {
        continue
      }
      const meta = await rebuildIndex(storage, index.id)
      console.log(JSON.stringify({ indexId: meta.id, liveVersion: meta.liveVersion, documents: meta.documents }))
    }
    return
  }

  console.log(`Usage:
  zbsearch-edge-builder rebuild [indexId]
  zbsearch-edge-builder rebuild --all`)
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
