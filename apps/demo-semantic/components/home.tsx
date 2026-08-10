'use client'

import type { ExampleQuery } from '@/lib/corpus'
import type { Hit } from '@/lib/types'
import { cx } from './ui'

const AREA_BLURBS: Record<string, string> = {
  Account: 'Signing in, two-factor, passkeys and profile',
  Billing: 'Invoices, cards, plans, seats and refunds',
  Workspaces: 'Members, roles, ownership and permissions',
  Documents: 'Editing, history, sharing and recovery',
  Search: 'Indexing, ranking and search operators',
  Integrations: 'Webhooks, Slack, GitHub and automation',
  'Developer API': 'Tokens, rate limits, pagination and SDKs',
  Mobile: 'The phone and tablet apps',
  Desktop: 'The desktop client and deployment',
  Security: 'SSO, SCIM, device trust and compliance',
  Data: 'Export, retention, backups and privacy',
}

/**
 * The help center home.
 *
 * Real support sites open with the questions people actually arrive with, and the curated
 * queries from `data/queries.json` are exactly that — so they lead, as a plain list of
 * links rather than as a wall of chips. Picking one runs it, which is also how the demo
 * gets its point across without anybody having to be told what to type.
 */
export function Home({
  examples,
  popular,
  areaCounts,
  onAsk,
  onArea,
  onOpen,
}: {
  examples: ExampleQuery[]
  popular: Hit[]
  areaCounts: { area: string; count: number }[]
  onAsk: (term: string) => void
  onArea: (area: string) => void
  onOpen: (id: string) => void
}) {
  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">How can we help?</h1>
        <p className="mt-1 text-[13.5px] text-ink-muted">
          150 articles, searched in your browser. Describe the problem however you like — the search
          understands more than the words you type.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-semibold text-ink">Common questions</h2>
        <ul className="grid gap-x-8 sm:grid-cols-2">
          {examples.slice(0, 10).map(example => (
            <li key={example.term}>
              <button
                type="button"
                onClick={() => onAsk(example.term)}
                className="group flex w-full items-baseline gap-2 border-b border-line-soft py-2 text-left"
              >
                <span className="text-[13.5px] text-ink-muted transition-colors group-hover:text-accent-ink group-hover:underline group-hover:underline-offset-2">
                  {example.term}
                </span>
                <span
                  aria-hidden
                  className="ml-auto shrink-0 text-[13px] text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent-ink"
                >
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-semibold text-ink">Browse by area</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {areaCounts.map(({ area, count }) => (
            <button
              key={area}
              type="button"
              onClick={() => onArea(area)}
              className={cx(
                'rounded-xl border border-line bg-card p-3.5 text-left transition-colors hover:border-ink-faint',
                // A button centres its content in the box; grid rows stretch these to a
                // common height, so without this the short blurbs float mid-card.
                'flex flex-col justify-start'
              )}
            >
              <div className="flex w-full items-baseline justify-between gap-2">
                <span className="text-[13.5px] font-semibold text-ink">{area}</span>
                <span className="font-mono text-[10.5px] tabular-nums text-ink-faint">{count}</span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">{AREA_BLURBS[area] ?? ''}</p>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-[13px] font-semibold text-ink">Most read</h2>
        <ul className="divide-y divide-line-soft">
          {popular.map((hit, index) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => onOpen(hit.id)}
                className="group flex w-full items-baseline gap-3 py-2.5 text-left"
              >
                <span className="w-4 font-mono text-[11px] tabular-nums text-ink-faint">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-ink transition-colors group-hover:text-accent-ink group-hover:underline group-hover:underline-offset-2">
                    {hit.document.title}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-faint">
                    {hit.document.area}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ink-faint">
                  {hit.document.views.toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
