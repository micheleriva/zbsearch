const encoder = new TextEncoder()
const decoder = new TextDecoder()

const MAX_SAFE_VARINT = Number.MAX_SAFE_INTEGER

export class ByteWriter {
  private buffer = new Uint8Array(1024)
  private used = 0

  private ensure(extra: number): void {
    if (this.used + extra <= this.buffer.length) {
      return
    }

    let size = this.buffer.length * 2
    while (size < this.used + extra) {
      size *= 2
    }

    const next = new Uint8Array(size)
    next.set(this.buffer.subarray(0, this.used))
    this.buffer = next
  }

  public writeVarint(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > MAX_SAFE_VARINT) {
      throw new TypeError(`varint values must be non-negative integers, got "${value}"`)
    }

    this.ensure(8)
    // Values beyond 32 bits lose precision under bitwise operators, so the
    // loop works on plain arithmetic instead.
    while (value > 0x7f) {
      this.buffer[this.used++] = (value % 0x80) | 0x80
      value = Math.floor(value / 0x80)
    }
    this.buffer[this.used++] = value
  }

  public writeBytes(bytes: Uint8Array): void {
    this.ensure(bytes.length)
    this.buffer.set(bytes, this.used)
    this.used += bytes.length
  }

  public writeString(value: string): void {
    const bytes = encoder.encode(value)
    this.writeVarint(bytes.length)
    this.writeBytes(bytes)
  }

  public get length(): number {
    return this.used
  }

  public toUint8Array(): Uint8Array {
    return this.buffer.slice(0, this.used)
  }
}

export class ByteReader {
  private offset = 0

  constructor(private readonly bytes: Uint8Array) {}

  public readVarint(): number {
    let value = 0
    let factor = 1

    for (;;) {
      if (this.offset >= this.bytes.length) {
        throw new RangeError('unexpected end of varint data')
      }

      const byte = this.bytes[this.offset++]
      value += (byte & 0x7f) * factor

      if ((byte & 0x80) === 0) {
        return value
      }

      factor *= 0x80
    }
  }

  public readBytes(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) {
      throw new RangeError('unexpected end of byte data')
    }

    const slice = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return slice
  }

  public readString(): string {
    const length = this.readVarint()
    return decoder.decode(this.readBytes(length))
  }

  public get eof(): boolean {
    return this.offset >= this.bytes.length
  }
}

export function encodeJSON(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

export function decodeJSON<T>(bytes: Uint8Array): T {
  return JSON.parse(decoder.decode(bytes)) as T
}
