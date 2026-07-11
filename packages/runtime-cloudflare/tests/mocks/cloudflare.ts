type StoredObject = {
  body: Uint8Array
  httpEtag: string
  customMetadata?: Record<string, string>
}

export class MockR2Bucket {
  private readonly objects = new Map<string, StoredObject>()

  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpEtag: string } | null> {
    const obj = this.objects.get(key)
    if (!obj) {
      return null
    }
    const body = obj.body
    return {
      httpEtag: obj.httpEtag,
      arrayBuffer: async () => {
        const copy = new Uint8Array(body.byteLength)
        copy.set(body)
        return copy.buffer
      }
    }
  }

  async put(
    key: string,
    body: Uint8Array | ReadableStream | string,
    opts?: { httpMetadata?: { contentType?: string } }
  ): Promise<{ httpEtag: string }> {
    const bytes =
      body instanceof Uint8Array
        ? body
        : typeof body === 'string'
          ? new TextEncoder().encode(body)
          : new Uint8Array()
    const httpEtag = `"${crypto.randomUUID()}"`
    this.objects.set(key, { body: bytes, httpEtag })
    if (opts?.httpMetadata?.contentType) {
      this.objects.get(key)!.customMetadata = { contentType: opts.httpMetadata.contentType }
    }
    return { httpEtag }
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }

  async list(opts: { prefix?: string; cursor?: string }): Promise<{
    objects: Array<{ key: string; size: number }>
    truncated: boolean
    cursor?: string
  }> {
    const prefix = opts.prefix ?? ''
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort()
    return {
      objects: keys.map((key) => ({ key, size: this.objects.get(key)!.body.byteLength })),
      truncated: false
    }
  }

  keys(): string[] {
    return [...this.objects.keys()]
  }
}

export class MockCache {
  private readonly entries = new Map<string, Response>()

  async match(key: string): Promise<Response | undefined> {
    return this.entries.get(key)
  }

  async put(key: string, response: Response): Promise<void> {
    this.entries.set(key, response)
  }

  async delete(key: string): Promise<boolean> {
    return this.entries.delete(key)
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }
}
