'use client'

import type { EncoderStatus } from '@/lib/encoder'
import { ConsoleButton, Panel, Readout } from './ui'

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function StatusLine({ status }: { status: EncoderStatus }) {
  switch (status.state) {
    case 'cold':
      return <span className="text-console-muted">not loaded</span>

    case 'loading': {
      const percent = status.total > 0 ? Math.round((status.received / status.total) * 100) : 0

      return (
        <span className="text-console-ink">
          downloading {percent}%{' '}
          <span className="text-console-muted">
            ({megabytes(status.received)} of {megabytes(status.total)})
          </span>
        </span>
      )
    }

    case 'ready':
      return (
        <span className="text-console-ink">
          ready on <span className="uppercase">{status.device}</span>
        </span>
      )

    case 'failed':
      return <span className="text-warn">{status.message}</span>
  }
}

/**
 * The one genuinely expensive thing on the page, given its own panel so that its cost is
 * visible rather than hidden behind a spinner.
 */
export function EncoderPanel({
  model,
  status,
  lastMs,
  lastCached,
  onWarm,
}: {
  model: string
  status: EncoderStatus
  /** Encode time for the current query, or null when the mode needed no vector. */
  lastMs: number | null
  lastCached: boolean
  onWarm: () => void
}) {
  return (
    <Panel
      title="Encoder"
      hint="The document vectors ship with the page. Only the query is encoded here, in a Web Worker, so typing never blocks on the model."
      action={
        status.state === 'cold' ? <ConsoleButton onClick={onWarm}>load now</ConsoleButton> : null
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Readout label="model" value={<span className="text-[11px]">{model.split('/').at(-1)}</span>} />
        <Readout label="status" value={<StatusLine status={status} />} />
        <Readout
          label="dimensions"
          value={status.state === 'ready' ? status.dimensions : '—'}
          hint={status.state === 'ready' ? `loaded in ${(status.loadMs / 1000).toFixed(1)}s` : undefined}
        />
        <Readout
          label="last query"
          value={lastMs === null ? '—' : lastCached ? 'cached' : `${lastMs.toFixed(1)}ms`}
          hint={lastCached ? 'already encoded once' : undefined}
        />
      </div>

      {status.state === 'loading' ? (
        <span className="block h-1 w-full overflow-hidden rounded-full bg-console-line">
          <span
            className="block h-full rounded-full bg-vector transition-[width] duration-300"
            style={{ width: `${status.total > 0 ? (status.received / status.total) * 100 : 4}%` }}
          />
        </span>
      ) : null}
    </Panel>
  )
}
