import plainSearchJson from './results/plain-search-all-terms.json';
import complexFiltersJson from './results/search-with-long-text-and-complex-filters.json';
import searchWithFiltersJson from './results/search-with-filters.json';

export type BenchmarkEngine = 'ZBSearch' | 'Orama' | 'MiniSearch' | 'Lunr' | 'Fuse.js';

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
  / in (ZBSearch|Orama|MiniSearch|Fuse\.js|Lunr) ([\d.]+)$/;

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

export const benchmarkEngines: BenchmarkEngine[] = [
  'ZBSearch',
  'Orama',
  'MiniSearch',
  'Lunr',
  'Fuse.js',
];

export const engineColors: Record<BenchmarkEngine, string> = {
  ZBSearch: 'oklch(0.55 0.14 145)',
  Orama: 'oklch(0.52 0.14 250)',
  MiniSearch: 'oklch(0.62 0.16 55)',
  Lunr: 'oklch(0.52 0.10 180)',
  'Fuse.js': 'oklch(0.58 0.14 340)',
};

export const engineOrder: Record<BenchmarkEngine, number> = {
  ZBSearch: 0,
  Orama: 1,
  MiniSearch: 2,
  Lunr: 3,
  'Fuse.js': 4,
};
