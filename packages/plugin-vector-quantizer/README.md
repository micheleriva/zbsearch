# @zbsearch/plugin-vector-quantizer

> [!IMPORTANT]
> **This package is licensed under GPL-3.0-only**, unlike zbsearch and the other `@zbsearch/*` packages (Apache-2.0).
> It ships a compiled WebAssembly build of [vector_quantizer](https://github.com/oramasearch/vector_quantizer), which
> is GPL-3.0-only. Distributing an application that bundles this package means distributing GPL-3.0 code; check that
> this is compatible with your project before using it. The built-in `int8` and `binary` quantization of zbsearch
> core (Apache-2.0) need no plugin.

Product quantization (PQ) for zbsearch vector indexes. Each vector is split into `m` subspaces and every subspace is
replaced by the one-byte index of its nearest centroid, so a 384-dimensional embedding takes 48 bytes (plus a 4-byte
norm) instead of 1,536. Queries are scored with asymmetric distance computation: one `m × ks` table per query, then
`m` table lookups per stored vector.

Training (k-means per subspace) and encoding run in WebAssembly. The module is inlined in the package as base64 and
has no imports, so it works in browsers, Node.js, Deno, workers and Gecko (Zotero) without any bundler configuration,
and you do not need Rust to use it.

## Installation

```bash
npm install @zbsearch/plugin-vector-quantizer
```

## Usage

```js
import { create, insertMultiple, search } from 'zbsearch'
import { flat } from 'zbsearch/trees/vector-flat'
import { ivf } from 'zbsearch/trees/vector-ivf'
import { pq } from '@zbsearch/plugin-vector-quantizer'

const quantizer = await pq({ m: 48, ks: 256 })

const db = create({
  schema: { title: 'string', embedding: 'vector[384]' },
  indexes: {
    // Flat scan over PQ codes, rescoring the best candidates against int8 copies.
    embedding: flat({ quantization: quantizer, rescore: 'int8' })
    // or partitioned: ivf({ nlist: 256, nprobe: 16, quantization: quantizer })
  }
})
```

`pq()` is asynchronous because it compiles the WebAssembly module with `WebAssembly.compile`, which every engine
allows on the main thread. In Node.js, Deno, workers or privileged Gecko code you can use `pqSync()` instead.

### Options

| Option            | Default                   | Description                                                             |
| ----------------- | ------------------------- | ----------------------------------------------------------------------- |
| `m`               | `dim / 8`                 | Subspaces, i.e. code bytes per vector. Must not exceed the vector size. |
| `ks`              | `256`                     | Centroids per subspace (2 to 256).                                      |
| `iterations`      | `12`                      | k-means iterations per subspace.                                        |
| `trainingSize`    | `max(4 × ks, 1024)`       | Vectors collected before the quantizer is trained.                      |
| `maxTrainingSize` | `max(trainingSize, 4096)` | Upper bound on the vectors used by one fit (evenly sampled).            |
| `seed`            | `42`                      | Seed of the k-means initialisation, so fits are reproducible.           |

### Training

PQ has to be trained before it can encode. Until `trainingSize` vectors have been inserted, the index keeps them as
float32 and searches them exactly. When the threshold is reached, the quantizer is fitted on the buffered vectors,
every buffered vector is encoded, and the float32 copies are dropped. Training 1,024 vectors of 384 dimensions with
the defaults takes about one second; encoding takes about 0.13 ms per vector.

If your data drifts away from the initial sample, re-train and re-encode everything:

```js
import { refit } from '@zbsearch/plugin-vector-quantizer'

refit(db, 'embedding') // trains on the rescoring copies (or decoded codes)
refit(db, 'embedding', sampleVectors) // or on a sample you provide
```

### Persistence

`save()` / `load()` store the codebook and the codes as base64 typed arrays, and the index exposes
`toBinarySnapshot()` for binary formats. Pass the same `indexes` configuration (with a `pq()` quantizer) to `create()`
before loading, otherwise `load()` throws: the codebook cannot be decoded without the plugin.

## Rebuilding the WebAssembly module

The Rust sources are in [`rust/`](./rust). They vendor `pq.rs`, `utils.rs` and `errors.rs` of vector_quantizer 0.0.3
(commit `cfdec78a061bd13bc60130dd4c2ced3f64338dcf`) with minimal patches: the published crate depends on numpy/pyo3,
rayon and getrandom, which do not build for `wasm32-unknown-unknown`. Each vendored file lists its changes; the
algorithm is unchanged. The bindings use a plain C ABI, so no `wasm-bindgen` CLI is needed.

```bash
rustup target add wasm32-unknown-unknown
pnpm --filter @zbsearch/plugin-vector-quantizer build:wasm   # rewrites src/wasm-binary.ts
pnpm --filter @zbsearch/plugin-vector-quantizer check:wasm   # verifies the committed module (same rustc version)
pnpm --filter @zbsearch/plugin-vector-quantizer test:rust    # runs the Rust unit tests natively
```

## License

[GPL-3.0-only](./LICENSE.md). The vector_quantizer code is Copyright (C) Michele Riva.
