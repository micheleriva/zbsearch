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

Run **Orama vs ZBSearch Benchmarks** via `workflow_dispatch` (Actions → workflow → Run workflow).

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
| `npm run benchmark:bundle-size` | Serialized index size |
| `npm run benchmark:algorithms` | BM25 / QPS / PT15 |
