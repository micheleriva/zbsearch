import type { Metadata } from 'next'
import Link from 'next/link'
import { LargeIndexCharts } from '@/components/benchmarks/large-index-charts'
import { formatDocs, formatDuration, largeIndexReport, largeIndexSizes } from '@/lib/benchmarks/large-index-data'

export const metadata: Metadata = {
  title: 'Large indexes',
  description:
    'ZBSearch against Orama, FlexSearch, Fuse.js, Lunr and MiniSearch on 20k to 160k passages: indexing time, heap and search latency, with indexing and search timeouts.'
}

const SCRIPT_URL = 'https://github.com/micheleriva/zbsearch/blob/main/benchmarks/large-index-engines.js'

const linkClass = 'font-medium text-fd-foreground underline underline-offset-2 hover:text-fd-primary'

const chipClass =
  'rounded-md border border-fd-border bg-fd-card px-3 py-1.5 text-fd-foreground/70 transition-colors hover:border-fd-primary/30 hover:text-fd-foreground'

export default function LargeIndexesBenchmarksPage() {
  const { machine, config, versions, stores, date } = largeIndexReport
  const engines = [...new Map(largeIndexReport.runs.map((run) => [run.engine, run.label])).entries()]

  const facts = [
    { label: 'Machine', value: `${machine.cpu} × ${machine.cpus}, ${machine.totalMemoryGB} GB RAM` },
    {
      label: 'Runtime',
      value: `Node.js ${machine.node}, ${(config.maxOldSpaceSizeMB / 1024).toFixed(0)} GB heap limit`
    },
    { label: 'Measured', value: date.slice(0, 10) },
    { label: 'Sizes', value: largeIndexSizes.map(formatDocs).join(', ') + ' passages' },
    { label: 'Indexing timeout', value: formatDuration(config.indexTimeoutMs) },
    {
      label: 'Search timeout',
      value: `${formatDuration(config.searchTimeoutMs)} for ${config.queries} queries, ${formatDuration(config.queryTimeoutMs)} per query`
    }
  ]

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-fd-primary/8 blur-3xl" />
      </div>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-16">
        <header className="mb-12 max-w-3xl">
          <p className="mb-3 text-sm text-fd-muted-foreground">
            <Link href="/benchmarks" className="hover:text-fd-foreground">
              ← Benchmarks
            </Link>
          </p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Large indexes</h1>
          <p className="mt-4 text-lg leading-relaxed text-fd-muted-foreground">
            How long each engine takes to index {largeIndexSizes.map(formatDocs).join(', ')} passages, how much memory
            the index holds and how fast it answers, with a time limit on indexing and on search.
          </p>
        </header>

        <div className="mb-10 flex flex-wrap gap-2 text-xs">
          <a href="#results" className={chipClass}>
            Results
          </a>
          <a href="#run" className={chipClass}>
            Run details
          </a>
          <a href="#methodology" className={chipClass}>
            Methodology
          </a>
        </div>

        <LargeIndexCharts />

        <section id="run" className="mt-10 scroll-mt-24 rounded-2xl border border-fd-border bg-fd-card p-4 sm:p-6">
          <h2 className="text-xl font-semibold tracking-tight text-fd-foreground">
            <a href="#run" className="group">
              Run details
              <span
                aria-hidden
                className="ml-2 text-fd-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                #
              </span>
            </a>
          </h2>
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-xs text-fd-muted-foreground">{fact.label}</dt>
                <dd className="mt-0.5 text-fd-foreground">{fact.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 overflow-x-auto rounded-xl border border-fd-border">
            <table className="w-full min-w-[36rem] text-left text-xs">
              <caption className="sr-only">Engine versions and what each engine stores besides its index</caption>
              <thead className="bg-fd-muted/50 text-fd-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Engine
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Version
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Stores besides the index
                  </th>
                </tr>
              </thead>
              <tbody>
                {engines.map(([key, label]) => (
                  <tr key={key} className="border-t border-fd-border">
                    <th scope="row" className="px-3 py-2 font-medium text-fd-foreground">
                      {label}
                    </th>
                    <td className="px-3 py-2 tabular-nums text-fd-muted-foreground">{versions[key] ?? '-'}</td>
                    <td className="px-3 py-2 text-fd-muted-foreground">{(stores[key] ?? '-').replace(/`/g, '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="methodology" className="mt-10 max-w-3xl scroll-mt-24 space-y-4 text-sm leading-relaxed">
          <h2 className="text-xl font-semibold tracking-tight text-fd-foreground">
            <a href="#methodology" className="group">
              Methodology
              <span
                aria-hidden
                className="ml-2 text-fd-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                #
              </span>
            </a>
          </h2>
          <p className="text-fd-muted-foreground">
            The corpus is the synthetic passage set used for ZBSearch&apos;s own large-index work: passages of 150 to
            250 words drawn from a Zipf-distributed vocabulary of 40,000 words, with a 3-word section and a 6-word
            title. Every engine indexes <code>text</code>, <code>section</code> and <code>title</code> as full text,
            with the configuration of the{' '}
            <Link href="/benchmarks#throughput" className={linkClass}>
              throughput benchmarks
            </Link>{' '}
            (English stop words, sort indexes off), and keeps as little of each document as its API allows (see the
            table above).
          </p>
          <p className="text-fd-muted-foreground">
            The query set is {config.queries} queries of 1 to 3 Zipf-sampled words, after {config.warmupQueries} warm-up
            queries. Every engine is asked for the top {config.searchLimit} documents that contain all the query terms,
            one query at a time (the QPS and PT15 plugins do not apply this all-terms threshold and match any term;
            ZBSearch and Orama also match terms as prefixes, their default); QPS is the inverse of the mean latency.
            Heap is <code>heapUsed</code> plus <code>arrayBuffers</code> after indexing and a full garbage collection,
            minus the process baseline, so it counts the index and the stored documents but not the generated corpus.
            RSS, in the table, also counts memory the process has not returned to the operating system, the generated
            corpus included.
          </p>
          <p className="text-fd-muted-foreground">
            ZBSearch (BM25, frozen) is ZBSearch (BM25) followed by{' '}
            <Link href="/docs/zbsearch/usage/freeze" className={linkClass}>
              <code>freeze(db)</code>
            </Link>
            , which compacts the full-text index into immutable segments; the freeze time is part of its indexing time
            and is also shown on its own. The QPS and PT15 plugins keep full documents, because their index components
            do not support <code>store.exclude</code>.
          </p>
          <p className="text-fd-muted-foreground">
            Each engine and size runs in its own Node.js process. The parent process kills it when indexing takes longer
            than {formatDuration(config.indexTimeoutMs)}, when the warm-up and measured queries take longer than{' '}
            {formatDuration(config.searchTimeoutMs)} in total, or when a single query takes longer than{' '}
            {formatDuration(config.queryTimeoutMs)}. The child reports every query as it completes, so a search timeout
            keeps the latencies of the queries that finished. A process that runs out of its heap is reported as out of
            memory.
          </p>
          <p className="text-fd-muted-foreground">
            Run it yourself with <code>pnpm --filter benchmarks benchmark:large-index-engines</code>; the script is{' '}
            <Link href={SCRIPT_URL} className={linkClass}>
              benchmarks/large-index-engines.js
            </Link>
            . Absolute numbers depend heavily on the machine: compare engines within one run.
          </p>
        </section>
      </main>
    </div>
  )
}
