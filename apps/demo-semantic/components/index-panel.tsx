'use client'

import { corpusIsStale } from '@/lib/corpus'
import type { EngineStats } from '@/lib/engine'
import { Panel, Readout } from './ui'

export function IndexPanel({ stats, vectorBytes }: { stats: EngineStats; vectorBytes: number }) {
  return (
    <Panel
      title="Index"
      hint="Built in the browser on page load from a bundled corpus. There is no server and no API call anywhere in this demo."
    >
      <div className="grid grid-cols-2 gap-3">
        <Readout label="documents" value={stats.documents} />
        <Readout label="built in" value={`${stats.indexingMs.toFixed(0)}ms`} />
        <Readout
          label="vectors"
          value={`${stats.documents} × ${stats.dimensions}`}
          hint={`${(vectorBytes / 1024).toFixed(0)} KB as int8`}
        />
        <Readout label="index kind" value="flat" hint="exhaustive cosine, no ANN" />
      </div>

      {corpusIsStale ? (
        <p className="rounded-md border border-warn/40 px-2.5 py-2 text-[11px] leading-relaxed text-warn">
          data/articles.json has changed since the vectors were generated. Semantic results are ranking against the
          previous wording — run <span className="font-mono">pnpm corpus</span> to fix it.
        </p>
      ) : null}
    </Panel>
  )
}
