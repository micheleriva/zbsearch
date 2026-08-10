import { cn } from '@/lib/cn'

/**
 * Two-slot chart legend. Benchmark charts encode one thing with colour - is this
 * mark the subject or one of the others - because the all-pairs separation gate
 * rules out giving eight engines eight hues. Every mark is also direct-labelled,
 * so the legend confirms identity rather than carrying it.
 */
export function ChartLegend({
  subject = 'ZBSearch',
  other = 'Other engines',
  className
}: {
  subject?: string
  other?: string
  className?: string
}) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fd-muted-foreground', className)}>
      <li className="inline-flex items-center gap-2">
        <span aria-hidden className="size-2 rounded-full bg-chart-subject" />
        {subject}
      </li>
      <li className="inline-flex items-center gap-2">
        <span aria-hidden className="size-2 rounded-full bg-chart-other" />
        {other}
      </li>
    </ul>
  )
}
