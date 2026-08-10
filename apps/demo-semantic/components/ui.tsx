'use client'

import type { ReactNode } from 'react'
import type { Mode } from '@/lib/types'

export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ')
}

/*
 * Each mode owns a colour and keeps it in every context it appears in — the switch, a
 * score bar, a compare column, a console readout. These are the only place the mapping is
 * written down.
 */
export const MODE_COLOR: Record<Mode, { text: string; bg: string; border: string; ring: string }> = {
  fulltext: {
    text: 'text-lexical',
    bg: 'bg-lexical',
    border: 'border-lexical',
    ring: 'ring-lexical',
  },
  vector: {
    text: 'text-vector',
    bg: 'bg-vector',
    border: 'border-vector',
    ring: 'ring-vector',
  },
  hybrid: {
    text: 'text-hybrid',
    bg: 'bg-hybrid',
    border: 'border-hybrid',
    ring: 'ring-hybrid',
  },
}

/*
 * Everything below lives on the dark console surface in both themes, and is the only part
 * of the app that uses mono type.
 */

export function Panel({
  title,
  hint,
  action,
  children,
}: {
  title: string
  hint?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-console-line">
      <header className="flex items-baseline justify-between gap-3 border-b border-console-line px-3 py-2">
        <h3 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-console-muted">{title}</h3>
        {action}
      </header>
      {hint ? (
        <p className="border-b border-console-line px-3 py-2 text-[11.5px] leading-relaxed text-console-muted">
          {hint}
        </p>
      ) : null}
      <div className="space-y-3 p-3">{children}</div>
    </section>
  )
}

export function ConsoleButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-mono text-[10px] uppercase tracking-[0.1em] text-console-muted transition-colors hover:text-console-ink disabled:opacity-50"
    >
      {children}
    </button>
  )
}

export function Field({ label, value, children }: { label: string; value?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-console-ink">{label}</span>
        {value === undefined ? null : <span className="font-mono text-[11px] text-console-muted">{value}</span>}
      </span>
      {children}
    </label>
  )
}

export function Slider({
  min,
  max,
  step,
  value,
  onChange,
  accent,
}: {
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
  /** Drives the thumb colour, which is `currentColor` in the stylesheet. */
  accent?: string
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={event => onChange(Number(event.target.value))}
      className={cx('cursor-pointer', accent ?? 'text-console-ink')}
    />
  )
}

export function Readout({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-console-muted">{label}</div>
      <div className="mt-0.5 font-mono text-[13px] text-console-ink">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-console-muted">{hint}</div> : null}
    </div>
  )
}
