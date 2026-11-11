# Benchmarks

Head-to-head and multi-engine performance suites for ZBSearch.

## Orama vs ZBSearch (recommended)

Compares the latest published `@orama/orama` against the local `zbsearch` build across indexing, search variants, geosearch, memory, and bundle size.

```sh
# From repo root
pnpm --filter zbsearch build
pnpm --filter @zbsearch/stopwords build

cd benchmarks
npm install
npm run benchmark:compare        # full run + JSON report
npm run benchmark:compare:quick  # shorter sampling windows
```

Options:

```sh
node compare.js --format=markdown
node compare.js --format=ascii
node compare.js --format=both
node compare.js --json --out=benchmark/orama-vs-zbsearch.json
node compare.js --quick
```

### GitHub Actions

Run **Orama vs ZBSearch Benchmarks** via `workflow_dispatch` (Actions -> workflow -> Run workflow).

The job prints Markdown + ASCII tables in the log, writes the Markdown table to the job summary, and uploads `orama-vs-zbsearch.json` as an artifact.

## PR regression (base vs PR)

Compares the PR's local `zbsearch` build against the same package built from the PR's **base** branch. Used to catch performance regressions before merge.

```sh
# Build both package trees first, then:
node compare-pr.js \
  --base=/path/to/base/packages/zbsearch \
  --pr=/path/to/pr/packages/zbsearch \
  --format=markdown \
  --json \
  --fail-on-regression
```

### GitHub Actions (label)

Add the **`Run benchmarks`** label to a pull request. The **PR Benchmarks** workflow:

1. Builds ZBSearch from the PR and from the base SHA (git worktree)
2. Runs `compare-pr.js`
3. Uploads the report artifact; **PR Benchmarks Comment** then posts (or updates) a sticky PR comment

Re-runs automatically on new commits while the label remains.

Fork PRs are supported: benchmarks run on `pull_request` (read-only token), and commenting runs separately on `workflow_run` with the base-repo token.

## Other suites

| Script                                  | Description                                                                                                                                                                                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run benchmark`                     | Multi-engine insert/search (Orama, ZBSearch, FlexSearch, Fuse, Lunr, MiniSearch)                                                                                                                                                                                           |
| `npm run benchmark:facets`              | Faceted search                                                                                                                                                                                                                                                             |
| `npm run benchmark:bkd`                 | BKD / geopoint tree                                                                                                                                                                                                                                                        |
| `npm run benchmark:avl`                 | AVL tree                                                                                                                                                                                                                                                                   |
| `npm run benchmark:vector`              | Vector search                                                                                                                                                                                                                                                              |
| `npm run benchmark:vector-ivf`          | IVF vector index                                                                                                                                                                                                                                                           |
| `npm run benchmark:vector-quantization` | Recall@10, memory, serialized size and latency for none / int8 / binary / PQ, flat vs IVF (see below)                                                                                                                                                                      |
| `npm run benchmark:memory`              | Memory footprint                                                                                                                                                                                                                                                           |
| `npm run benchmark:store-exclude`       | Heap and snapshot size with indexed-but-not-stored fields (`store` option), on 10k synthetic passages (`--docs=N`, `--no-vectors`)                                                                                                                                         |
| `npm run benchmark:memory-breakdown`    | Heap held by each structure of a text-only passage index (`store.exclude: ['text']`): radix nodes, postings, term frequencies, field lengths, sorter, filter trees, documents and id stores (`--docs=20000,160000`, `--zbsearch=<dist/esm/index.js>`)                      |
| `npm run benchmark:large-index`         | Heap, insert throughput and event-loop blocking, search p50/p95 (plain, `tolerance`, `where`, facets, `sortBy`, hybrid with `--dims`), update/remove latency and `saveBinary`/`loadBinary` of a large passage index (`--docs=160000`, `--zbsearch=<dist/esm/index.js>`)    |
| `npm run benchmark:binary-snapshot`     | Binary snapshot (`saveBinary` / `loadBinary`) vs chunked JSON: size, save/load time, segment size and extra memory, on synthetic passages with 384-dim vectors (`node --expose-gc --max-old-space-size=3072 binary-snapshot.js 10000 50000 [--no-json] [--store-vectors]`) |
| `npm run benchmark:responsiveness`      | Main-thread blocking during sync vs async indexing and loading                                                                                                                                                                                                             |
| `npm run benchmark:bundle-size`         | Serialized index size                                                                                                                                                                                                                                                      |
| `npm run benchmark:algorithms`          | BM25 / QPS / PT15                                                                                                                                                                                                                                                          |
| `npm run benchmark:search-quality`      | Standardized ranking quality on BEIR datasets (nDCG@10 / MAP@100 / R@100)                                                                                                                                                                                                  |
| `npm run benchmark:pagefind`            | ZBSearch sharded static index vs Pagefind, end to end in a real browser                                                                                                                                                                                                    |

## Vector quantization

`vector-quantization.js` benchmarks the vector index alone (no document store): recall@10 against exact float32
search, memory, binary-snapshot and JSON size, build time and query latency, for `none`, `int8`, `binary`,
`binary` + int8 rescoring and product quantization (`@zbsearch/plugin-vector-quantizer`), on flat and IVF indexes.

```sh
pnpm --filter zbsearch build && pnpm --filter @zbsearch/plugin-vector-quantizer build
cd benchmarks
node --expose-gc --max-old-space-size=3072 vector-quantization.js --docs=20000          # synthetic clustered set
node --expose-gc --max-old-space-size=3072 vector-quantization.js --dataset=random --docs=30000
node --expose-gc --max-old-space-size=3072 vector-quantization.js --dataset=minilm      # 150 real MiniLM vectors
node --expose-gc --max-old-space-size=3072 vector-quantization.js --memory-only=160000  # int8 memory at 160k x 384

# Real embeddings (BEIR SciFact with bge-small; needs access to huggingface.co):
node scripts/embed-beir.mjs --dataset=scifact --model=bge-small
node --expose-gc --max-old-space-size=3072 vector-quantization.js --data=benchmark/scifact-bge-small.json
```

## ZBSearch static vs Pagefind

Head-to-head for the static-site niche: both engines index the identical corpus, serve their bundles
from the same byte-counting HTTP server (responses gzipped when that helps, as a CDN would), and answer
the same query battery in headless Chromium.

```sh
# From repo root: the benchmark imports the built @zbsearch/static package, which depends on zbsearch
pnpm --filter zbsearch build
pnpm --filter @zbsearch/stopwords build
pnpm --filter @zbsearch/static build

cd benchmarks
npm install
npm run benchmark:pagefind:setup   # once: downloads Chromium for playwright-core
npm run benchmark:pagefind
```

Two corpora run by default: the 1,512-record games dataset (real English, with quality scoring) and a
10,000-page synthetic docs corpus (transfer and latency at scale). Per engine it reports build time
(indexing through writing the files to disk, for both engines; ZBSearch's indexing-only time is listed
underneath), bundle size, initial transfer, cold-single-query transfer, marginal bytes and requests per
query, latency percentiles, and result quality (MRR@5 and found@5) against known target documents across
four categories: exact unique terms, typos, 4-character prefixes, and two-word queries. The typo category
deletes the fourth character of each target's anchor word (Levenshtein distance 1); insertions and
substitutions are not part of the battery.

Pagefind indexes synthesized HTML pages through its own Node API, so its element weighting (`h1` and
friends) applies exactly as on a real site; ZBSearch runs with the docs-index defaults
(`tolerance: 1`, `threshold: 0`, title boost 4). Flags: `--quick` (fewer targets, 2k-page scale run),
`--pages=N` (scale corpus size), `--skip-scale`.

## Standardized search quality (BEIR)

Measures **ranking quality** (not throughput) of every engine on standard [BEIR](https://github.com/beir-cellar/beir) test collections with official relevance judgments (qrels):

| Dataset  | Documents | Test queries | Qrels                         |
| -------- | --------- | ------------ | ----------------------------- |
| SciFact  | 5,183     | 300          | binary                        |
| NFCorpus | 3,633     | 323          | graded (1–2)                  |
| ArguAna  | 8,674     | 1,406        | binary (1 relevant per query) |

Datasets are downloaded on first run from the official BEIR hosting and cached under `.cache/beir/` (gitignored — the datasets carry per-dataset licenses, e.g. SciFact is CC BY-NC 2.0, so they are never committed).

```sh
# From repo root
pnpm --filter zbsearch build
pnpm --filter @zbsearch/plugin-qps build
pnpm --filter @zbsearch/plugin-pt15 build
pnpm --filter @zbsearch/stemmers build
pnpm --filter @zbsearch/stopwords build

cd benchmarks
npm install
npm run benchmark:search-quality   # full run (3 datasets × 8 engines)
npm run test:search-quality        # unit tests for the metric implementations
```

Reports **nDCG@10** (BEIR's primary metric), **MAP@100**, **Recall@100**, **P@10**, and **MRR@10** per dataset and engine, plus a macro average — alongside speed insights: **index build time** and **per-query latency** for the same runs. Each engine has a **5-minute query budget per dataset**; an engine that exceeds it is marked **crashed (†)** and scores 0 — an engine that cannot answer the dataset's queries in time has effectively failed the run. Metrics are reimplemented in `src/search-quality/metrics.js` with exact [trec_eval](https://github.com/usnistgov/trec_eval) semantics (linear-gain nDCG, `map_cut` denominators) — the same definitions BEIR reports via pytrec_eval. Full per-query results (including timings) are written incrementally to `benchmark/results/search-quality.json` after every dataset.

How to read it:

- Every engine runs in its **best relevance configuration using only features its own ecosystem ships** — nothing is bolted on from outside: ZBSearch (with English stopwords + Porter stemmer and `prefix: false` for Lucene-style exact token matching; its default prefix expansion is a search-as-you-type feature), Orama (stopwords + stemmer from the official `@orama/*` packages; its `exact: true` applies a case-sensitive verbatim post-filter and cannot do exact token matching, so it runs with its default behavior), Lunr runs its full default pipeline (trimmer/stopwords/stemmer), FlexSearch uses its relevance-oriented `score` preset with OR token combination, and MiniSearch — which ships no stemmer or stopword list — runs with plain default tokenization. Fuse.js runs with threshold 0 (exact substring match): its fuzzy mode (threshold 0.3) is a full-corpus scan per query (~39 s/query on ArguAna, ~15 h for the dataset) and is unusable at this scale — the runner repeats this caveat under every table. See `src/search-quality/engines.js` for the exact configurations.
- Tables print the published Lucene BM25 nDCG@10 from the BEIR paper (SciFact 0.665, NFCorpus 0.325, ArguAna 0.414) as a reference point. Analyzer differences (stemming, BM25 parameters) legitimately cost several points; the runner only warns if ZBSearch (BM25) lands more than 0.15 below the reference, which indicates a harness bug rather than a quality trade-off.

## Multilingual search quality

Measures **search quality** (not throughput) of the zero-config `language: 'multilingual'` tokenizer against per-language tuned installs and the plain `create({ schema })` default. Uses a small hand-authored corpus (`src/multilingual-quality/`) with judged queries in 8 languages (English, Italian, Spanish, German, French, Portuguese, Russian, Arabic), mixing inflection variants, diacritic-dropped queries, exact forms, and negative probes.

```sh
# From repo root
pnpm --filter zbsearch build
pnpm --filter @zbsearch/stemmers build
pnpm --filter @zbsearch/stopwords build

cd benchmarks
npm install
npm run benchmark:multilingual-quality
```

Prints a Markdown table (P@10 / R@10 / MRR per language and config, plus a macro average and a mixed-index scenario) and writes the full per-query results to `benchmark/results/multilingual-quality.json`.

How to read it:

- Queries run with stock `search(db, { term, limit: 10 })` defaults: **prefix matching is on** (search-as-you-type), with full-token matches scoring above prefix expansions. A query like `gato` still finds `gatos` in every config. The remaining morphology gap between configs comes from stem-level changes (umlauts, verb endings, articles) that prefix matching cannot recover.
- **multilingual ≈ per-language** on exact-form queries, diacritic-dropped queries, and non-Latin scripts: Unicode-aware tokenization plus diacritic folding covers those cases without any configuration.
- **multilingual < per-language** on inflection/morphology queries: the tuned configs stem (e.g. `running` -> `run`, `Häuser` -> `haus`) and drop stopwords, the zero-config mode does not.
- **multilingual ≫ english-default** on Russian and Arabic: the default English splitter discards non-Latin characters entirely, so recall collapses there. The runner prints a loud warning if multilingual ever scores _below_ english-default on those two languages, which would indicate a tokenizer bug rather than a trade-off.
- Diacritic folding covers Latin scripts plus Cyrillic `ё`->`е` and Arabic alef variants (`آ`/`أ`/`إ`/`ٱ`->`ا`, `ى`->`ي`), and folding runs _before_ stemming so accented and unaccented surface forms of a word share a stem (e.g. Portuguese `pão`/`pao`). The residual Arabic gap vs per-language comes from the Arabic stemmer itself (weak on bare forms and verb prefixes), not from tokenization.

## Sharded runtime database (`@zbsearch/sharded`)

Memory under a budget and cold/warm query latency of a sharded database on a large passage corpus with
vectors (issue #82). Builds the database into a directory, then reopens it and runs filtered and whole-corpus
full-text, vector and hybrid queries.

```sh
pnpm --filter zbsearch build && pnpm --filter @zbsearch/sharded build
cd benchmarks
node --expose-gc --max-old-space-size=3072 sharded.js --docs=200000 --dims=384 --budget=300
node --expose-gc --max-old-space-size=3072 sharded.js --docs=200000 --dims=384 --budget=300 --reuse  # clean-process memory
node --expose-gc --max-old-space-size=3072 sharded.js --docs=20000 --dims=384 --budget=100 --parity  # top-10 vs a single instance
```

Options: `--docs`, `--dims`, `--budget` (MB), `--shard-docs`, `--samples`, `--dir`, `--reuse`, `--parity`,
`--json=<file>`. Results are in `packages/sharded/README.md`.

## Large full-text indexes (issue #87)

Resident memory and latency of a large passage index: 150-250 word passages drawn from a Zipf-distributed 40k-word
vocabulary (`src/passages-corpus.js`, the corpus of `store-exclude.js`), string fields `text` / `section` / `title`
/ `itemKey`, numbers `page` / `year`, enum `collection`, with `store: { exclude: ['text'] }`.

```sh
pnpm --filter zbsearch build
cd benchmarks
node memory-breakdown.js --docs=20000,160000 --max-old-space-size=8192     # bytes per structure
node --expose-gc --max-old-space-size=8192 large-index.js --docs=160000   # heap, latency, save/load
# --freeze calls freeze(db) after inserting (frozen segments, see the docs)
node memory-breakdown.js --docs=20000,160000 --freeze
node --expose-gc --max-old-space-size=8192 large-index.js --docs=160000 --freeze
# The same scripts against another build, e.g. a worktree of the base branch:
node memory-breakdown.js --docs=20000 --zbsearch=../../base/packages/zbsearch/dist/esm/index.js
```

`memory-breakdown.js` builds the index, then drops its structures one at a time; the heap (plus array buffers)
freed by each drop, after two full GCs, is what it held. `large-index.js` runs 200 queries of 1-3 Zipf-sampled
words (so most queries contain a word that is in most passages) per search mode.

Measured on zbsearch 4.0.3 (4 vCPU, Node 22.23.4, `--max-old-space-size=8192`):

| Structure                                                    | 20k passages | 160k passages  |
| ------------------------------------------------------------ | ------------ | -------------- |
| `text` term frequencies (`{ term: frequency }` per document) | 131.0 MB     | 1,046.1 MB     |
| `text` postings (one array per term)                         | 32.9 MB      | 223.7 MB       |
| sorter                                                       | 11.3 MB      | 90.4 MB        |
| `title` / `section` / `itemKey` term frequencies             | 19.1 MB      | 141.5 MB       |
| documents store                                              | 4.7 MB       | 37.6 MB        |
| radix tree nodes (all properties)                            | 23.4 MB      | 36.6 MB        |
| `title` / `section` / `itemKey` postings                     | 6.3 MB       | 27.3 MB        |
| internal id store                                            | 1.5 MB       | 12.0 MB        |
| number AVL trees (`page`, `year`)                            | 1.1 MB       | 8.6 MB         |
| enum flat tree (`collection`)                                | 0.5 MB       | 3.8 MB         |
| field lengths (4 properties)                                 | 0.8 MB       | 5.6 MB         |
| **Total**                                                    | **233.6 MB** | **1,634.1 MB** |

| 160k passages, 4.0.3   | p50      | p95      |
| ---------------------- | -------- | -------- |
| search                 | 110.6 ms | 212.5 ms |
| search, `tolerance: 1` | 205.0 ms | 411.3 ms |
| search, `where`        | 45.2 ms  | 80.9 ms  |
| search, facets         | 224.8 ms | 350.5 ms |
| search, `sortBy`       | 163.6 ms | 286.3 ms |
| update                 | 106.2 ms | 125.6 ms |
| remove                 | 6.6 ms   | 7.9 ms   |

Insert (`insertMultipleAsync`, `batchSize: 50`): 5,649 passages/s, longest event-loop block 429 ms.
`saveBinary`: 138.7 MB in 8.6 s; `loadBinary`: 10.9 s, 1,552.5 MB of heap once loaded.

With `freeze(db)` after inserting (`--freeze`), the term frequencies, postings and radix trees of the four string
properties become frozen segments (measured on the same machine and settings):

| 160k passages                                                          | 4.0.3 (2 runs)               | frozen           | + top-k pages    | + lazy sorter cleanup        |
| ---------------------------------------------------------------------- | ---------------------------- | ---------------- | ---------------- | ---------------------------- |
| heap                                                                   | 1,633.7-1,633.8 MB           | 219.9 MB         | 219.9 MB         | 219.9 MB                     |
| `freeze(db)`                                                           | -                            | 7.8 s            | 8.2 s            | 6.6-7.5 s                    |
| search p50 / p95                                                       | 110.6-128.3 / 212.5-235.5 ms | 47.1 / 69.6 ms   | 8.2 / 17.3 ms    | 8.2-8.6 / 16.5-17.8 ms       |
| `tolerance: 1` p50 / p95                                               | 205.0-232.7 / 411.3-411.8 ms | 63.2 / 81.3 ms   | 17.3 / 32.5 ms   | 16.9-19.1 / 31.9-36.0 ms     |
| `where` p50 / p95                                                      | 45.2-45.8 / 80.9-83.2 ms     | 22.2 / 30.8 ms   | 19.3 / 28.2 ms   | 18.4-18.9 / 25.0-30.1 ms     |
| facets p50 / p95                                                       | 224.8-245.7 / 350.5-398.7 ms | 160.2 / 205.2 ms | 163.4 / 243.0 ms | 147.6-158.5 / 220.5-243.3 ms |
| `sortBy` p50 / p95                                                     | 159.8-163.6 / 277.5-286.3 ms | 76.7 / 113.5 ms  | 92.7 / 150.5 ms  | 86.4-90.9 / 128.2-142.6 ms   |
| update p50                                                             | 106.2-120.6 ms               | 93.9 ms          | 97.4 ms          | 0.13-0.16 ms                 |
| remove p50                                                             | 6.6-8.0 ms                   | 0.01 ms          | 0.01 ms          | 0.01 ms                      |
| `saveBinary`                                                           | 138.7 MB, 8.4-8.6 s          | 80.0 MB, 0.83 s  | 80.0 MB, 1.00 s  | 80.0 MB, 0.82-0.86 s         |
| `loadBinary`                                                           | 10.9-11.8 s, 1,552 MB        | 0.78 s, 249.2 MB | 0.89 s, 249.2 MB | 0.82-0.97 s, 249.1 MB        |
| longest event-loop block, `insertMultipleAsync` of 5,000 more passages | 35 ms                        | -                | -                | 81 ms                        |

Every column is a separate process on the same machine (4 vCPU, Node 22.23.4, `--max-old-space-size=8192`); the
spread of the runs shows the run-to-run noise. Top-k pages: a search ranked by score alone (no `sortBy`, facets,
`groupBy`, `distinctOn`, `exact` or matching pinning rule) keeps the best `offset + limit` results in a heap
instead of sorting every match. Lazy sorter cleanup: an update no longer filters the sorted values of every
document. Inserting into a frozen index fills a fresh mutable tail, whose radix tree has to create the nodes of
words the frozen segments already have: on 80k passages, 500-passage batches took 82-112 ms into a frozen index and
66-80 ms into a mutable one.

Without freezing, the same build (all steps) measured search 69.3 / 171.4 ms, `tolerance: 1` 168.4 / 358.0 ms,
`sortBy` 181.9 / 312.3 ms, facets 247.3 / 401.7 ms and update 9.1 ms at 160k; an alternating A/B of 150 queries
per mode (two runs each) gave 4.0.3 plain 115-123 / 191-203 ms and this build 71-85 / 142-165 ms, with `sortBy`,
facets and remove within noise of each other.
