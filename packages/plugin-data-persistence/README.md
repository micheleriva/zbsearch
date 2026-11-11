# Data Persistence Plugin

[![Tests](https://github.com/micheleriva/zbsearch/actions/workflows/turbo.yml/badge.svg)](https://github.com/micheleriva/zbsearch/actions/workflows/turbo.yml)

This plugin aims to provide data persistence capabilities to ZBSearch.

# Usage

For the complete usage guide, please refer to the [official plugin documentation](https://docs.zbsearch.com/docs/zbsearch-js/plugins/plugin-data-persistence).

## Storage adapters

Besides serializing to a string/buffer (`persist`/`restore`) or to disk
(`persistToFile`/`restoreFromFile`, via `/server`), you can persist a snapshot
directly into a pluggable storage backend with `persistToStorage` /
`restoreFromStorage`. The whole index is written as one compact byte payload;
the in-memory database is untouched and stays fully queryable, and restoring it
loads the snapshot back into memory.

Any backend implementing the `PersistenceStorage` contract works. It is
structurally compatible with `ObjectStorage` from `@zbsearch/edge-core`, so an
`S3ObjectStorage` can be passed as-is.

```ts
import { persistToStorage, restoreFromStorage } from '@zbsearch/plugin-data-persistence'
import { IndexedDBStorage } from '@zbsearch/plugin-data-persistence/indexeddb'

const storage = new IndexedDBStorage() // durable, in-browser
await persistToStorage(db, storage, 'my-index') // defaults to compact `binary`

// later — e.g. after a page reload:
const db = await restoreFromStorage(storage, 'my-index')
```

`persistToStorage(db, storage, key, { format })` and
`restoreFromStorage(storage, key, { format })` accept the same formats as
`persist` (`json` | `dpack` | `binary` | `seqproto` | `snapshot`); the `format`
used to restore must match the one used to persist (a `binary` restore also
recognizes `snapshot` payloads). For IndexedDB, `snapshot` is recommended.

## Formats

- `snapshot`: the core binary snapshot (`saveBinary` / `loadBinary` from
  `zbsearch`). Smallest and fastest, checksummed, and the only format that scales
  to very large indexes. `persistToFile(db, 'snapshot', path)` streams it to disk
  segment by segment and `restoreFromFile('snapshot', path)` streams it back.
- `binary`: msgpack bytes, returned as a `Uint8Array` (versions before 4.1
  returned a hex string, which `restore` still accepts).
- `json`, `dpack`: strings.
- `seqproto`: an `ArrayBuffer` (format v3; v1 and v2 payloads still restore).
  Limited to 4 GiB.

# License

[Apache-2.0](/LICENSE.md)
