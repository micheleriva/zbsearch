'use client';

import { cn } from '@/lib/cn';
import { benchmarkSuites, type BenchmarkEngine } from '@/lib/benchmarks/data';
import {
  averageQualityScores,
  searchQualityDatasets,
  type QualityEngineKey,
} from '@/lib/benchmarks/quality-data';
import { useState } from 'react';

const qualityKeyByEngine: Record<BenchmarkEngine, QualityEngineKey> = {
  'ZBSearch (BM25)': 'zbsearch-bm25',
  'ZBSearch (QPS)': 'zbsearch-qps',
  'ZBSearch (PT15)': 'zbsearch-pt15',
  Orama: 'orama',
  MiniSearch: 'minisearch',
  FlexSearch: 'flexsearch',
  Lunr: 'lunr',
  'Fuse.js': 'fusejs',
};

const labelOffsets: Record<BenchmarkEngine, { x: number; y: number; anchor: 'start' | 'end' }> = {
  'ZBSearch (BM25)': { x: 8, y: -10, anchor: 'start' },
  'ZBSearch (QPS)': { x: -8, y: 16, anchor: 'end' },
  'ZBSearch (PT15)': { x: 8, y: -10, anchor: 'start' },
  Orama: { x: -8, y: -10, anchor: 'end' },
  MiniSearch: { x: 8, y: 16, anchor: 'start' },
  FlexSearch: { x: 8, y: -10, anchor: 'start' },
  Lunr: { x: -8, y: 16, anchor: 'end' },
  'Fuse.js': { x: 8, y: -10, anchor: 'start' },
};

function formatTitle(name: string): string {
  return name
    .replace(/^search with /, '')
    .replace(/^plain search \(all terms\)$/, 'plain search')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatOps(value: number): string {
  if (value >= 100_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return Math.round(value).toLocaleString('en-US');
}

export function QualitySpeedChart() {
  const [activeSuiteId, setActiveSuiteId] = useState(benchmarkSuites[0].id);
  const [activeEngine, setActiveEngine] = useState<BenchmarkEngine | null>(null);
  const activeSuite =
    benchmarkSuites.find((suite) => suite.id === activeSuiteId) ?? benchmarkSuites[0];
  const qualityScores = averageQualityScores(searchQualityDatasets);

  const points = activeSuite.results.map((result) => ({
    engine: result.engine,
    quality: qualityScores[qualityKeyByEngine[result.engine]].ndcg10,
    ops: result.ops,
  }));
  const qualityWinner = points.reduce((best, point) =>
    point.quality > best.quality ? point : best,
  );

  const frontier = points.filter(
    (point) =>
      !points.some(
        (other) =>
          other !== point &&
          other.quality >= point.quality &&
          other.ops >= point.ops &&
          (other.quality > point.quality || other.ops > point.ops),
      ),
  );

  const width = 760;
  const height = 390;
  const padding = { top: 30, right: 90, bottom: 56, left: 68 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxQuality = 0.5;
  const minLogOps = 1;
  const maxLogOps = 6;
  const x = (quality: number) => padding.left + (quality / maxQuality) * chartWidth;
  const y = (ops: number) =>
    padding.top +
    chartHeight -
    ((Math.log10(Math.max(ops, 10)) - minLogOps) / (maxLogOps - minLogOps)) * chartHeight;

  const frontierPath = [...frontier]
    .sort((a, b) => a.quality - b.quality)
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.quality)} ${y(point.ops)}`)
    .join(' ');

  return (
    <section
      id="quality-speed"
      className="scroll-mt-24 rounded-2xl border border-fd-border bg-fd-card p-4 sm:p-6"
    >
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight text-fd-foreground">
          <a href="#quality-speed" className="group">
            Quality vs speed
            <span
              aria-hidden
              className="ml-2 text-fd-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              #
            </span>
          </a>
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-fd-muted-foreground">
          Macro-average BEIR nDCG@10 against Node.js throughput. Up and to the right is better;
          throughput uses a logarithmic scale.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {benchmarkSuites.map((suite) => (
          <button
            key={suite.id}
            type="button"
            onClick={() => setActiveSuiteId(suite.id)}
            className={cn(
              'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
              activeSuite.id === suite.id
                ? 'border-fd-primary/40 bg-fd-primary/10 text-fd-foreground'
                : 'border-fd-border bg-fd-background text-fd-muted-foreground hover:text-fd-foreground',
            )}
          >
            {formatTitle(suite.name)}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-[620px] text-fd-foreground"
          role="img"
          aria-label={`Search quality versus ${formatTitle(activeSuite.name)} throughput`}
        >
          {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((tick) => {
            const tickX = x(tick);
            return (
              <g key={tick}>
                <line
                  x1={tickX}
                  x2={tickX}
                  y1={padding.top}
                  y2={height - padding.bottom}
                  className="stroke-fd-border"
                  strokeWidth={1}
                />
                <text
                  x={tickX}
                  y={height - padding.bottom + 22}
                  textAnchor="middle"
                  className="fill-fd-muted-foreground font-mono text-[10px] tabular-nums"
                >
                  {tick.toFixed(1)}
                </text>
              </g>
            );
          })}

          {[10, 100, 1000, 10_000, 100_000, 1_000_000].map((tick) => {
            const tickY = y(tick);
            return (
              <g key={tick}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={tickY}
                  y2={tickY}
                  className="stroke-fd-border"
                  strokeWidth={1}
                />
                <text
                  x={padding.left - 10}
                  y={tickY + 3}
                  textAnchor="end"
                  className="fill-fd-muted-foreground font-mono text-[10px] tabular-nums"
                >
                  {formatOps(tick)}
                </text>
              </g>
            );
          })}

          <text
            x={padding.left + chartWidth / 2}
            y={height - 8}
            textAnchor="middle"
            className="fill-fd-muted-foreground font-mono text-[9px] uppercase tracking-[0.12em]"
          >
            Search quality · macro nDCG@10 →
          </text>
          <text
            x={14}
            y={padding.top + chartHeight / 2}
            textAnchor="middle"
            transform={`rotate(-90 14 ${padding.top + chartHeight / 2})`}
            className="fill-fd-muted-foreground font-mono text-[9px] uppercase tracking-[0.12em]"
          >
            Throughput · ops/s →
          </text>

          {frontierPath && (
            <path
              d={frontierPath}
              fill="none"
              className="stroke-chart-subject"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              opacity={0.55}
            />
          )}

          {points.map((point) => {
            const dimmed = activeEngine !== null && activeEngine !== point.engine;
            const isZbsearch = point.engine.startsWith('ZBSearch');
            const isQualityWinner = point === qualityWinner;
            const onFrontier = frontier.includes(point);
            const offset = labelOffsets[point.engine];

            return (
              <g
                key={point.engine}
                tabIndex={0}
                role="button"
                aria-label={`${point.engine}: ${point.quality.toFixed(3)} nDCG at ${formatOps(point.ops)} operations per second`}
                className={cn(
                  'cursor-default outline-none transition-opacity',
                  dimmed && 'opacity-25',
                )}
                onMouseEnter={() => setActiveEngine(point.engine)}
                onMouseLeave={() => setActiveEngine(null)}
                onFocus={() => setActiveEngine(point.engine)}
                onBlur={() => setActiveEngine(null)}
              >
                {isZbsearch && (
                  <circle
                    cx={x(point.quality)}
                    cy={y(point.ops)}
                    r={isQualityWinner ? 16 : 10}
                    className="fill-chart-subject"
                    opacity={isQualityWinner ? 0.2 : 0.12}
                  />
                )}
                {onFrontier && (
                  <circle
                    cx={x(point.quality)}
                    cy={y(point.ops)}
                    r={isZbsearch ? 11 : 9}
                    fill="none"
                    className="stroke-chart-subject"
                    strokeWidth={1.5}
                    opacity={0.55}
                  />
                )}
                <circle
                  cx={x(point.quality)}
                  cy={y(point.ops)}
                  r={isZbsearch ? 6 : 5}
                  className={cn(
                    'stroke-fd-card',
                    isZbsearch ? 'fill-chart-subject' : 'fill-chart-other',
                  )}
                  strokeWidth={2}
                />
                {/* Hit target: the mark itself is far below the 24px minimum. */}
                <circle
                  cx={x(point.quality)}
                  cy={y(point.ops)}
                  r={14}
                  fill="transparent"
                />
                <text
                  x={x(point.quality) + offset.x + (isQualityWinner ? 15 : 0)}
                  y={y(point.ops) + offset.y}
                  textAnchor={offset.anchor}
                  className={cn(
                    'text-[10px]',
                    isZbsearch
                      ? 'fill-fd-foreground font-semibold'
                      : 'fill-fd-muted-foreground',
                  )}
                >
                  {point.engine}
                </text>
                {isQualityWinner && (
                  <g
                    aria-hidden
                    transform={`translate(${x(point.quality) + offset.x} ${y(point.ops) + offset.y - 10}) scale(0.11)`}
                    className="fill-chart-subject"
                  >
                    <path d="m90.102 26.301c-4.1016 0-7.3984 3.3008-7.3984 7.3984 0 2.3008 1.1016 4.3984 2.8008 5.8008l-13.203 12.602c-2.5 2.3984-6.6016 1.6016-8-1.6016l-11-24.898c2.8984-1.3008 4.8984-4.1992 4.8984-7.6016 0-4.6016-3.6992-8.3008-8.3008-8.3008-4.6016 0-8.3008 3.6992-8.3008 8.3008 0 3.3984 2 6.3008 4.8984 7.6016l-11 24.898c-1.3984 3.1992-5.5 4-8 1.6016l-12.895-12.602c1.6992-1.3984 2.8008-3.5 2.8008-5.8008 0-4.1016-3.3008-7.3984-7.3984-7.3984-4.1016 0-7.3984 3.3008-7.3984 7.3984 0 4.1016 3.3008 7.3984 7.3984 7.3984h0.30078l7.5 31.898c0.30078 1.1992 1.3008 2 2.5 2l29.695 0.003906h29.801c1.1992 0 2.1992-0.80078 2.5-2l7.5-31.898h0.30078c4.1016 0 7.3984-3.3008 7.3984-7.3984 0-4.1016-3.3008-7.4023-7.3984-7.4023z" />
                    <path d="m79.199 80.801h-58.398c-1.3984 0-2.6016 1.1992-2.6016 2.6016v4.3008c0 1.3984 1.1992 2.6016 2.6016 2.6016l29.199-0.003907h29.199c1.3984 0 2.6016-1.1992 2.6016-2.6016v-4.3008c0-1.5-1.1016-2.5977-2.6016-2.5977z" />
                  </g>
                )}
                <title>{`${point.engine} · ${point.quality.toFixed(3)} nDCG@10 · ${formatOps(point.ops)} ops/s`}</title>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-fd-border pt-3 text-xs text-fd-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="size-2 rounded-full bg-chart-subject" />
          ZBSearch
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-2 rounded-full bg-chart-other" />
          Other engines
        </span>
        <span>Dashed line and rings mark the Pareto frontier: no other engine is both faster and better.</span>
        <span>Quality and throughput use different benchmark corpora; compare the tradeoff, not absolute latency.</span>
      </div>
    </section>
  );
}
