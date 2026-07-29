'use client';

import { cn } from '@/lib/cn';
import {
  benchmarkSuites,
  engineColors,
  type BenchmarkEngine,
} from '@/lib/benchmarks/data';
import { useState } from 'react';

function formatOps(value: number): string {
  if (value >= 10_000) {
    return `${Math.round(value / 1000)}k`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return value.toLocaleString('en-US');
}

function formatTitle(name: string): string {
  return name
    .replace(/^search with /, '')
    .replace(/^plain search \(all terms\)$/, 'plain search')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatSpeedRatio(ops: number, fastest: number): string {
  if (ops >= fastest) {
    return 'Fastest';
  }

  const ratio = fastest / ops;

  if (ratio >= 100) {
    return `${Math.round(ratio).toLocaleString('en-US')}× slower`;
  }

  if (ratio >= 10) {
    return `${Math.round(ratio)}× slower`;
  }

  return `${ratio.toFixed(1)}× slower`;
}

export function BenchmarkCharts({
  title,
  description,
  className,
}: {
  title?: string;
  description?: string;
  className?: string;
} = {}) {
  const [activeSuiteId, setActiveSuiteId] = useState(benchmarkSuites[0].id);
  const [activeEngine, setActiveEngine] = useState<BenchmarkEngine | null>(null);
  const benchmarkDate = benchmarkSuites[0]?.date.slice(0, 10);
  const activeSuite =
    benchmarkSuites.find((suite) => suite.id === activeSuiteId) ?? benchmarkSuites[0];
  const rows = [...activeSuite.results].sort((a, b) => b.ops - a.ops);
  const fastestOps = rows[0]?.ops ?? 1;

  return (
    <section className={cn('mx-auto w-full max-w-6xl px-6 pb-14', className)}>
      <div className="rounded-2xl border border-fd-border bg-fd-card/80 p-4 sm:p-6">
        {(title || description) && (
          <div className="mb-5">
            {title && (
              <h2 className="text-xl font-semibold tracking-tight text-fd-foreground">
                <a href="#throughput" className="group">
                  {title}
                  <span
                    aria-hidden
                    className="ml-2 text-fd-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  >
                    #
                  </span>
                </a>
              </h2>
            )}
            {description && (
              <p className="mt-1 text-sm leading-relaxed text-fd-foreground/65">
                {description}
              </p>
            )}
          </div>
        )}
        <div className="mb-5 flex flex-wrap gap-2">
          {benchmarkSuites.map((suite) => (
            <button
              key={suite.id}
              type="button"
              onClick={() => setActiveSuiteId(suite.id)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                activeSuite.id === suite.id
                  ? 'border-fd-primary/40 bg-fd-primary/10 text-fd-foreground'
                  : 'border-fd-border bg-fd-background text-fd-foreground/70 hover:text-fd-foreground',
              )}
            >
              {formatTitle(suite.name)}
            </button>
          ))}
        </div>

        <div className="space-y-2.5">
          {rows.map((result) => {
            const dimmed = activeEngine !== null && activeEngine !== result.engine;
            const highlighted = activeEngine === result.engine;
            const isZbsearch = result.engine.startsWith('ZBSearch');

            return (
              <button
                key={result.engine}
                type="button"
                onMouseEnter={() => setActiveEngine(result.engine)}
                onMouseLeave={() => setActiveEngine(null)}
                onFocus={() => setActiveEngine(result.engine)}
                onBlur={() => setActiveEngine(null)}
                className={cn(
                  'grid w-full grid-cols-[minmax(8.5rem,10.5rem)_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all',
                  isZbsearch
                    ? 'border-fd-primary/25 bg-fd-primary/5'
                    : 'border-fd-border bg-fd-background',
                  dimmed && 'opacity-35',
                  highlighted && 'ring-1 ring-fd-primary/20',
                )}
              >
                <span className="inline-flex items-center gap-2 text-xs font-medium text-fd-foreground">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: engineColors[result.engine] }}
                  />
                  {result.engine}
                </span>

                <div className="h-2.5 overflow-hidden rounded-full bg-fd-muted">
                  <div
                    className="h-full rounded-full transition-[width]"
                    style={{
                      width: `${(result.ops / fastestOps) * 100}%`,
                      backgroundColor: engineColors[result.engine],
                    }}
                  />
                </div>

                <div className="min-w-[6.5rem] text-right">
                  <p className="text-sm font-semibold tabular-nums text-fd-foreground">
                    {formatOps(result.ops)}
                    <span className="ml-1 text-[10px] font-normal text-fd-foreground/55">
                      ops/s
                    </span>
                  </p>
                  <p className="text-[10px] tabular-nums text-fd-foreground/55">
                    {formatSpeedRatio(result.ops, fastestOps)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <p className="mt-5 text-xs leading-relaxed text-fd-foreground/65">
          Measured {benchmarkDate} with benny on Node.js. Bars and speed ratios are relative to the
          fastest engine in the selected workload.{' '}
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
