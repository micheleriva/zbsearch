import { describe, expectTypeOf, it } from 'vitest'
import { create, type VectorIndexFactory, type VectorQuantizerFactory } from '../../src/index.js'
import { flat } from '../../src/trees/vector.js'
import { ivf } from '../../src/trees/vector-ivf.js'

describe('vector quantization options', () => {
  it('accepts built-in and custom quantizers', () => {
    expectTypeOf(flat({ quantization: 'int8' })).toEqualTypeOf<VectorIndexFactory>()
    expectTypeOf(flat({ quantization: 'binary', rescore: 'int8', oversample: 4 })).toEqualTypeOf<VectorIndexFactory>()
    expectTypeOf(ivf({ nlist: 16, quantization: 'int8', rescore: 'float32' })).toEqualTypeOf<VectorIndexFactory>()

    const custom = {} as VectorQuantizerFactory
    expectTypeOf(flat({ quantization: custom })).toEqualTypeOf<VectorIndexFactory>()

    create({ schema: { embedding: 'vector[3]' } as const, indexes: { embedding: flat({ quantization: 'int8' }) } })

    // @ts-expect-error unknown quantization
    flat({ quantization: 'int4' })
    // @ts-expect-error unknown rescore precision
    flat({ quantization: 'binary', rescore: 'binary' })
  })
})
