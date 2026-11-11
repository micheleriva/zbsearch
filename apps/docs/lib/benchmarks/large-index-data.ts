import largeIndexJson from './results/large-index-engines.json';

export type LargeIndexStatus = 'ok' | 'index-timeout' | 'search-timeout' | 'crashed';

export type LargeIndexEngineKey =
  | 'orama'
  | 'zbsearch-bm25'
  | 'zbsearch-bm25-frozen'
  | 'zbsearch-qps'
  | 'zbsearch-pt15'
  | 'flexsearch'
  | 'fusejs'
  | 'lunr'
  | 'minisearch';

export type LargeIndexSearchStats = {
  queries: number;
  meanMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  qps: number | null;
};

export type LargeIndexRun = {
  engine: LargeIndexEngineKey;
  label: string;
  docs: number;
  status: LargeIndexStatus;
  error: string | null;
  store: string;
  indexMs: number | null;
  docsPerSecond: number | null;
  freezeMs: number | null;
  docsIndexed: number;
  heapMB: number | null;
  rssMB: number | null;
  maxRssMB: number | null;
  search: LargeIndexSearchStats | null;
  sample: { term?: string; hits: number; total: number | null }[];
};

export type LargeIndexReport = {
  date: string;
  machine: {
    node: string;
    platform: string;
    cpu: string;
    cpus: number;
    totalMemoryGB: number;
  };
  config: {
    sizes: number[];
    indexTimeoutMs: number;
    searchTimeoutMs: number;
    queryTimeoutMs: number;
    queries: number;
    warmupQueries: number;
    maxOldSpaceSizeMB: number;
    searchLimit: number;
    fields: string[];
    corpus: string;
    queryMix: string;
  };
  versions: Partial<Record<LargeIndexEngineKey, string>>;
  stores: Partial<Record<LargeIndexEngineKey, string>>;
  runs: LargeIndexRun[];
};

const STATUSES: LargeIndexStatus[] = ['ok', 'index-timeout', 'search-timeout', 'crashed'];

function parseReport(json: typeof largeIndexJson): LargeIndexReport {
  const report = json as unknown as LargeIndexReport;
  for (const run of report.runs) {
    if (!STATUSES.includes(run.status)) {
      throw new Error(`Unexpected large-index benchmark status: ${run.status}`);
    }
  }
  return report;
}

export const largeIndexReport = parseReport(largeIndexJson);

export const largeIndexSizes = largeIndexReport.config.sizes;

export function largeIndexRuns(docs: number): LargeIndexRun[] {
  return largeIndexReport.runs.filter((run) => run.docs === docs);
}

export function formatDuration(ms: number): string {
  if (ms >= 60_000) {
    const minutes = ms / 60_000;
    return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min`;
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s`;
  }
  return `${ms >= 10 ? Math.round(ms) : ms.toFixed(2)} ms`;
}

export function formatDocs(docs: number): string {
  return docs >= 1000 && docs % 1000 === 0 ? `${docs / 1000}k` : docs.toLocaleString('en-US');
}

/** One-line description of why a run has no (or only partial) results, or `null` for a completed run. */
export function largeIndexFailure(run: LargeIndexRun): string | null {
  const { indexTimeoutMs, searchTimeoutMs, queryTimeoutMs, queries, maxOldSpaceSizeMB } = largeIndexReport.config;
  switch (run.status) {
    case 'ok':
      return null;
    case 'index-timeout':
      return `Indexing timed out after ${formatDuration(indexTimeoutMs)}`;
    case 'search-timeout': {
      const done = run.search?.queries ?? 0;
      const cap = run.error?.includes('single query')
        ? `a query took over ${formatDuration(queryTimeoutMs)}`
        : `${formatDuration(searchTimeoutMs)} budget`;
      return `Search timed out (${cap}), ${done}/${queries} queries`;
    }
    case 'crashed': {
      const phase = run.error?.match(/ while ([a-z ]+)/)?.[1];
      const when = phase ? ` while ${phase}` : '';
      return run.error?.startsWith('out of memory')
        ? `Out of memory${when} (${(maxOldSpaceSizeMB / 1024).toFixed(0)} GB heap limit)`
        : `Crashed${when}`;
    }
  }
}
