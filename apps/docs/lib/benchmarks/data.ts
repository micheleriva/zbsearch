import plainSearchJson from './results/plain-search-all-terms.json';
import complexFiltersJson from './results/search-with-long-text-and-complex-filters.json';
import searchWithFiltersJson from './results/search-with-filters.json';

export type BenchmarkEngine =
  | 'ZBSearch (BM25)'
  | 'ZBSearch (QPS)'
  | 'ZBSearch (PT15)'
  | 'Orama'
  | 'MiniSearch'
  | 'FlexSearch'
  | 'Lunr'
  | 'Fuse.js';

export type BenchmarkResult = {
  engine: BenchmarkEngine;
  version: string;
  ops: number;
  margin: number;
  percentSlower: number;
};

export type BenchmarkSuite = {
  id: string;
  name: string;
  unit: 'ops/s';
  date: string;
  results: BenchmarkResult[];
};

type RawBenchmarkJson = {
  name: string;
  date: string;
  results: {
    name: string;
    ops: number;
    margin: number;
    percentSlower: number;
  }[];
};

const ENGINE_PATTERN =
  / in (ZBSearch \(BM25\)|ZBSearch \(QPS\)|ZBSearch \(PT15\)|Orama|MiniSearch|FlexSearch|Fuse\.js|Lunr) ([\d.]+)$/;

function parseResult(raw: RawBenchmarkJson['results'][number]): BenchmarkResult {
  const match = raw.name.match(ENGINE_PATTERN);
  if (!match) {
    throw new Error(`Unexpected benchmark result name: ${raw.name}`);
  }

  return {
    engine: match[1] as BenchmarkEngine,
    version: match[2],
    ops: raw.ops,
    margin: raw.margin,
    percentSlower: raw.percentSlower,
  };
}

function parseSuite(json: RawBenchmarkJson): BenchmarkSuite {
  return {
    id: json.name,
    name: json.name,
    unit: 'ops/s',
    date: json.date,
    results: json.results.map(parseResult),
  };
}

export const benchmarkSuites: BenchmarkSuite[] = [
  parseSuite(plainSearchJson),
  parseSuite(searchWithFiltersJson),
  parseSuite(complexFiltersJson),
];

