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
  const max = Math.max(...rows.map((row) => row.value))
  const winnerValue =
    better === 'higher' ? max : Math.min(...rows.map((row) => row.value))
  const suffix = ratioLabel ?? (better === 'higher' ? 'slower' : 'larger')

  function ratioText(value: number): string {
    if (value === winnerValue) return 'Best'
    const ratio = better === 'higher' ? winnerValue / value : value / winnerValue
    return `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× ${suffix}`
  }

  return (
    <figure className="not-prose my-8 rounded-2xl border border-fd-border bg-fd-card p-4 sm:p-5">
      <figcaption className="mb-4 text-sm font-semibold tracking-tight text-fd-foreground">{title}</figcaption>

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
              <span
                aria-hidden
                className={cn('size-2 shrink-0 rounded-full', row.subject ? 'bg-chart-subject' : 'bg-chart-other')}
              />
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
