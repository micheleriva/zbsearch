'use client';

import { cn } from '@/lib/cn';
import {
  averageQualityScores,
  multilingualConfigColors,
  multilingualConfigLabels,
  multilingualConfigs,
  multilingualLanguages,
  multilingualMacro,
  multilingualMetricLabels,
  multilingualMixed,
  multilingualPerLanguage,
  qualityEngineColors,
  qualityEngineOrder,
  qualityMetricLabels,
  searchQualityDatasets,
  searchQualityNotes,
  type MultilingualConfigKey,
  type MultilingualMetricKey,
  type QualityEngineKey,
  type QualityMetricKey,
} from '@/lib/benchmarks/quality-data';
import { useMemo, useState } from 'react';

type DatasetTab = 'macro' | string;

function formatScore(value: number): string {
  return value.toFixed(3);
}

function formatMs(value: number | null, crashed: boolean): string {
  if (crashed || value == null) return 'crashed';
  if (value >= 100) return `${Math.round(value)} ms`;
  if (value >= 10) return `${value.toFixed(1)} ms`;
  return `${value.toFixed(2)} ms`;
}

function datasetTitle(id: string): string {
  if (id === 'macro') return 'Macro average';
  if (id === 'scifact') return 'SciFact';
  if (id === 'nfcorpus') return 'NFCorpus';
  if (id === 'arguana') return 'ArguAna';
  return id;
}

function SearchQualitySection() {
  const [dataset, setDataset] = useState<DatasetTab>('macro');
  const [metric, setMetric] = useState<QualityMetricKey>('ndcg10');
  const [activeEngine, setActiveEngine] = useState<QualityEngineKey | null>(null);

  const engines = useMemo(() => {
    if (dataset === 'macro') {
      return averageQualityScores(searchQualityDatasets);
    }
    const found = searchQualityDatasets.find((entry) => entry.id === dataset);
    return found?.engines ?? averageQualityScores(searchQualityDatasets);
  }, [dataset]);

  const reference =
    dataset === 'macro'
      ? null
      : (searchQualityDatasets.find((entry) => entry.id === dataset)?.referenceBm25Ndcg10 ??
        null);

  const rows = qualityEngineOrder.map((key) => ({
    key,
    ...engines[key],
    value: engines[key][metric],
  }));

  const maxValue = Math.max(
    ...rows.map((row) => row.value),
    metric === 'ndcg10' && reference != null ? reference : 0,
    0.01,
  );

  const datasetMeta =
    dataset === 'macro'
      ? {
          documents: searchQualityDatasets.reduce((sum, entry) => sum + entry.documents, 0),
          queries: searchQualityDatasets.reduce((sum, entry) => sum + entry.queries, 0),
        }
      : searchQualityDatasets.find((entry) => entry.id === dataset);

  return (
    <section className="rounded-2xl border border-fd-border bg-fd-card/80 p-4 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-fd-foreground">
            Search quality (BEIR)
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fd-foreground/65">
            Ranking quality on official BEIR collections with trec_eval-compatible metrics. Higher
            is better. Primary metric is nDCG@10.
          </p>
        </div>
        {datasetMeta && (
          <p className="shrink-0 text-xs tabular-nums text-fd-foreground/55">
            {datasetMeta.documents.toLocaleString()} docs · {datasetMeta.queries.toLocaleString()}{' '}
            queries
          </p>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(['macro', ...searchQualityDatasets.map((entry) => entry.id)] as DatasetTab[]).map(
          (id) => (
            <button
              key={id}
              type="button"
              onClick={() => setDataset(id)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                dataset === id
                  ? 'border-fd-primary/40 bg-fd-primary/10 text-fd-foreground'
                  : 'border-fd-border bg-fd-background text-fd-foreground/70 hover:text-fd-foreground',
              )}
            >
              {datasetTitle(id)}
            </button>
          ),
        )}
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {(Object.keys(qualityMetricLabels) as QualityMetricKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setMetric(key)}
            className={cn(
              'rounded-lg border px-2.5 py-1 text-xs tabular-nums transition-colors',
              metric === key
                ? 'border-fd-primary/40 bg-fd-primary/10 font-semibold text-fd-foreground'
                : 'border-fd-border bg-fd-background text-fd-foreground/65 hover:text-fd-foreground',
            )}
          >
            {qualityMetricLabels[key]}
          </button>
        ))}
      </div>

      <div className="space-y-2.5">
        {metric === 'ndcg10' && reference != null && (
          <div className="mb-3 flex items-center gap-2 text-xs text-fd-foreground/60">
            <span
              className="inline-block h-px w-6 border-t border-dashed border-fd-foreground/40"
              aria-hidden
            />
            Lucene BM25 reference: {formatScore(reference)}
          </div>
        )}

        {rows.map((row) => {
          const dimmed = activeEngine !== null && activeEngine !== row.key;
          const highlighted = activeEngine === row.key;
          const isZbsearch = row.key.startsWith('zbsearch');
          const width = (row.value / maxValue) * 100;
          const referenceWidth =
            metric === 'ndcg10' && reference != null ? (reference / maxValue) * 100 : null;

          return (
            <button
              key={row.key}
              type="button"
              onMouseEnter={() => setActiveEngine(row.key)}
              onMouseLeave={() => setActiveEngine(null)}
              onFocus={() => setActiveEngine(row.key)}
              onBlur={() => setActiveEngine(null)}
              className={cn(
                'grid w-full grid-cols-[minmax(7.5rem,9rem)_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all',
                isZbsearch ? 'border-fd-primary/25 bg-fd-primary/5' : 'border-fd-border bg-fd-background',
                dimmed && 'opacity-35',
                highlighted && 'ring-1 ring-fd-primary/20',
              )}
            >
              <span className="inline-flex items-center gap-2 text-xs font-medium text-fd-foreground">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: qualityEngineColors[row.key] }}
                />
                {row.label}
              </span>

              <div className="relative h-2.5 overflow-hidden rounded-full bg-fd-muted">
                {referenceWidth != null && (
                  <div
                    aria-hidden
                    className="absolute inset-y-0 w-px border-l border-dashed border-fd-foreground/35"
                    style={{ left: `${referenceWidth}%` }}
                  />
                )}
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{
                    width: `${width}%`,
                    backgroundColor: qualityEngineColors[row.key],
                  }}
                />
              </div>

              <div className="min-w-[5.5rem] text-right">
                <p className="text-sm font-semibold tabular-nums text-fd-foreground">
                  {row.timing.crashed && row.value === 0 ? '—' : formatScore(row.value)}
                </p>
                <p className="text-[10px] tabular-nums text-fd-foreground/55">
                  {formatMs(row.timing.msPerQuery, row.timing.crashed)}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {searchQualityNotes[0] && (
        <p className="mt-4 text-xs leading-relaxed text-fd-foreground/55">{searchQualityNotes[0]}</p>
      )}
    </section>
  );
}

function MultilingualSection() {
  const [metric, setMetric] = useState<MultilingualMetricKey>('recall');
  const [activeConfig, setActiveConfig] = useState<MultilingualConfigKey | null>(null);

  const width = 640;
  const height = 260;
  const padding = { top: 16, right: 16, bottom: 36, left: 36 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const groupWidth = chartWidth / multilingualLanguages.length;
  const barWidth = groupWidth / (multilingualConfigs.length + 1);

  const maxValue = Math.max(
    ...multilingualLanguages.flatMap((language) =>
      multilingualConfigs.map((config) => multilingualPerLanguage[language][config][metric]),
    ),
    0.01,
  );

  return (
    <section className="rounded-2xl border border-fd-border bg-fd-card/80 p-4 sm:p-6">
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight text-fd-foreground">
          Multilingual quality
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fd-foreground/65">
          Zero-config <code className="text-xs">language: &apos;multilingual&apos;</code> vs
          per-language stemmers/stopwords vs the English default tokenizer.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {(Object.keys(multilingualMetricLabels) as MultilingualMetricKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setMetric(key)}
            className={cn(
              'rounded-lg border px-2.5 py-1 text-xs transition-colors',
              metric === key
                ? 'border-fd-primary/40 bg-fd-primary/10 font-semibold text-fd-foreground'
                : 'border-fd-border bg-fd-background text-fd-foreground/65 hover:text-fd-foreground',
            )}
          >
            {multilingualMetricLabels[key]}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        {multilingualConfigs.map((config) => (
          <button
            key={config}
            type="button"
            onMouseEnter={() => setActiveConfig(config)}
            onMouseLeave={() => setActiveConfig(null)}
            onFocus={() => setActiveConfig(config)}
            onBlur={() => setActiveConfig(null)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border border-fd-border bg-fd-background px-2.5 py-1 text-xs transition-opacity',
              activeConfig !== null && activeConfig !== config && 'opacity-40',
            )}
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: multilingualConfigColors[config] }}
            />
            {multilingualConfigLabels[config]}
            <span className="ml-1 tabular-nums text-fd-foreground/55">
              {formatScore(multilingualMacro[config][metric])}
            </span>
          </button>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full text-fd-foreground"
        role="img"
        aria-label={`Multilingual ${multilingualMetricLabels[metric]} by language`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = padding.top + chartHeight - tick * chartHeight;
          return (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                className="stroke-fd-border"
                strokeDasharray={tick === 0 || tick === 1 ? '0' : '3 4'}
                strokeWidth={1}
              />
              <text
                x={padding.left - 8}
                y={y + 3}
                textAnchor="end"
                className="fill-fd-foreground/70 text-[10px]"
              >
                {tick.toFixed(2)}
              </text>
            </g>
          );
        })}

        {multilingualLanguages.map((language, languageIndex) => {
          const groupX = padding.left + languageIndex * groupWidth;
          return (
            <g key={language}>
              <text
                x={groupX + groupWidth / 2}
                y={height - 10}
                textAnchor="middle"
                className="fill-fd-foreground/75 text-[10px]"
              >
                {
                  (
                    {
                      english: 'en',
                      italian: 'it',
                      spanish: 'es',
                      german: 'de',
                      french: 'fr',
                      portuguese: 'pt',
                      russian: 'ru',
                      arabic: 'ar',
                    } as Record<string, string>
                  )[language] ?? language
                }
              </text>
              {multilingualConfigs.map((config, configIndex) => {
                const value = multilingualPerLanguage[language][config][metric];
                const barHeight = (value / maxValue) * chartHeight;
                const x = groupX + barWidth * (configIndex + 0.5);
                const y = padding.top + chartHeight - barHeight;
                const dimmed = activeConfig !== null && activeConfig !== config;

                return (
                  <rect
                    key={config}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(barHeight, 1)}
                    rx={2}
                    fill={multilingualConfigColors[config]}
                    className={cn('transition-opacity', dimmed && 'opacity-25')}
                    onMouseEnter={() => setActiveConfig(config)}
                    onMouseLeave={() => setActiveConfig(null)}
                  >
                    <title>
                      {language} · {multilingualConfigLabels[config]} · {formatScore(value)}
                    </title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-fd-border bg-fd-background px-3 py-3">
          <p className="text-xs font-medium text-fd-foreground/70">Mixed index (all languages)</p>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <span className="tabular-nums">
              <span className="text-fd-foreground/55">Multilingual </span>
              <span className="font-semibold">{formatScore(multilingualMixed.multilingual[metric])}</span>
            </span>
            <span className="tabular-nums">
              <span className="text-fd-foreground/55">English default </span>
              <span className="font-semibold">
                {formatScore(multilingualMixed['english-default'][metric])}
              </span>
            </span>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-fd-foreground/55 sm:self-center">
          Multilingual matches per-language on exact and diacritic queries; morphology still favors
          tuned stemmers. Non-Latin scripts collapse under the English default tokenizer.
        </p>
      </div>
    </section>
  );
}

export function QualityCharts() {
  return (
    <div className="space-y-6">
      <div id="search-quality" className="scroll-mt-24">
        <SearchQualitySection />
      </div>
      <div id="multilingual" className="scroll-mt-24">
        <MultilingualSection />
      </div>
    </div>
  );
}
