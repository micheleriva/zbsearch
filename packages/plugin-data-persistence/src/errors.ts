function capitalize(word: string): string {
  return `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`
}

export function UNSUPPORTED_FORMAT(format: string): string {
  return `Unsupported serialization format: ${format}`
}

export function FILESYSTEM_NOT_SUPPORTED_ON_RUNTIME(runtime: string): string {
  return `Filesystem access is not supported on ${capitalize(runtime)}`
}

export function STORAGE_KEY_NOT_FOUND(key: string): string {
  return `No persisted snapshot was found for key "${key}" in the storage backend.`
}

export function INDEXEDDB_NOT_AVAILABLE(): string {
  return 'IndexedDB is not available in this environment. Pass a custom `indexedDB` factory (e.g. a polyfill) to IndexedDBStorage.'
}

export function METHOD_MOVED(method: string): string {
  return `Function ${method} has been moved to the "/server" module. \n\nImport it via "import { ${method} } from 'zbsearch/plugin-data-persistence/server'". \n\nRead more at https://docs.zbsearch.com/docs/zbsearch-js/plugins/plugin-data-persistence.`
}
