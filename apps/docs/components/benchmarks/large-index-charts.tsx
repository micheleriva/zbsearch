'use client'

import { cn } from '@/lib/cn'
import {
  formatDocs,
  formatDuration,
  largeIndexFailure,
  largeIndexReport,
  largeIndexRuns,
  largeIndexSizes,
  type LargeIndexRun
} from '@/lib/benchmarks/large-index-data'
import { TimerOff, TriangleAlert } from 'lucide-react'
import { ChartLegend } from './legend'
import { useState } from 'react'

type MetricKey = 'index' | 'heap' | 'p50' | 'p95' | 'qps'

type Metric = {
  label: string
  description: string
  lowerIsBetter: boolean
  needsSearch: boolean
  value: (run: LargeIndexRun) => number | null
  format: (value: number) => string
  detail: (run: LargeIndexRun) => string | null
}

function formatMB(value: number): string {
  if (value >= 1024) return `${(value / 1024).toFixed(2)} GB`
  if (value >= 100) return `${Math.round(value)} MB`
  return `${value.toFixed(1)} MB`
}

function formatQps(value: number): string {
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  if (value >= 10) return Math.round(value).toLocaleString('en-US')
  return value.toFixed(1)
}

const metrics: Record<MetricKey, Metric> = {
  index: {
    label: 'Indexing time',
    description: 'Wall time to add every passage (and, for ZBSearch frozen, to freeze the index). Lower is better.',
    lowerIsBetter: true,
    needsSearch: false,
    value: (run) => run.indexMs,
    format: formatDuration,
    detail: (run) =>
      [
        run.docsPerSecond != null && `${run.docsPerSecond.toLocaleString('en-US')} docs/s`,
        run.freezeMs != null && `freeze ${formatDuration(run.freezeMs)}`
      ]
        .filter(Boolean)
        .join(' · ') || null
  },
  heap: {
    label: 'Heap',
    description: 'Heap held by the index and its document store after indexing and a full GC. Lower is better.',
    lowerIsBetter: true,
    needsSearch: false,
    value: (run) => run.heapMB,
    format: formatMB,
    detail: (run) => (run.rssMB != null ? `RSS ${formatMB(run.rssMB)}` : null)
  },
  p50: {
    label: 'Search p50',
    description: 'Median latency of the query set. Lower is better.',
    lowerIsBetter: true,
    needsSearch: true,
    value: (run) => run.search?.p50Ms ?? null,
    format: formatDuration,
    detail: (run) => (run.search?.meanMs != null ? `mean ${formatDuration(run.search.meanMs)}` : null)
  },
  p95: {
    label: 'Search p95',
    description: '95th-percentile latency of the query set. Lower is better.',
    lowerIsBetter: true,
    needsSearch: true,
    value: (run) => run.search?.p95Ms ?? null,
    format: formatDuration,
    detail: (run) => (run.search?.p99Ms != null ? `p99 ${formatDuration(run.search.p99Ms)}` : null)
  },
  qps: {
    label: 'QPS',
    description: 'Queries per second, one query at a time (1 / mean latency). Higher is better.',
    lowerIsBetter: false,
    needsSearch: true,
    value: (run) => run.search?.qps ?? null,
    format: formatQps,
    detail: () => 'queries/s'
  }
}

function formatRatio(ratio: number, metric: MetricKey): string {
  if (ratio <= 1.0001) return metric === 'heap' ? 'Smallest' : 'Fastest'
  const rounded =
    ratio >= 100 ? Math.round(ratio).toLocaleString('en-US') : ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)
  return metric === 'heap' ? `${rounded}× more` : `${rounded}× slower`
}

/** A run has a value for the metric only if the phase it measures completed. */
function measured(run: LargeIndexRun, metric: Metric): number | null {
  if (metric.needsSearch && run.status !== 'ok') return null
  return metric.value(run)
}

function StatusIcon({ run, className }: { run: LargeIndexRun; className?: string }) {
  const Icon = run.status === 'crashed' ? TriangleAlert : TimerOff
  return <Icon aria-hidden className={cn('size-3.5 shrink-0', className)} />
}

function FailureNote({ run, metric }: { run: LargeIndexRun; metric: Metric }) {
  const failure = largeIndexFailure(run)
  const partial = metric.needsSearch && run.status === 'search-timeout' ? metric.value(run) : null
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-fd-muted-foreground">
      <StatusIcon run={run} />
      <span className="leading-snug">
        {failure}
        {partial != null && ` · partial ${metric.format(partial)}`}
      </span>
    </span>
  )
}

function SizeChart({
  docs,
  metricKey,
  setMetricKey
}: {
  docs: number
  metricKey: MetricKey
  setMetricKey: (key: MetricKey) => void
}) {
  const [activeEngine, setActiveEngine] = useState<string | null>(null)
  const metric = metrics[metricKey]
  const runs = largeIndexRuns(docs)

  const withValue = runs
    .map((run) => ({ run, value: measured(run, metric) }))
    .filter((row): row is { run: LargeIndexRun; value: number } => row.value != null)
    .sort((a, b) => (metric.lowerIsBetter ? a.value - b.value : b.value - a.value))
  const failed = runs.filter((run) => measured(run, metric) == null)
  const best = withValue[0]?.value ?? 1

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(metrics) as MetricKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setMetricKey(key)}
            className={cn(
              'rounded-lg border px-2.5 py-1 text-xs tabular-nums transition-colors',
              metricKey === key
                ? 'border-fd-primary/40 bg-fd-primary/10 font-semibold text-fd-foreground'
                : 'border-fd-border bg-fd-background text-fd-muted-foreground hover:text-fd-foreground'
            )}
          >
            {metrics[key].label}
          </button>
        ))}
      </div>
      <p className="mb-4 text-xs leading-relaxed text-fd-muted-foreground">{metric.description}</p>

      <div className="space-y-2.5">
        {withValue.map(({ run, value }) => {
          const dimmed = activeEngine !== null && activeEngine !== run.engine
          const highlighted = activeEngine === run.engine
          const isZbsearch = run.engine.startsWith('zbsearch')
          // Bars read "longer is better" in every metric, as on the throughput chart
          const ratio = metric.lowerIsBetter ? value / best : best / value
          const width = Math.max(100 / ratio, 0.75)

          return (
            <button
              key={run.engine}
              type="button"
              onMouseEnter={() => setActiveEngine(run.engine)}
              onMouseLeave={() => setActiveEngine(null)}
              onFocus={() => setActiveEngine(run.engine)}
              onBlur={() => setActiveEngine(null)}
              title={metric.detail(run) ?? undefined}
              className={cn(
                'grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 text-left transition-all sm:grid-cols-[minmax(7.5rem,10.5rem)_1fr_auto]',
                isZbsearch ? 'border-fd-primary/25 bg-fd-primary/5' : 'border-fd-border bg-fd-background',
                dimmed && 'opacity-35',
                highlighted && 'ring-1 ring-fd-primary/20'
              )}
            >
              <span className="inline-flex items-center gap-2 text-xs font-medium text-fd-foreground">
                <span
                  aria-hidden
                  className={cn('size-2 shrink-0 rounded-full', isZbsearch ? 'bg-chart-subject' : 'bg-chart-other')}
                />
                {run.label}
              </span>

              <div className="col-span-2 row-start-2 h-2.5 overflow-hidden rounded-xs bg-fd-muted sm:col-span-1 sm:row-start-auto">
                <div
                  className={cn(
                    'h-full rounded-xs transition-[width]',
                    isZbsearch ? 'bg-chart-subject' : 'bg-chart-other'
                  )}
                  style={{ width: `${width}%` }}
                />
              </div>

              <div className="min-w-[6.5rem] text-right">
                <p className="text-sm font-semibold tabular-nums text-fd-foreground">{metric.format(value)}</p>
                <p className="text-[10px] tabular-nums text-fd-muted-foreground">{formatRatio(ratio, metricKey)}</p>
              </div>
            </button>
          )
        })}

        {failed.map((run) => {
          const isZbsearch = run.engine.startsWith('zbsearch')
          return (
            <div
              key={run.engine}
              className={cn(
                'grid w-full grid-cols-1 items-center gap-x-3 gap-y-1.5 rounded-xl border border-dashed px-3 py-2.5 sm:grid-cols-[minmax(7.5rem,10.5rem)_1fr]',
                isZbsearch ? 'border-fd-primary/25' : 'border-fd-border'
              )}
            >
              <span className="inline-flex items-center gap-2 text-xs font-medium text-fd-foreground">
                <span
                  aria-hidden
                  className={cn(
                    'size-2 shrink-0 rounded-full border',
                    isZbsearch ? 'border-chart-subject' : 'border-chart-other'
                  )}
                />
                {run.label}
              </span>
              <FailureNote run={run} metric={metric} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function cell(value: number | null | undefined, format: (value: number) => string): string {
  return value == null ? '-' : format(value)
}

function SizeTable({ docs }: { docs: number }) {
  const runs = largeIndexRuns(docs)
  const { queries } = largeIndexReport.config

  return (
    <div className="overflow-x-auto rounded-xl border border-fd-border">
      <table className="w-full min-w-[52rem] text-left text-xs tabular-nums">
        <caption className="sr-only">
          Large-index results for {docs.toLocaleString('en-US')} passages, every engine and metric
        </caption>
        <thead className="bg-fd-muted/50 text-fd-muted-foreground">
          <tr>
            {[
              'Engine',
              'Status',
              'Indexing',
              'Docs/s',
              'Freeze',
              'Heap',
              'RSS',
              'p50',
              'p95',
              'p99',
              'QPS',
              'Queries'
            ].map((heading, i) => (
              <th key={heading} scope="col" className={cn('px-3 py-2 font-medium', i > 1 && 'text-right')}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const failure = largeIndexFailure(run)
            const search = run.search
            const partial = run.status === 'search-timeout'
            return (
              <tr key={run.engine} className="border-t border-fd-border">
                <th scope="row" className="px-3 py-2 font-medium text-fd-foreground">
                  {run.label}
                </th>
                <td className="min-w-[14rem] px-3 py-2 text-fd-muted-foreground">
                  {failure ? (
                    <span className="inline-flex items-center gap-1.5">
                      <StatusIcon run={run} />
                      {failure}
                    </span>
                  ) : (
                    'Completed'
                  )}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{cell(run.indexMs, formatDuration)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {cell(run.docsPerSecond, (v) => v.toLocaleString('en-US'))}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{cell(run.freezeMs, formatDuration)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{cell(run.heapMB, formatMB)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{cell(run.rssMB, formatMB)}</td>
                <td
                  className={cn('px-3 py-2 text-right whitespace-nowrap', partial && 'text-fd-muted-foreground italic')}
                >
                  {cell(search?.p50Ms, formatDuration)}
                </td>
                <td
                  className={cn('px-3 py-2 text-right whitespace-nowrap', partial && 'text-fd-muted-foreground italic')}
                >
                  {cell(search?.p95Ms, formatDuration)}
                </td>
                <td
                  className={cn('px-3 py-2 text-right whitespace-nowrap', partial && 'text-fd-muted-foreground italic')}
                >
                  {cell(search?.p99Ms, formatDuration)}
                </td>
                <td
                  className={cn('px-3 py-2 text-right whitespace-nowrap', partial && 'text-fd-muted-foreground italic')}
                >
                  {cell(search?.qps, formatQps)}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {search ? `${search.queries}/${queries}` : '-'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function LargeIndexCharts() {
  const [docs, setDocs] = useState(largeIndexSizes[0])
  const [metricKey, setMetricKey] = useState<MetricKey>('index')

  return (
    <section id="results" className="scroll-mt-24 rounded-2xl border border-fd-border bg-fd-card p-4 sm:p-6">
      <div className="mb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-xl font-semibold tracking-tight text-fd-foreground">
            <a href="#results" className="group">
              Results by index size
              <span
                aria-hidden
                className="ml-2 text-fd-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                #
              </span>
            </a>
          </h2>
          <p className="shrink-0 text-xs tabular-nums text-fd-muted-foreground">
            {docs.toLocaleString('en-US')} passages · {largeIndexReport.config.queries} queries
          </p>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-fd-muted-foreground">
          Every engine indexes the same passages in its own process. Engines that run out of time or memory stay in the
          chart, marked with what stopped them.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {largeIndexSizes.map((size) => (
          <button
            key={size}
            type="button"
            onClick={() => setDocs(size)}
            className={cn(
              'rounded-md border px-3 py-1 text-xs font-medium tabular-nums transition-colors',
              docs === size
                ? 'border-fd-primary/40 bg-fd-primary/10 text-fd-foreground'
                : 'border-fd-border bg-fd-background text-fd-muted-foreground hover:text-fd-foreground'
            )}
          >
            {formatDocs(size)} passages
          </button>
        ))}
      </div>

      <SizeChart docs={docs} metricKey={metricKey} setMetricKey={setMetricKey} />

      <ChartLegend className="mt-4 border-t border-fd-border pt-3" />

      <h3 className="mt-8 mb-3 text-sm font-semibold text-fd-foreground">
        All metrics, {docs.toLocaleString('en-US')} passages
      </h3>
      <SizeTable docs={docs} />
      <p className="mt-3 text-xs leading-relaxed text-fd-muted-foreground">
        Italic latencies are partial: the queries that completed before the search timeout. A dash means the phase did
        not complete.
      </p>
    </section>
  )
}
