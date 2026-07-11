import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client
} from '@aws-sdk/client-s3'

type StoredObject = { body: Uint8Array; etag: string; contentType?: string }

export class MockS3Backend {
  readonly objects = new Map<string, StoredObject>()

  createClient(bucket: string): S3Client {
    const store = this.objects
    return {
      send: async (command: unknown) => {
        if (command instanceof GetObjectCommand) {
          const key = command.input.Key!
          const obj = store.get(key)
          if (!obj) {
            const err = new Error('NoSuchKey')
            err.name = 'NoSuchKey'
            throw err
          }
          return {
            Body: obj.body,
            ETag: obj.etag
          }
        }

        if (command instanceof PutObjectCommand) {
          const key = command.input.Key!
          const body = command.input.Body as Uint8Array
          const etag = `"${crypto.randomUUID()}"`
          store.set(key, {
            body,
            etag,
            contentType: command.input.ContentType
          })
          return { ETag: etag }
        }

        if (command instanceof DeleteObjectCommand) {
          store.delete(command.input.Key!)
          return {}
        }

        if (command instanceof ListObjectsV2Command) {
          const prefix = command.input.Prefix ?? ''
          const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort()
          return {
            Contents: keys.map((key) => ({
              Key: key,
              Size: store.get(key)!.body.byteLength
            })),
            IsTruncated: false
          }
        }

        throw new Error(`Unsupported command: ${command}`)
      }
    } as unknown as S3Client
  }
}
