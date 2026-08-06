import searchQualityJson from './results/search-quality.json';
import multilingualQualityJson from './results/multilingual-quality.json';

export type QualityMetricKey =
  | 'ndcg10'
  | 'map100'
  | 'recall100'
  | 'precision10'
  | 'mrr10';

export type QualityEngineKey =
  | 'zbsearch-bm25'
  | 'zbsearch-qps'
  | 'zbsearch-pt15'
  | 'orama'
  | 'minisearch'
  | 'flexsearch'
  | 'lunr'
  | 'fusejs';

export type QualityEngineScore = {
  label: string;
  ndcg10: number;
  map100: number;
  recall100: number;
  precision10: number;
  mrr10: number;
  timing: {
    buildSeconds: number | null;
    msPerQuery: number | null;
    queries: number;
    crashed: boolean;
  };
};

export type QualityDataset = {
  id: string;
  documents: number;
  queries: number;
  referenceBm25Ndcg10: number;
  engines: Record<QualityEngineKey, QualityEngineScore>;
};

export type MultilingualMetricKey = 'precision' | 'recall' | 'mrr';
export type MultilingualConfigKey = 'multilingual' | 'per-language' | 'english-default';

export const qualityMetricLabels: Record<QualityMetricKey, string> = {
  ndcg10: 'nDCG@10',
  map100: 'MAP@100',
  recall100: 'R@100',
  precision10: 'P@10',
  mrr10: 'MRR@10',
};

export const qualityEngineOrder: QualityEngineKey[] = [
  'zbsearch-bm25',
  'zbsearch-qps',
  'zbsearch-pt15',
  'orama',
  'minisearch',
  'flexsearch',
  'lunr',
  'fusejs',
];

export const multilingualConfigs: MultilingualConfigKey[] = [
  'multilingual',
  'per-language',
  'english-default',
];

export const multilingualConfigLabels: Record<MultilingualConfigKey, string> = {
  multilingual: 'Multilingual',
  'per-language': 'Per-language',
  'english-default': 'English default',
};

export const multilingualMetricLabels: Record<MultilingualMetricKey, string> = {
  precision: 'P@10',
  recall: 'R@10',
  mrr: 'MRR',
};

function buildDatasets(): QualityDataset[] {
  return Object.entries(searchQualityJson.datasets).map(([id, dataset]) => ({
    id,
    documents: dataset.documents,
    queries: dataset.queries,
    referenceBm25Ndcg10: dataset.referenceBm25Ndcg10,
    engines: dataset.engines as Record<QualityEngineKey, QualityEngineScore>,
  }));
}

export const searchQualityDatasets = buildDatasets();

export const searchQualityNotes = searchQualityJson.notes as string[];

export function averageQualityScores(
  datasets: QualityDataset[],
): Record<QualityEngineKey, QualityEngineScore> {
  const result = {} as Record<QualityEngineKey, QualityEngineScore>;

  for (const key of qualityEngineOrder) {
    const scores = datasets.map((dataset) => dataset.engines[key]);
    const n = scores.length;
    let totalQueryMs = 0;
    let totalQueries = 0;
    let anyCrashed = false;

    for (const score of scores) {
      if (score.timing.crashed || score.timing.msPerQuery == null) {
        anyCrashed = true;
        continue;
      }
      totalQueryMs += score.timing.msPerQuery * score.timing.queries;
      totalQueries += score.timing.queries;
    }

    result[key] = {
      label: scores[0].label,
      ndcg10: scores.reduce((sum, score) => sum + score.ndcg10, 0) / n,
      map100: scores.reduce((sum, score) => sum + score.map100, 0) / n,
      recall100: scores.reduce((sum, score) => sum + score.recall100, 0) / n,
      precision10: scores.reduce((sum, score) => sum + score.precision10, 0) / n,
      mrr10: scores.reduce((sum, score) => sum + score.mrr10, 0) / n,
      timing: {
        buildSeconds:
          scores.reduce((sum, score) => sum + (score.timing.buildSeconds ?? 0), 0) / n,
        msPerQuery: totalQueries > 0 ? totalQueryMs / totalQueries : null,
        queries: totalQueries,
        crashed: anyCrashed && totalQueries === 0,
      },
    };
  }

  return result;
}

export const multilingualLanguages = Object.keys(
  multilingualQualityJson.perLanguage,
) as string[];

export const multilingualPerLanguage = multilingualQualityJson.perLanguage as Record<
  string,
  Record<MultilingualConfigKey, { precision: number; recall: number; mrr: number }>
>;

export const multilingualMacro = multilingualQualityJson.macroAverage as Record<
  MultilingualConfigKey,
  { precision: number; recall: number; mrr: number }
>;

export const multilingualMixed = multilingualQualityJson.mixed as Record<
  'multilingual' | 'english-default',
  { precision: number; recall: number; mrr: number }
>;
