'use client'

import type { EncoderStatus } from '@/lib/encoder'
import type { ArticleDB, EngineStats } from '@/lib/engine'
import { MODE_LABELS } from '@/lib/engine'
import type { Mode, ModeResult, Settings, View } from '@/lib/types'
import { BenchmarkPanel } from './benchmark-panel'
import { EncoderPanel } from './encoder-panel'
import { IndexPanel } from './index-panel'
import { QueryInspector } from './query-inspector'
import { TuningPanel } from './tuning-panel'
import { MODE_COLOR, cx } from './ui'

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-console-muted">{label}</span>
      <span className={cx('font-mono text-[11.5px] tabular-nums', accent ?? 'text-console-ink')}>{value}</span>
    </span>
  )
}

/**
 * The docked strip along the bottom, and the drawer behind it.
 *
 * Same idea as the ecommerce demo's console: the page above it is an ordinary help center
 * that never mentions cosines, and everything that explains how it works lives down here.
 */
export function SearchConsole({
  open,
  onOpen,
  view,
  db,
  stats,
  vectorBytes,
  result,
  encoderModel,
  encoderStatus,
  encodeMs,
  encodeCached,
  onWarm,
  settings,
  onSettings
}: {
  open: boolean
  onOpen: (open: boolean) => void
  view: View
  db: ArticleDB
  stats: EngineStats
  vectorBytes: number
  /** The result to inspect: the active mode's, or hybrid's while comparing. */
  result: ModeResult | null
  encoderModel: string
  encoderStatus: EncoderStatus
  encodeMs: number | null
  encodeCached: boolean
  onWarm: () => void
  settings: Settings
  onSettings: (settings: Settings) => void
}) {
  const mode: Mode = view === 'compare' ? 'hybrid' : view

  return (
    <div className="sticky bottom-0 z-20 mt-10 bg-console text-console-ink">
      {open ? (
        <div className="max-h-[62vh] overflow-y-auto border-b border-console-line">
          <div className="mx-auto grid max-w-[1180px] gap-3 px-5 py-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-3">
              <EncoderPanel
                model={encoderModel}
                status={encoderStatus}
                lastMs={encodeMs}
                lastCached={encodeCached}
                onWarm={onWarm}
              />
              <IndexPanel stats={stats} vectorBytes={vectorBytes} />
              <BenchmarkPanel db={db} settings={settings} />
            </div>

            <TuningPanel view={view} settings={settings} onChange={onSettings} />

            {result ? (
              <QueryInspector mode={mode} params={result.params} elapsed={result.elapsed} />
            ) : (
              <div className="rounded-lg border border-console-line p-3 text-[11.5px] text-console-muted">
                Search for something to inspect the call behind it.
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex max-w-[1180px] items-center gap-5 px-5 py-2.5">
        <button
          type="button"
          onClick={() => onOpen(!open)}
          className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-console-muted transition-colors hover:text-console-ink"
          aria-expanded={open}
        >
          <span className={cx('transition-transform', open && 'rotate-180')} aria-hidden>
            ▲
          </span>
          search console
        </button>

        <span className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1">
          <Stat
            label="mode"
            value={view === 'compare' ? 'compare' : MODE_LABELS[mode].toLowerCase()}
            accent={MODE_COLOR[mode].text}
          />
          {result ? (
            <>
              <Stat label="hits" value={String(result.count)} />
              <Stat label="search" value={result.elapsed} />
            </>
          ) : null}
          <Stat
            label="encode"
            value={
              encoderStatus.state === 'loading'
                ? `${encoderStatus.total ? Math.round((encoderStatus.received / encoderStatus.total) * 100) : 0}%`
                : encodeMs === null
                  ? '—'
                  : encodeCached
                    ? 'cached'
                    : `${encodeMs.toFixed(0)}ms`
            }
            accent={MODE_COLOR.vector.text}
          />
        </span>
      </div>
    </div>
  )
}
