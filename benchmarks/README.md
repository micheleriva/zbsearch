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

| Script | Description |
| --- | --- |
| `npm run benchmark` | Multi-engine insert/search (Orama, ZBSearch, FlexSearch, Fuse, Lunr, MiniSearch) |
| `npm run benchmark:facets` | Faceted search |
| `npm run benchmark:bkd` | BKD / geopoint tree |
| `npm run benchmark:avl` | AVL tree |
| `npm run benchmark:vector` | Vector search |
| `npm run benchmark:vector-ivf` | IVF vector index |
| `npm run benchmark:memory` | Memory footprint |
| `npm run benchmark:responsiveness` | Main-thread blocking during sync vs async indexing and loading |
| `npm run benchmark:bundle-size` | Serialized index size |
| `npm run benchmark:algorithms` | BM25 / QPS / PT15 |
| `npm run benchmark:search-quality` | Standardized ranking quality on BEIR datasets (nDCG@10 / MAP@100 / R@100) |

## Standardized search quality (BEIR)

Measures **ranking quality** (not throughput) of every engine on standard [BEIR](https://github.com/beir-cellar/beir) test collections with official relevance judgments (qrels):

| Dataset | Documents | Test queries | Qrels |
| --- | --- | --- | --- |
| SciFact | 5,183 | 300 | binary |
| NFCorpus | 3,633 | 323 | graded (1–2) |
| ArguAna | 8,674 | 1,406 | binary (1 relevant per query) |

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
- **multilingual ≫ english-default** on Russian and Arabic: the default English splitter discards non-Latin characters entirely, so recall collapses there. The runner prints a loud warning if multilingual ever scores *below* english-default on those two languages, which would indicate a tokenizer bug rather than a trade-off.
- Diacritic folding covers Latin scripts plus Cyrillic `ё`->`е` and Arabic alef variants (`آ`/`أ`/`إ`/`ٱ`->`ا`, `ى`->`ي`), and folding runs *before* stemming so accented and unaccented surface forms of a word share a stem (e.g. Portuguese `pão`/`pao`). The residual Arabic gap vs per-language comes from the Arabic stemmer itself (weak on bare forms and verb prefixes), not from tokenization.

