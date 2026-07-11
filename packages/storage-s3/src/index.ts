import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig
} from '@aws-sdk/client-s3'

import type { ObjectGetResult, ObjectStorage } from '@zbsearch/edge-core'

export interface S3StorageConfig {
  bucket: string
  region?: string
  endpoint?: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle?: boolean
  client?: S3Client
}

async function bodyToUint8(body: unknown): Promise<Uint8Array> {
  if (!body) {
    return new Uint8Array()
  }
  if (body instanceof Uint8Array) {
    return body
  }
  if (typeof body === 'object' && body !== null && 'transformToByteArray' in body) {
    return (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray()
  }
  const chunks: Uint8Array[] = []
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(config: S3StorageConfig) {
    const clientConfig: S3ClientConfig = {
      region: config.region ?? 'auto',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    }
    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint
      clientConfig.forcePathStyle = config.forcePathStyle ?? true
    }
    this.client = config.client ?? new S3Client(clientConfig)
    this.bucket = config.bucket
  }

  async get(key: string, opts?: { ifNoneMatch?: string }): Promise<ObjectGetResult | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          IfNoneMatch: opts?.ifNoneMatch
        })
      )
      if (!result.Body) {
        return null
      }
      return {
        body: await bodyToUint8(result.Body),
        etag: result.ETag ?? ''
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'name' in err && err.name === 'NoSuchKey') {
        return null
      }
      if (err && typeof err === 'object' && '$metadata' in err) {
        const metadata = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
        if (metadata?.httpStatusCode === 404) {
          return null
        }
      }
      throw err
    }
  }

  async put(key: string, body: Uint8Array, opts?: { contentType?: string }): Promise<{ etag: string }> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: opts?.contentType
      })
    )
    return { etag: result.ETag ?? '' }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key
      })
    )
  }

  async *list(prefix: string): AsyncIterable<{ key: string; size: number }> {
    let token: string | undefined
    do {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token
        })
      )
      for (const item of result.Contents ?? []) {
        if (item.Key) {
          yield { key: item.Key, size: item.Size ?? 0 }
        }
      }
      token = result.IsTruncated ? result.NextContinuationToken : undefined
    } while (token)
  }
}

export function createS3StorageFromEnv(env: Record<string, string | undefined> = process.env): S3ObjectStorage {
  const bucket = env.R2_BUCKET ?? env.S3_BUCKET
  const accessKeyId = env.R2_ACCESS_KEY_ID ?? env.S3_ACCESS_KEY_ID
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY ?? env.S3_SECRET_ACCESS_KEY
  const endpoint = env.R2_ENDPOINT ?? env.S3_ENDPOINT

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing R2_BUCKET/S3_BUCKET and access key env vars')
  }

  return new S3ObjectStorage({
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint,
    region: env.R2_REGION ?? env.AWS_REGION ?? 'auto'
  })
}
