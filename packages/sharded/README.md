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
current at the next commit.

**Memory budget.** The budget covers the global layer and the loaded shards. Shard sizes are estimated as
1.8 × their snapshot size (`estimateShardBytes` to override), which over-approximates the heap of a shard loaded
with the default codec. Shards in use by the running operation are never evicted.

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
`defaultShardCodec` serializes core's `save()` as JSON. Pass `codec` to use another format; it must not change
for an existing database.

## Options passed to every shard

`createOptions` is forwarded to core's `create()` for every shard: `language`, `components` (tokenizer),
`plugins`, `indexes` (for instance `{ embedding: flat({ quantization: 'int8' }) }`) and `store` (for instance
`{ exclude: ['text'] }`). Functions cannot be persisted, so pass the same `createOptions` every time the
database is opened. With a quantized vector index, scores are approximate and similarity-bound pruning is
disabled; the exact flat index keeps vector results identical to a single instance.

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
