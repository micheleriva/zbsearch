'use client'

import { useRef, useState } from 'react'
import { Check, Download } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ChartLegend } from '@/components/benchmarks/legend'

export type BenchChartRow = {
  /** Engine or configuration name, e.g. "ZBSearch 4.0.0". */
  label: string
  /** Raw numeric value; bar length is proportional to it. */
  value: number
  /** Human-readable value, e.g. "83.98k ops/s" or "2.88 MB". */
  display: string
  /** Subject rows render in the ZBSearch accent colour. */
  subject?: boolean
}

type EngineMark = { icon: string; rounded?: 'full' | 'sm' } | { initial: string; bg: string }

/**
 * Identity badges for engine rows: real logos where one exists at 16px (Lunr
 * has none), otherwise an initial on a stable per-engine color (validated for
 * both surfaces; the adjacent name text carries identity, never the color
 * alone). Rows that name a workload rather than an engine keep the
 * subject/other dot.
 */
const ENGINE_MARKS: Array<{ pattern: RegExp; mark: EngineMark }> = [
  { pattern: /zbsearch|insertmultiple/i, mark: { icon: '/icons/zbsearch.svg' } },
  // The Orama avatar has an opaque dark background, so it renders as a disc.
  { pattern: /orama/i, mark: { icon: '/icons/orama.png', rounded: 'full' } },
  { pattern: /lunr/i, mark: { initial: 'L', bg: '#0284c7' } },
  { pattern: /minisearch/i, mark: { icon: '/icons/minisearch.svg' } },
  // Opaque square tile; the X's tips reach the edges, so a full circle would clip them.
  { pattern: /flexsearch/i, mark: { icon: '/icons/flexsearch.png', rounded: 'sm' } },
  { pattern: /fuse/i, mark: { icon: '/icons/fuse.png' } }
]

function engineMark(label: string): EngineMark | undefined {
  return ENGINE_MARKS.find((entry) => entry.pattern.test(label))?.mark
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Static horizontal bar chart for MDX (blog) content. Same visual language as
 * the interactive benchmark charts: one accent hue for the subject, gray for
 * everything else, every bar direct-labelled so colour never carries identity.
 */
export function BenchChart({
  title,
  note,
  better = 'higher',
  ratioLabel,
  showRatio = true,
  showLegend = true,
  rows
}: {
  title: string
  /** Methodology footnote rendered under the bars. */
  note?: string
  /** Whether a longer bar is the winner ("higher", ops/s) or the loser ("lower", latency/bytes). */
  better?: 'higher' | 'lower'
  /** Word used for non-winning rows, e.g. "slower", "larger". Defaults per `better`. */
  ratioLabel?: string
  /** Hide the per-row ratio line (for charts whose display value is already a ratio). */
  showRatio?: boolean
  /** Hide the subject/other legend (for single-engine or delta charts). */
  showLegend?: boolean
  rows: BenchChartRow[]
}) {
  const figureRef = useRef<HTMLElement>(null)
  const [exporting, setExporting] = useState<'idle' | 'busy' | 'done'>('idle')

  const max = Math.max(...rows.map((row) => row.value))
  const winnerValue =
    better === 'higher' ? max : Math.min(...rows.map((row) => row.value))
  const suffix = ratioLabel ?? (better === 'higher' ? 'slower' : 'larger')

  function ratioText(value: number): string {
    if (value === winnerValue) return 'Best'
    const ratio = better === 'higher' ? winnerValue / value : value / winnerValue
    return `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× ${suffix}`
  }

  async function downloadPng() {
    const node = figureRef.current
    if (!node || exporting === 'busy') return

    setExporting('busy')
    try {
      // Loaded on click so readers who never export don't pay for the library.
      const { toPng } = await import('html-to-image')
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        // The figure's `my-8` stays on the capture clone while the canvas is
        // sized without it, shifting the render down and clipping the bottom.
        style: { margin: '0' },
        filter: (child) => !(child instanceof Element && child.hasAttribute('data-export-exclude'))
      })

      const link = document.createElement('a')
      link.download = `${slugify(title) || 'chart'}.png`
      link.href = dataUrl
      link.click()

      setExporting('done')
      setTimeout(() => setExporting('idle'), 1500)
    } catch (error) {
      console.error('[bench-chart] PNG export failed', error)
      setExporting('idle')
    }
  }

  return (
    <figure
      ref={figureRef}
      className="group not-prose relative my-8 rounded-2xl border border-fd-border bg-fd-card p-4 sm:p-5"
    >
      <button
        type="button"
        data-export-exclude
        onClick={downloadPng}
        aria-label={`Download "${title}" as PNG`}
        title="Download as PNG"
        className={cn(
          'absolute right-3 top-3 rounded-md border border-fd-border bg-fd-background p-1.5 text-fd-muted-foreground transition-opacity hover:text-fd-foreground',
          'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
          exporting === 'busy' && 'cursor-wait opacity-100',
          exporting === 'done' && 'opacity-100 text-fd-foreground'
        )}
      >
        {exporting === 'done' ? <Check className="size-3.5" /> : <Download className="size-3.5" />}
      </button>

      <figcaption className="mb-4 pr-10 text-sm font-semibold tracking-tight text-fd-foreground">{title}</figcaption>

      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className={cn(
              'grid grid-cols-[minmax(7.5rem,9.5rem)_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2',
              row.subject ? 'border-fd-primary/25 bg-fd-primary/5' : 'border-fd-border bg-fd-background'
            )}
          >
            <span className="inline-flex items-center gap-2 text-xs font-medium text-fd-foreground">
              <RowMark label={row.label} subject={row.subject} />
              {row.label}
            </span>

            <div className="h-2.5 overflow-hidden rounded-xs bg-fd-muted">
              <div
                className={cn('h-full rounded-xs', row.subject ? 'bg-chart-subject' : 'bg-chart-other')}
                style={{ width: `${(row.value / max) * 100}%` }}
              />
            </div>

            <div className="min-w-[6.5rem] text-right">
              <p className="text-sm font-semibold tabular-nums text-fd-foreground">{row.display}</p>
              {showRatio && (
                <p className="text-[10px] tabular-nums text-fd-muted-foreground">{ratioText(row.value)}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {showLegend && <ChartLegend className="mt-4 border-t border-fd-border pt-3" />}

      {note && <p className="mt-3 text-xs leading-relaxed text-fd-muted-foreground">{note}</p>}
    </figure>
  )
}

function RowMark({ label, subject }: { label: string; subject?: boolean }) {
  const mark = engineMark(label)

  if (!mark) {
    return (
      <span
        aria-hidden
        className={cn('size-2 shrink-0 rounded-full', subject ? 'bg-chart-subject' : 'bg-chart-other')}
      />
    )
  }

  if ('icon' in mark) {
    return (
      <img
        src={mark.icon}
        alt=""
        className={cn(
          'size-4 shrink-0 object-contain',
          mark.rounded === 'full' && 'rounded-full',
          mark.rounded === 'sm' && 'rounded-[3px]'
        )}
      />
    )
  }

  return (
    <span
      aria-hidden
      style={{ backgroundColor: mark.bg }}
      className="flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none text-white"
    >
      {mark.initial}
    </span>
  )
}
