# @zbsearch/sharded

A ZBSearch database that keeps only part of itself in memory. Documents are split into shards; a shard is
loaded from storage when a query or a write needs it and evicted (least recently used) when the loaded shards
would exceed a memory budget. Full-text (BM25), vector and hybrid results are the same as a single ZBSearch
instance holding the same documents.

It is meant for corpora larger than the memory an application is willing to give search: a reference manager
indexing every passage of tens of thousands of PDFs, an offline app, an Electron or Gecko plugin.

```bash
npm install @zbsearch/sharded
```

## Usage

```typescript
import { openShardedDatabase } from '@zbsearch/sharded'
import { FileSystemStorage } from '@zbsearch/sharded/node'

const db = await openShardedDatabase({
  schema: {
    text: 'string',
    title: 'string',
    itemKey: 'string',
    year: 'number',
    collection: 'enum',
    embedding: 'vector[384]'
  },
  storage: new FileSystemStorage('./search-index'),
  partitionBy: 'itemKey', // keep the passages of one paper together
  packPartitions: true, // many small partitions share a shard
  maxDocsPerShard: 1000,
  memoryBudget: 300 * 1024 * 1024
})

await db.insertMultiple(passages)
await db.update('p42', { ...passage, text: 'new text' })
await db.remove('p43')

const results = await db.search({ term: 'protein folding', where: { year: { gte: 2015 } } })
const similar = await db.search({ mode: 'vector', vector: { value: embedding, property: 'embedding' } })
const hybrid = await db.search({ mode: 'hybrid', term: 'protein', vector: { value: embedding, property: 'embedding' } })

await db.close() // compacts and releases every shard
```

`openShardedDatabase` creates the database when the storage is empty, and otherwise reopens it (the schema and
partitioning are read back from storage) and replays its write-ahead log. Search parameters are core's:
`term`, `properties`, `exact`, `prefix`, `tolerance`, `threshold`, `boost`, `relevance`, `where`, `mode`,
`vector`, `similarity`, `hybridWeights`, `includeVectors`, `limit`, `offset` and `preflight`. `facets`,
`groupBy`, `distinctOn` and `sortBy` are rejected.

Each result also says how many shards were candidates after pruning and how many had to be loaded:
`results.shards = { total, candidates, loaded }`. `db.getStats()` reports resident shards, estimated bytes,
loads, evictions and pending WAL records.

## How it works

**Shards.** Every shard is a complete ZBSearch database. Documents go to shards in insertion order, or, with
`partitionBy`, grouped by the value of a property: each value gets shards of its own, or shares them with other
values when `packPartitions` is set. A shard holds at most `maxDocsPerShard` documents.

**Resident global layer.** Kept in memory at all times:

- corpus-wide BM25 statistics (document count, average length of every string property, document frequency of
  every term). Shards score with them through `internals.setCorpusStatistics`, so a document's score does not
  depend on which shard holds it;
- a term dictionary (a radix tree per property), which resolves prefix and typo expansions of query terms
  without loading any shard;
- a summary of each shard: a Bloom filter of its (property, term) pairs, the range of its number fields, the
  values of its enum and boolean fields, and a cone (centroid and maximum angle) holding its vectors;
- the location of every document and its insertion order, which breaks score ties exactly as core does.

**Query path.** Shards are pruned by `where` (ranges, value sets, and term presence for string filters), by
term presence (no expansion of any query term in the shard's Bloom filter), and for vector queries by the
largest similarity a shard's cone allows. The remaining shards are loaded through the storage adapter, searched,
and their scores merged: top-k merge for full-text and vector search, core's threshold rule applied across
shards, hybrid scores normalized with the corpus-wide maxima. `vectorProbe: n` limits vector queries to the `n`
shards with the closest centroids (approximate).

**Write path.** `insert`, `insertMultiple`, `update`, `upsert`, `remove` and `removeMultiple` append a record
to a write-ahead log, then apply it to the owning shard and to the global statistics. Every `compactEvery` WAL
records (and on `compact()` / `close()`), modified shards are written as new snapshots, then the global state is
written: that write is the commit point. The WAL records it covers and the replaced snapshots are deleted
afterwards. After a crash, `openShardedDatabase` deletes snapshots the state does not reference and replays the
remaining WAL records. A shard evicted with unsaved changes is written to a new snapshot that only becomes
current at the next commit. The ops of a record that failed when they were applied (the write threw for them)
are marked in the record and skipped by the replay; any other op that fails to replay makes opening fail and
keeps the record, so an acknowledged write is never dropped. Number properties accept `Infinity` and
`-Infinity` as core does, but refuse `NaN`, which core's number index cannot order.

**Memory budget.** The budget covers the global layer and the loaded shards. A loaded shard is estimated from its
snapshot: the bytes that are not float32 vectors times the codec's `residentFactor` (8 for the binary codec, 2.5
for JSON), plus 4.4 bytes per vector component. Measured on V8 this lands within about 5% of the real heap,
usually above it; pass `estimateShardBytes` to override. Shards in use by the running operation are never
evicted.

## Storage

Any object with `get`, `put`, `delete` and `list(prefix)` works (`ShardStorage`). It is the subset of
`@zbsearch/edge-core`'s `ObjectStorage`, so the edge runtime's storage adapters (S3, R2) plug in as they are.

| Adapter                                               | Import                   | Environment                                              |
| ----------------------------------------------------- | ------------------------ | -------------------------------------------------------- |
| `MemoryStorage`                                       | `@zbsearch/sharded`      | anywhere (tests, or a memory budget without persistence) |
| `IndexedDBStorage`                                    | `@zbsearch/sharded`      | browsers, workers, Gecko (Zotero)                        |
| `FileSystemStorage`                                   | `@zbsearch/sharded/node` | Node.js, Electron, Bun                                   |
| any edge-core `ObjectStorage`, e.g. `S3ObjectStorage` | `@zbsearch/storage-s3`   | servers, edge                                            |

## Shard format

Shards are encoded by a `ShardCodec` (`{ encode(db): AsyncIterable<Uint8Array>; decode(db, source) }`).
`defaultShardCodec` is `binaryShardCodec`, core's streamed binary snapshot format (`saveBinary` /
`loadBinary`). `jsonShardCodec` (core `save()` as JSON) is available too: about 4× larger on disk and slower to
load. A database must keep the codec it was created with.

## Options passed to every shard

`createOptions` is forwarded to core's `create()` for every shard: `language`, `components` (tokenizer),
`plugins`, `indexes` (for instance `{ embedding: flat({ quantization: 'int8' }) }`) and `store` (for instance
`{ exclude: ['text'] }`). Functions cannot be persisted, so pass the same `createOptions` every time the
database is opened. With a quantized vector index, scores are approximate and similarity-bound pruning is
disabled; the exact flat index keeps vector results identical to a single instance.

## Performance

Measured with `benchmarks/sharded.js` (ZBSearch 4.0.2 workspace build, Node 22.23.4, a 4-vCPU machine shared with
other jobs): 200,000 passages of 150-250 words from a Zipf-distributed 40,000-word vocabulary, 80 passages per
item, random 384-dimension unit vectors; `partitionBy: 'itemKey'`, `packPartitions: true`,
`maxDocsPerShard: 1000` (201 shards), `memoryBudget: 300 MB`, file system storage, binary codec. Memory figures
are V8 heap after a forced GC, in a process that only opened the existing database and ran the queries.

|                                            |                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| Build (insert 200k + compactions)          | 97 s, 2,070 docs/s                                                              |
| On disk                                    | 901 MB (2,927 MB with `jsonShardCodec`)                                         |
| Open (global state, 118k dictionary terms) | 0.4 s                                                                           |
| Global layer, resident                     | 73 MB                                                                           |
| Live heap, highest after any query         | 267 MB above the process baseline (budget 300 MB)                               |
| Peak `heapUsed` before GC / peak RSS       | 608 MB / 904 MB; with `--max-old-space-size=400`: 383 MB / 580 MB, same results |

| Query                                 | Shards loaded | Cold (median) | Warm (median)                   |
| ------------------------------------- | ------------- | ------------- | ------------------------------- |
| BM25, `where: { itemKey }`            | 1             | 95 ms         | 0.9 ms                          |
| BM25, two terms, `where: { itemKey }` | 1             | 103 ms        | 0.9 ms                          |
| vector, `where: { itemKey }`          | 1             | 92 ms         | 0.7 ms                          |
| hybrid, `where: { itemKey }`          | 1             | 90 ms         | 1.1 ms                          |
| BM25, rare term, whole corpus         | 74            | 6.3 s         | 6.2 s (does not fit the budget) |
| BM25, common term, whole corpus       | 193 of 201    | 17 s          | -                               |
| vector, whole corpus                  | 193 of 201    | 15 s          | -                               |
| `upsert`, one document                | -             | 6 ms          | -                               |

A cold query costs about 90-100 ms per shard it loads with the binary codec (190-330 ms with the JSON codec).
Queries that match documents in more shards than the budget holds stream them all on every run: give such
workloads a larger budget, smaller vectors (quantized indexes) or filters on the partition key. Rankings were
compared with a single instance in the same benchmark at 20,000 passages (`--parity`): identical top 10 and
counts for every full-text, vector and hybrid query; a 200,000-passage single instance does not fit in the
benchmark's 3 GB heap.

## Ranking parity

The test suite compares every result list against a single ZBSearch instance built from the same documents:
same count, same IDs in the same order, scores within 1e-9 (shards may add a document's term scores in a
different order, which can change the last bit; documents whose scores tie within that tolerance may swap
places). It covers prefix, typo-tolerant and exact queries, boosts, custom BM25 parameters, thresholds 0, 1 and
in between, `where` filters with `and`/`or`/`not`, pagination, vector and hybrid search, after inserts, updates
and removals, under a one-byte memory budget, and after crash recovery.

Core behaviors that depend on the whole corpus are reproduced across shards: a threshold between 0 and 1 keeps
the best partial matches of the whole corpus; with threshold 0 and several terms, core only scores the
properties where some document holds every term, which the merge determines across shards (shards outside the
`where` filter may have to be read for that). `exact` combined with a threshold between 0 and 1 is not supported.
