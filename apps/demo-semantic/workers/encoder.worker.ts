/*
 * Query encoding, off the main thread.
 *
 * The document vectors are precomputed and shipped with the page; the only thing left to
 * encode at runtime is whatever the visitor typed. That still means downloading a 23 MB
 * model and running a transformer, which would visibly stall typing if it happened on the
 * main thread — hence a worker.
 */
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'

/*
 * Without this, transformers.js first probes a local /models/... path and only then falls
 * back to the hub, so every cold start pays for a guaranteed 404.
 */
env.allowLocalModels = false

export type EncoderRequest =
  | { type: 'warm'; model: string }
  | { type: 'embed'; id: number; text: string }

export type EncoderResponse =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready'; device: string; dimensions: number; ms: number }
  | { type: 'embedded'; id: number; vector: number[]; ms: number }
  | { type: 'failed'; id?: number; message: string }

const scope = self as unknown as Worker

let extractor: FeatureExtractionPipeline | undefined
let warming: Promise<FeatureExtractionPipeline> | undefined
let device = 'wasm'

async function load(model: string): Promise<FeatureExtractionPipeline> {
  const progress_callback = (event: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (event.status === 'progress' && event.total) {
      post({ type: 'progress', file: event.file ?? '', loaded: event.loaded ?? 0, total: event.total })
    }
  }

  /*
   * WebGPU is roughly an order of magnitude faster to encode with, but it is still absent
   * or broken in enough browsers that it cannot be depended on. Ask for it when the
   * navigator advertises it and quietly fall back when the pipeline refuses to build.
   */
  if ('gpu' in navigator) {
    try {
      const gpu = await pipeline('feature-extraction', model, { dtype: 'q8', device: 'webgpu', progress_callback })
      device = 'webgpu'
      return gpu
    } catch {
      device = 'wasm'
    }
  }

  return pipeline('feature-extraction', model, { dtype: 'q8', device: 'wasm', progress_callback })
}

function post(message: EncoderResponse) {
  scope.postMessage(message)
}

async function warm(model: string): Promise<FeatureExtractionPipeline> {
  if (!warming) {
    const started = performance.now()

    warming = load(model).then(async loaded => {
      extractor = loaded

      /*
       * The first call through a freshly built pipeline pays for graph setup and, on
       * WebGPU, for shader compilation — several hundred milliseconds that would otherwise
       * land on whoever typed the first query. Spend it here instead, while the UI is
       * already showing a loading state, and report the dimensions the model actually
       * produced rather than the number the corpus claims.
       */
      const primer = await loaded(['warm up'], { pooling: 'mean', normalize: true })
      const dimensions = primer.dims.at(-1) ?? 0

      post({ type: 'ready', device, dimensions, ms: Math.round(performance.now() - started) })
      return loaded
    })
  }

  return warming
}

scope.onmessage = async (event: MessageEvent<EncoderRequest>) => {
  const request = event.data

  try {
    if (request.type === 'warm') {
      await warm(request.model)
      return
    }

    const model = extractor ?? (await warming)

    if (!model) {
      post({ type: 'failed', id: request.id, message: 'The encoder was asked to embed before it was warmed' })
      return
    }

    const started = performance.now()
    const output = await model([request.text], { pooling: 'mean', normalize: true })

    post({
      type: 'embedded',
      id: request.id,
      vector: Array.from(output.data as Float32Array),
      ms: performance.now() - started,
    })
  } catch (error) {
    post({
      type: 'failed',
      id: request.type === 'embed' ? request.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
