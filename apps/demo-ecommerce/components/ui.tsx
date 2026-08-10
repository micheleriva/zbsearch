'use client'

import type { ReactNode } from 'react'

export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ')
}

/*
 * Everything below is console chrome. It lives on the dark console surface in both
 * themes, and is the only place in the app that uses mono type — the storefront itself
 * is plain sans.
 */

export function Panel({
  title,
  hint,
  action,
  children
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
      <div className="p-3">{children}</div>
    </section>
  )
}

export function ConsoleButton({
  children,
  onClick,
  disabled
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
      className="font-mono text-[10px] uppercase tracking-[0.1em] text-console-muted transition-colors hover:text-console-brand disabled:text-console-muted/50"
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
  onChange
}: {
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  )
}

export function Toggle({
  label,
  description,
  checked,
  onChange
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          'mt-0.5 h-[18px] w-[32px] shrink-0 rounded-full border transition-colors',
          checked ? 'border-console-brand bg-console-brand' : 'border-console-line bg-console-line/50'
        )}
      >
        <span
          className={cx(
            'block h-[14px] w-[14px] rounded-full bg-console transition-transform',
            checked ? 'translate-x-[15px]' : 'translate-x-[1px]'
          )}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-[12px] leading-tight text-console-ink">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-[11px] leading-snug text-console-muted">{description}</span>
        ) : null}
      </span>
    </label>
  )
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded border px-1.5 py-[1px] font-mono text-[10px] uppercase tracking-[0.08em]',
        tone === 'brand'
          ? 'border-console-brand/50 bg-console-brand/10 text-console-brand'
          : 'border-console-line text-console-muted'
      )}
    >
      {children}
    </span>
  )
}

export function Stat({
  label,
  value,
  tone,
  title
}: {
  label: string
  value: ReactNode
  tone?: 'brand'
  title?: string
}) {
  return (
    <div className="min-w-0" title={title}>
      <div
        className={cx(
          'truncate font-mono text-[15px] leading-tight tabular-nums',
          tone === 'brand' ? 'text-console-brand' : 'text-console-ink'
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.1em] text-console-muted">{label}</div>
    </div>
  )
}
