'use client';

import { cn } from '@/lib/cn';
import {
  averageQualityScores,
  multilingualConfigLabels,
  multilingualConfigs,
  multilingualLanguages,
  multilingualMacro,
  multilingualMetricLabels,
  multilingualMixed,
  multilingualPerLanguage,
  qualityEngineOrder,
  qualityMetricLabels,
  searchQualityDatasets,
  searchQualityNotes,
  type MultilingualConfigKey,
  type MultilingualMetricKey,
  type QualityEngineKey,
  type QualityMetricKey,
} from '@/lib/benchmarks/quality-data';
import { ChartLegend } from './legend';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

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

  const rows = qualityEngineOrder
    .map((key) => ({
      key,
      ...engines[key],
      value: engines[key][metric],
    }))
    .sort((a, b) => b.value - a.value);

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
    <section className="rounded-2xl border border-fd-border bg-fd-card p-4 sm:p-6">
      <div className="mb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-xl font-semibold tracking-tight text-fd-foreground">
            <a href="#search-quality" className="group">
              Search quality (BEIR)
              <span
                aria-hidden
                className="ml-2 text-fd-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                #
              </span>
            </a>
          </h2>
          {datasetMeta && (
            <p className="shrink-0 text-xs tabular-nums text-fd-muted-foreground">
              {datasetMeta.documents.toLocaleString('en-US')} docs ·{' '}
              {datasetMeta.queries.toLocaleString('en-US')} queries
            </p>
          )}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-fd-muted-foreground">
          Ranking quality on official BEIR collections with trec_eval-compatible metrics. Higher is
          better. Primary metric is nDCG@10.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(['macro', ...searchQualityDatasets.map((entry) => entry.id)] as DatasetTab[]).map(
          (id) => (
            <button
              key={id}
              type="button"
              onClick={() => setDataset(id)}
              className={cn(
                'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
                dataset === id
                  ? 'border-fd-primary/40 bg-fd-primary/10 text-fd-foreground'
                  : 'border-fd-border bg-fd-background text-fd-muted-foreground hover:text-fd-foreground',
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
                : 'border-fd-border bg-fd-background text-fd-muted-foreground hover:text-fd-foreground',
            )}
          >
            {qualityMetricLabels[key]}
          </button>
        ))}
      </div>

      <div className="space-y-2.5">
        {metric === 'ndcg10' && reference != null && (
          <div className="mb-3 flex items-center gap-2 text-xs text-fd-muted-foreground">
            <span
              className="inline-block h-px w-6 border-t border-dashed border-fd-muted-foreground"
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
                  aria-hidden
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    isZbsearch ? 'bg-chart-subject' : 'bg-chart-other',
                  )}
                />
                {row.label}
              </span>

              <div className="relative h-2.5 overflow-hidden rounded-xs bg-fd-muted">
                {referenceWidth != null && (
                  <div
                    aria-hidden
                    className="absolute inset-y-0 w-px border-l border-dashed border-fd-muted-foreground"
                    style={{ left: `${referenceWidth}%` }}
                  />
                )}
                <div
                  className={cn(
                    'h-full rounded-xs transition-[width]',
                    isZbsearch ? 'bg-chart-subject' : 'bg-chart-other',
                  )}
                  style={{ width: `${width}%` }}
                />
              </div>

              <div className="min-w-[5.5rem] text-right">
                <p className="text-sm font-semibold tabular-nums text-fd-foreground">
                  {row.timing.crashed && row.value === 0 ? '—' : formatScore(row.value)}
                </p>
                <p className="text-[10px] tabular-nums text-fd-muted-foreground">
                  {formatMs(row.timing.msPerQuery, row.timing.crashed)}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <ChartLegend className="mt-4 border-t border-fd-border pt-3" />

      {searchQualityNotes[0] && (
        <p className="mt-3 text-xs leading-relaxed text-fd-muted-foreground">{searchQualityNotes[0]}</p>
      )}
    </section>
  );
}

function MultilingualSection() {
  const [metric, setMetric] = useState<MultilingualMetricKey>('recall');
  const [view, setView] = useState<'macro' | 'mixed' | string>('macro');
  const [activeConfig, setActiveConfig] = useState<MultilingualConfigKey | null>(null);

  const scores =
    view === 'macro'
      ? multilingualMacro
      : view === 'mixed'
        ? multilingualMixed
        : multilingualPerLanguage[view];
  const rows = multilingualConfigs
    .filter((config) => config in scores)
    .map((config) => ({ config, value: scores[config as keyof typeof scores][metric] }))
    .sort((a, b) => b.value - a.value);
  const maxValue = rows[0]?.value ?? 1;

  const viewLabel = (id: string) => {
    if (id === 'macro') return 'Macro average';
    if (id === 'mixed') return 'Mixed index';
    return id[0].toUpperCase() + id.slice(1);
  };

  return (
    <section className="rounded-2xl border border-fd-border bg-fd-card p-4 sm:p-6">
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight text-fd-foreground">
          <a href="#multilingual" className="group">
            Multilingual quality
            <span
              aria-hidden
              className="ml-2 text-fd-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              #
            </span>
          </a>
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-fd-muted-foreground">
          Zero-config <code className="text-xs">language: &apos;multilingual&apos;</code> vs
          per-language stemmers/stopwords vs the English default tokenizer.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(['macro', ...multilingualLanguages, 'mixed'] as string[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={cn(
              'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
              view === id
                ? 'border-fd-primary/40 bg-fd-primary/10 text-fd-foreground'
                : 'border-fd-border bg-fd-background text-fd-muted-foreground hover:text-fd-foreground',
            )}
          >
            {viewLabel(id)}
          </button>
        ))}
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
                : 'border-fd-border bg-fd-background text-fd-muted-foreground hover:text-fd-foreground',
            )}
          >
            {multilingualMetricLabels[key]}
          </button>
        ))}
      </div>

      <div className="space-y-2.5">
        {rows.map(({ config, value }) => {
          const dimmed = activeConfig !== null && activeConfig !== config;
          const highlighted = activeConfig === config;
          const isSubject = config === 'multilingual';
          const relative = value / maxValue;

          return (
            <button
              key={config}
              type="button"
              onMouseEnter={() => setActiveConfig(config)}
              onMouseLeave={() => setActiveConfig(null)}
              onFocus={() => setActiveConfig(config)}
              onBlur={() => setActiveConfig(null)}
              className={cn(
                'grid w-full grid-cols-[minmax(8.5rem,10.5rem)_1fr_auto] items-center gap-3 rounded-xl border border-fd-border bg-fd-background px-3 py-2.5 text-left transition-all',
                isSubject && 'border-fd-primary/25 bg-fd-primary/5',
                dimmed && 'opacity-35',
                highlighted && 'ring-1 ring-fd-primary/20',
              )}
            >
              <span className="inline-flex items-center gap-2 text-xs font-medium text-fd-foreground">
                <span
                  aria-hidden
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    isSubject ? 'bg-chart-subject' : 'bg-chart-other',
                  )}
                />
                {multilingualConfigLabels[config]}
              </span>

              <div className="h-2.5 overflow-hidden rounded-xs bg-fd-muted">
                <div
                  className={cn(
                    'h-full rounded-xs transition-[width]',
                    isSubject ? 'bg-chart-subject' : 'bg-chart-other',
                  )}
                  style={{ width: `${relative * 100}%` }}
                />
              </div>

              <div className="min-w-[5.5rem] text-right">
                <p className="text-sm font-semibold tabular-nums text-fd-foreground">
                  {formatScore(value)}
                </p>
                <p className="text-[10px] tabular-nums text-fd-muted-foreground">
                  {relative === 1 ? 'Best' : `${Math.round(relative * 100)}% of best`}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <ChartLegend
        subject="Zero-config multilingual"
        other="Other configurations"
        className="mt-4 border-t border-fd-border pt-3"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs leading-relaxed text-fd-muted-foreground">
        <span>
          {view === 'mixed'
            ? 'All languages share one index; per-language tuning does not apply.'
            : `${viewLabel(view)} results for the selected metric.`}
        </span>
        <span>
          Multilingual handles exact forms, diacritics, and non-Latin scripts without language
          configuration; tuned stemmers still lead on morphology.
        </span>
      </div>
    </section>
  );
}

export function QualityCharts({ between }: { between?: ReactNode } = {}) {
  return (
    <div className="space-y-6">
      <div id="search-quality" className="scroll-mt-24">
        <SearchQualitySection />
      </div>
      {between}
      <div id="multilingual" className="scroll-mt-24">
        <MultilingualSection />
      </div>
    </div>
  );
}
