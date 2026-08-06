import type { Metadata } from 'next';
import Link from 'next/link';
import { BenchmarkCharts } from '@/components/benchmarks/benchmark-charts';
import { QualityCharts } from '@/components/benchmarks/quality-charts';
import { QualitySpeedChart } from '@/components/benchmarks/quality-speed-chart';

export const metadata: Metadata = {
  title: 'Benchmarks',
  description:
    'Interactive ZBSearch benchmark results: BEIR search quality, multilingual tokenization quality, and full-text throughput.',
};

export default function BenchmarksPage() {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-fd-primary/8 blur-3xl" />
      </div>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-16">
        <header className="mb-12 max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Benchmarks</h1>
          <p className="mt-4 text-lg leading-relaxed text-fd-muted-foreground">
            Results come
            from the open{' '}
            <Link
              href="https://github.com/micheleriva/zbsearch/tree/main/benchmarks"
              className="font-medium text-fd-foreground underline underline-offset-2 hover:text-fd-primary"
            >
              benchmarks
            </Link>{' '}
            suite. Re-run locally anytime.
          </p>
        </header>

        <div className="mb-10 flex flex-wrap gap-2 text-xs">
          <a
            href="#search-quality"
            className="rounded-md border border-fd-border bg-fd-card px-3 py-1.5 text-fd-foreground/70 transition-colors hover:border-fd-primary/30 hover:text-fd-foreground"
          >
            Search quality
          </a>
          <a
            href="#quality-speed"
            className="rounded-md border border-fd-border bg-fd-card px-3 py-1.5 text-fd-foreground/70 transition-colors hover:border-fd-primary/30 hover:text-fd-foreground"
          >
            Quality vs speed
          </a>
          <a
            href="#multilingual"
            className="rounded-md border border-fd-border bg-fd-card px-3 py-1.5 text-fd-foreground/70 transition-colors hover:border-fd-primary/30 hover:text-fd-foreground"
          >
            Multilingual
          </a>
          <a
            href="#throughput"
            className="rounded-md border border-fd-border bg-fd-card px-3 py-1.5 text-fd-foreground/70 transition-colors hover:border-fd-primary/30 hover:text-fd-foreground"
          >
            Throughput
          </a>
        </div>

        <QualityCharts between={<QualitySpeedChart />} />

        <div id="throughput" className="mt-10 scroll-mt-24">
          <BenchmarkCharts
            className="mx-0 max-w-none px-0 pb-0"
            title="Search throughput"
            description="Benny ops/s on Node.js across plain search, filters, and complex long-text workloads. Higher is better."
          />
        </div>

        <p className="mt-10 text-sm leading-relaxed text-fd-muted-foreground">
          Methodology and Orama head-to-head notes live in{' '}
          <Link
            href="/docs/zbsearch/vs-orama"
            className="font-medium text-fd-foreground underline underline-offset-2 hover:text-fd-primary"
          >
            ZBSearch vs Orama
          </Link>
          . Cloudflare Worker load-test baselines are in the{' '}
          <Link
            href="/docs/cloudflare/benchmarks"
            className="font-medium text-fd-foreground underline underline-offset-2 hover:text-fd-primary"
          >
            Edge benchmarks
          </Link>{' '}
          docs.
        </p>
      </main>
    </div>
  );
}
