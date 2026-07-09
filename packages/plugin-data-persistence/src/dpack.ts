// @ts-expect-error dpack does not expose types
import * as dpack from 'dpack'

type StringWriteMethodName = 'utf8Write' | 'latin1Write' | 'asciiWrite'
type StringWriteFn = (this: Buffer, string: string, offset?: number, length?: number) => number
type BufferWriteFn = (
  this: Buffer,
  string: string | Uint8Array,
  offset?: number | BufferEncoding,
  length?: number | BufferEncoding,
  encoding?: BufferEncoding
) => number

type PatchedBufferPrototype = {
  utf8Write: StringWriteFn
  latin1Write: StringWriteFn
  asciiWrite: StringWriteFn
  write: BufferWriteFn
}

let bufferCompatApplied = false

// dpack passes buffer.length instead of the remaining capacity to Buffer write methods.
// Node.js 22.7+ validates that argument strictly and throws ERR_BUFFER_OUT_OF_BOUNDS.
function applyNodeBufferCompatFix(): void {
  if (bufferCompatApplied || typeof Buffer === 'undefined') {
    return
  }

  const proto = Buffer.prototype as unknown as PatchedBufferPrototype

  for (const method of ['utf8Write', 'latin1Write', 'asciiWrite'] as StringWriteMethodName[]) {
    const original = proto[method]
    proto[method] = function (this: Buffer, string: string, offset = 0, length = this.byteLength) {
      const maxLength = this.byteLength - offset
      if (length > maxLength) {
        length = maxLength
      }
      return original.call(this, string, offset, length)
    }
  }

  const originalWrite = proto.write
  proto.write = function (
    this: Buffer,
    string: string | Uint8Array,
    offset?: number | BufferEncoding,
    length?: number | BufferEncoding,
    encoding?: BufferEncoding
  ): number {
    if (typeof offset === 'number' && typeof length === 'number') {
      const maxLength = this.byteLength - offset
      if (length > maxLength) {
        if (typeof encoding === 'string') {
          return originalWrite.call(this, string, offset, maxLength, encoding)
        }
        return originalWrite.call(this, string, offset, maxLength)
      }
    }

    return originalWrite.call(this, string, offset, length, encoding)
  }

  bufferCompatApplied = true
}

applyNodeBufferCompatFix()

export function serialize(data: unknown): ReturnType<typeof dpack.serialize> {
  return dpack.serialize(data)
}

export function parse(data: Parameters<typeof dpack.parse>[0]): ReturnType<typeof dpack.parse> {
  return dpack.parse(data)
}
