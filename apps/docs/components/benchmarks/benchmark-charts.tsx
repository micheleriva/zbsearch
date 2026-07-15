'use client';

import { cn } from '@/lib/cn';
import {
  benchmarkEngines,
  benchmarkSuites,
  engineColors,
  type BenchmarkEngine,
  type BenchmarkResult,
} from '@/lib/benchmarks/data';
import { useMemo, useState } from 'react';

function formatOps(value: number): string {
  if (value >= 10_000) {
    return `${Math.round(value / 1000)}k`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return value.toLocaleString();
}

function formatTitle(name: string): string {
  return name
    .replace(/^search with /, '')
    .replace(/^plain search \(all terms\)$/, 'plain search')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatSpeedRatio(ops: number, baseline: number): string {
  if (ops >= baseline) {
    return 'Fastest';
  }

  const ratio = baseline / ops;

  if (ratio >= 100) {
    return `${Math.round(ratio).toLocaleString()}× slower`;
  }

  if (ratio >= 10) {
    return `${Math.round(ratio)}× slower`;
  }

  return `${ratio.toFixed(1)}× slower`;
}

function getBaselineOps(results: BenchmarkResult[]): number {
  const zbsearch = results.find((result) => result.engine === 'ZBSearch');
  if (zbsearch) {
    return zbsearch.ops;
  }

  return Math.max(...results.map((result) => result.ops));
}

function getCellIntensity(ops: number, maxOps: number): number {
  return Math.max(0.12, ops / maxOps);
}

function BenchmarkMatrix({
  activeEngine,
  onEngineHover,
}: {
  activeEngine: BenchmarkEngine | null;
  onEngineHover: (engine: BenchmarkEngine | null) => void;
}) {
  const suiteMeta = useMemo(
    () =>
      benchmarkSuites.map((suite) => {
        const maxOps = Math.max(...suite.results.map((result) => result.ops));
        const baselineOps = getBaselineOps(suite.results);
        const byEngine = new Map(
          suite.results.map((result) => [result.engine, result] as const),
        );

        return {
          id: suite.id,
          title: formatTitle(suite.name),
          maxOps,
          baselineOps,
          byEngine,
        };
      }),
    [],
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-1.5 text-left">
        <thead>
          <tr>
            <th className="w-28 px-2 py-1 text-xs font-medium text-fd-foreground/70">
              Engine
            </th>
            {suiteMeta.map((suite) => (
              <th
                key={suite.id}
                className="px-2 py-1 text-xs font-medium text-fd-foreground/70"
              >
                {suite.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {benchmarkEngines.map((engine) => {
            const isZbsearch = engine === 'ZBSearch';
            const dimmed = activeEngine !== null && activeEngine !== engine;
            const highlighted = activeEngine === engine;

            return (
              <tr
                key={engine}
                className={cn(
                  'transition-opacity',
                  dimmed && 'opacity-35',
                  highlighted && 'opacity-100',
                )}
                onMouseEnter={() => onEngineHover(engine)}
                onMouseLeave={() => onEngineHover(null)}
              >
                <th
                  scope="row"
                  className={cn(
                    'rounded-lg px-2 py-2 text-xs font-medium text-fd-foreground',
                    isZbsearch && 'font-semibold',
                  )}
                >
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: engineColors[engine] }}
                    />
                    {engine}
                  </span>
                </th>

                {suiteMeta.map((suite) => {
                  const result = suite.byEngine.get(engine);
                  if (!result) {
                    return (
                      <td key={suite.id} className="rounded-lg bg-fd-muted/20 px-3 py-3">
                        <span className="text-xs text-fd-muted-foreground">—</span>
                      </td>
                    );
                  }

                  const fillRatio = getCellIntensity(result.ops, suite.maxOps);

                  return (
                    <td key={suite.id} className="p-0">
                      <div
                        className={cn(
                          'rounded-lg border bg-fd-background px-3 py-3 transition-colors',
                          isZbsearch
                            ? 'border-fd-primary/35 bg-fd-primary/8'
                            : 'border-fd-border',
                          highlighted && 'border-fd-primary/30 ring-1 ring-fd-primary/15',
                        )}
                      >
                        <div>
                          <p className="text-base font-semibold tabular-nums tracking-tight text-fd-foreground sm:text-lg">
                            {formatOps(result.ops)}
                            <span className="ml-1 text-[10px] font-normal text-fd-foreground/55">
                              ops/s
                            </span>
                          </p>
                          <p
                            className={cn(
                              'mt-0.5 text-xs tabular-nums',
                              isZbsearch ? 'font-medium text-fd-primary' : 'text-fd-foreground/65',
                            )}
                          >
                            {formatSpeedRatio(result.ops, suite.baselineOps)}
                          </p>
                        </div>

                        <div
                          aria-hidden
                          className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-fd-muted"
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${fillRatio * 100}%`,
                              backgroundColor: engineColors[engine],
                            }}
                          />
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RelativeTrendLines({
  activeEngine,
  onEngineHover,
}: {
  activeEngine: BenchmarkEngine | null;
  onEngineHover: (engine: BenchmarkEngine | null) => void;
}) {
  const points = useMemo(() => {
    return benchmarkEngines.map((engine) => {
      const values = benchmarkSuites.map((suite) => {
        const result = suite.results.find((entry) => entry.engine === engine);
        const baseline = getBaselineOps(suite.results);
        return result ? (result.ops / baseline) * 100 : 0;
      });

      return { engine, values };
    });
  }, []);

  const width = 320;
  const height = 120;
  const padding = { top: 12, right: 12, bottom: 24, left: 36 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const xStep = chartWidth / Math.max(benchmarkSuites.length - 1, 1);

  return (
    <div className="rounded-2xl border border-fd-border bg-fd-card p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-fd-foreground">Relative to ZBSearch</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-fd-foreground/65">
          Each point is that engine&apos;s throughput as a percentage of ZBSearch in the same
          workload. 100% means tied for first.
        </p>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mx-auto w-full max-w-md text-fd-foreground"
        role="img"
        aria-label="Relative benchmark performance lines compared to ZBSearch"
      >
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = padding.top + chartHeight - (tick / 100) * chartHeight;

          return (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                className="stroke-fd-border"
                strokeDasharray={tick === 100 ? '0' : '3 4'}
                strokeWidth={1}
              />
              <text
                x={padding.left - 8}
                y={y + 3}
                textAnchor="end"
                className="fill-fd-foreground/75 text-[10px]"
              >
                {tick}%
              </text>
            </g>
          );
        })}

        {['Plain', 'Filters', 'Complex'].map((label, index) => {
          const x = padding.left + index * xStep;

          return (
            <text
              key={label}
              x={x}
              y={height - 4}
              textAnchor="middle"
              className="fill-fd-foreground/75 text-[10px]"
            >
              {label}
            </text>
          );
        })}

        {points.map(({ engine, values }) => {
          const dimmed = activeEngine !== null && activeEngine !== engine;
          const highlighted = activeEngine === engine;
          const path = values
            .map((value, index) => {
              const x = padding.left + index * xStep;
              const y = padding.top + chartHeight - (Math.min(value, 100) / 100) * chartHeight;
              return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
            })
            .join(' ');

          return (
            <g
              key={engine}
              className={cn('transition-opacity', dimmed && 'opacity-25', highlighted && 'opacity-100')}
              onMouseEnter={() => onEngineHover(engine)}
              onMouseLeave={() => onEngineHover(null)}
            >
              <path
                d={path}
                fill="none"
                stroke={engineColors[engine]}
                strokeWidth={engine === 'ZBSearch' ? 2.5 : 1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {values.map((value, index) => {
                const x = padding.left + index * xStep;
                const y =
                  padding.top + chartHeight - (Math.min(value, 100) / 100) * chartHeight;

                return (
                  <circle
                    key={`${engine}-${index}`}
                    cx={x}
                    cy={y}
                    r={engine === 'ZBSearch' ? 3.5 : 3}
                    fill={engineColors[engine]}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function BenchmarkCharts() {
  const [activeEngine, setActiveEngine] = useState<BenchmarkEngine | null>(null);
  const benchmarkDate = benchmarkSuites[0]?.date.slice(0, 10);

  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-14">
      <div className="rounded-2xl border border-fd-border bg-fd-card/80 p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-center gap-3">
          {benchmarkEngines.map((engine) => (
            <button
              key={engine}
              type="button"
              onMouseEnter={() => setActiveEngine(engine)}
              onMouseLeave={() => setActiveEngine(null)}
              onFocus={() => setActiveEngine(engine)}
              onBlur={() => setActiveEngine(null)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border border-fd-border bg-fd-background px-2.5 py-1 text-xs text-fd-foreground transition-opacity',
                activeEngine !== null && activeEngine !== engine && 'opacity-40',
              )}
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: engineColors[engine] }}
              />
              {engine}
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <BenchmarkMatrix activeEngine={activeEngine} onEngineHover={setActiveEngine} />
          <RelativeTrendLines activeEngine={activeEngine} onEngineHover={setActiveEngine} />
        </div>

        <p className="mt-5 text-center text-xs leading-relaxed text-fd-foreground/65">
          Measured {benchmarkDate} with benny on Node.js. Throughput shown in ops/s; cell shading
          and speed ratios are relative to the fastest engine in each workload.{' '}
          <a
            href="/docs/zbsearch/vs-orama"
            className="font-medium text-fd-foreground underline underline-offset-2 hover:text-fd-primary"
          >
            See methodology
          </a>
        </p>
      </div>
    </section>
  );
}
