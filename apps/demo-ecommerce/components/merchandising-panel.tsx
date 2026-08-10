'use client'

import { findProduct } from '@/lib/catalog'
import { merchandisingRules } from '@/lib/pins'
import type { EngineSettings } from '@/lib/types'
import { Panel, Tag, Toggle, cx } from './ui'

export function MerchandisingPanel({
  settings,
  matchedRuleIds,
  onChange,
  onTry
}: {
  settings: EngineSettings
  matchedRuleIds: string[]
  onChange: (next: EngineSettings) => void
  onTry: (term: string) => void
}) {
  return (
    <Panel
      title="Merchandising · insertPin"
      hint="Pinning rules let a merchandiser override relevance for chosen queries. They run after filtering and sorting, so a pinned product always surfaces. Pinned products carry a “Featured” badge in the shop."
    >
      <div className="space-y-3">
        <Toggle
          label="Pinning rules active"
          description={`${merchandisingRules.length} rules registered on the index.`}
          checked={settings.pinningEnabled}
          onChange={(checked) => onChange({ ...settings, pinningEnabled: checked })}
        />

        <ul className="space-y-2 border-t border-console-line pt-3">
          {merchandisingRules.map(({ rule, label, rationale, sample }) => {
            const firing = settings.pinningEnabled && matchedRuleIds.includes(rule.id)

            return (
              <li
                key={rule.id}
                className={cx(
                  'rounded border px-2.5 py-2 transition-colors',
                  firing ? 'border-console-brand/60 bg-console-brand/10' : 'border-console-line'
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-medium text-console-ink">{label}</span>
                  {firing ? <Tag tone="brand">firing</Tag> : null}
                </div>

                <p className="mt-1 text-[11px] leading-snug text-console-muted">{rationale}</p>

                <div className="mt-1.5 space-y-0.5 font-mono text-[10px] leading-relaxed text-console-ink/80">
                  {rule.conditions.map((condition, index) => (
                    <div key={index}>
                      <span className="text-console-muted">{index === 0 ? 'when' : 'and '}</span> {condition.anchoring}{' '}
                      “{condition.pattern}”
                    </div>
                  ))}
                  {rule.consequence.promote.map((promotion) => (
                    <div key={String(promotion.doc_id)}>
                      <span className="text-console-muted">pin </span>
                      {findProduct(String(promotion.doc_id))?.title ?? promotion.doc_id}
                      <span className="text-console-muted"> → #{promotion.position + 1}</span>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => onTry(sample)}
                  className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-console-muted hover:text-console-brand"
                >
                  try “{sample}”
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Panel>
  )
}
