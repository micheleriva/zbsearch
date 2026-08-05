'use client'

import { useState } from 'react'
import { MODE_LABELS, benchmark, type ArticleDB, type BenchmarkRow } from '@/lib/engine'
import { examples, vectors } from '@/lib/corpus'
import type { Settings } from '@/lib/types'
import { ConsoleButton, MODE_COLOR, Panel, cx } from './ui'

const ROUNDS = 40

export function BenchmarkPanel({ db, settings }: { db: ArticleDB; settings: Settings }) {
  const [rows, setRows] = useState<BenchmarkRow[] | null>(null)
  const [running, setRunning] = useState(false)

  const run = () => {
    setRunning(true)

    // Yield once so the button can repaint before the main thread is tied up.
    requestAnimationFrame(() => {
      setRows(
        benchmark(
          db,
          examples.map(example => example.term),
          vectors.slice(0, examples.length),
          settings,
          ROUNDS
        )
      )
      setRunning(false)
    })
  }

  return (
    <Panel
      title="Throughput"
      hint="Each mode over the same queries, encoding excluded — the vectors are prepared before the clock starts, so this times the index rather than the transformer in front of it."
      action={
        <ConsoleButton onClick={run} disabled={running}>
          {running ? 'running…' : rows ? 'run again' : 'run'}
        </ConsoleButton>
      }
    >
      {rows === null ? (
        <p className="text-[11.5px] text-console-muted">
          {examples.length} queries × {ROUNDS} rounds per mode.
        </p>
      ) : (
        <table className="w-full font-mono text-[11.5px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.1em] text-console-muted">
              <th className="pb-1.5 text-left font-normal">mode</th>
              <th className="pb-1.5 text-right font-normal">mean</th>
              <th className="pb-1.5 text-right font-normal">queries/s</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.mode}>
                <td className={cx('py-0.5', MODE_COLOR[row.mode].text)}>{MODE_LABELS[row.mode]}</td>
                <td className="py-0.5 text-right tabular-nums text-console-ink">
                  {row.mean < 1 ? `${(row.mean * 1000).toFixed(0)}μs` : `${row.mean.toFixed(2)}ms`}
                </td>
                <td className="py-0.5 text-right tabular-nums text-console-ink">
                  {Math.round(row.qps).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rows ? (
        <p className="text-[11px] leading-relaxed text-console-muted">
          Vector search here is exhaustive: every query compares against all {vectors.length} stored vectors.
          That stays fast at this size and is why the flat index is the right choice for a corpus this small.
        </p>
      ) : null}
    </Panel>
  )
}
