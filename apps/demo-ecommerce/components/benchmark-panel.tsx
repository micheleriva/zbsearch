'use client'

import { useState } from 'react'
import { benchmark, type BenchmarkResult, type CatalogDB } from '@/lib/engine'
import { formatCount, formatMs } from '@/lib/format'
import { ConsoleButton, Panel, Stat } from './ui'

const TERMS = [
  'laptop',
  'iphone 13',
  'rolex',
  'blue shirt',
  'kitchen',
  'perfume',
  'running shoes',
  'samsung galaxy',
  'leather bag',
  'sunglasses',
  'moisturizer',
  'gaming',
  'dell xps',
  'gold earring',
  'motorcycle helmet',
  'cotton dress'
]

const ROUNDS = 250

export function BenchmarkPanel({ db }: { db: CatalogDB }) {
  const [result, setResult] = useState<BenchmarkResult | null>(null)
  const [running, setRunning] = useState(false)

  function run() {
    setRunning(true)

    // Yield once so the button can paint its running state before the loop blocks.
    setTimeout(() => {
      setResult(benchmark(db, TERMS, ROUNDS))
      setRunning(false)
    }, 20)
  }

  return (
    <Panel
      title="Benchmark"
      hint={`Replays ${TERMS.length} realistic queries ${ROUNDS} times each, in this tab, on this machine.`}
      action={
        <ConsoleButton onClick={run} disabled={running}>
          {running ? 'running…' : result ? 'run again' : `run ${formatCount(TERMS.length * ROUNDS)} queries`}
        </ConsoleButton>
      }
    >
      {result ? (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-3.5">
            <Stat label="queries" value={formatCount(result.queries)} />
            <Stat label="queries / sec" value={formatCount(Math.round(result.qps))} tone="brand" />
            <Stat label="mean" value={formatMs(result.mean)} />
            <Stat label="wall clock" value={formatMs(result.totalMs)} />
            <Stat label="p50" value={formatMs(result.p50)} />
            <Stat label="p95" value={formatMs(result.p95)} />
          </div>
          <p className="mt-3 border-t border-console-line pt-2 text-[10.5px] leading-relaxed text-console-muted">
            Browsers clamp <code className="font-mono">performance.now()</code> to about 100μs, so a single query is too
            fast to time directly. Each pass over the {TERMS.length} terms is timed as one sample and divided back down.
          </p>
        </>
      ) : (
        <p className="text-[11.5px] leading-relaxed text-console-muted">
          No network, no server, no worker — the index lives in this page's memory and every query is a synchronous
          function call.
        </p>
      )}
    </Panel>
  )
}
