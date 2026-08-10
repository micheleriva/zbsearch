'use client'

import type { Boosts, EngineSettings } from '@/lib/types'
import { ConsoleButton, Field, Panel, Slider, Toggle } from './ui'

const BOOST_FIELDS: (keyof Boosts)[] = ['title', 'brand', 'category', 'tags', 'description']

const DEFAULT_BOOSTS: Boosts = { title: 3, brand: 2, category: 1.5, tags: 1.2, description: 1 }

export function BoostPanel({
  settings,
  showScores,
  onChange,
  onShowScores
}: {
  settings: EngineSettings
  showScores: boolean
  onChange: (next: EngineSettings) => void
  onShowScores: (value: boolean) => void
}) {
  return (
    <Panel
      title="Field boosting · boost"
      hint="Each field's match is multiplied by its weight before BM25 ranks the document. Search “leather”, then pull description up."
      action={<ConsoleButton onClick={() => onChange({ ...settings, boosts: DEFAULT_BOOSTS })}>reset</ConsoleButton>}
    >
      <div className="space-y-3">
        {BOOST_FIELDS.map((field) => (
          <Field key={field} label={field} value={`×${settings.boosts[field].toFixed(1)}`}>
            <Slider
              // ZBSearch rejects a boost of 0 — a field can be de-emphasised, not switched off.
              min={0.5}
              max={8}
              step={0.5}
              value={settings.boosts[field]}
              onChange={(value) => onChange({ ...settings, boosts: { ...settings.boosts, [field]: value } })}
            />
          </Field>
        ))}

        <div className="border-t border-console-line pt-3">
          <Toggle
            label="Show BM25 scores"
            description="Print the relevance score ZBSearch assigned on every product card."
            checked={showScores}
            onChange={onShowScores}
          />
        </div>
      </div>
    </Panel>
  )
}

export function MatchingPanel({
  settings,
  onChange
}: {
  settings: EngineSettings
  onChange: (next: EngineSettings) => void
}) {
  return (
    <Panel title="Matching">
      <div className="space-y-3.5">
        <Field
          label="Typo tolerance"
          value={
            settings.exact ? 'off — exact wins' : `${settings.tolerance} edit${settings.tolerance === 1 ? '' : 's'}`
          }
        >
          <Slider
            min={0}
            max={2}
            step={1}
            value={settings.tolerance}
            onChange={(value) => onChange({ ...settings, tolerance: value })}
          />
        </Field>
        <p className="-mt-1 text-[11px] leading-snug text-console-muted">
          Levenshtein distance allowed between the query and an indexed word. Search{' '}
          <code className="font-mono">lether bag</code> and pull this to 0.
        </p>

        <Field label="Threshold" value={settings.threshold.toFixed(2)}>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={settings.threshold}
            onChange={(value) => onChange({ ...settings, threshold: value })}
          />
        </Field>
        <p className="-mt-1 text-[11px] leading-snug text-console-muted">
          At <code className="font-mono">0</code> a document must contain every word of the query. At{' '}
          <code className="font-mono">1</code> matching one word is enough. Try{' '}
          <code className="font-mono">blue cotton shirt</code>.
        </p>

        <div className="border-t border-console-line pt-3">
          <Toggle
            label="Exact match"
            description="Whole indexed words only — no prefix expansion, no typo tolerance."
            checked={settings.exact}
            onChange={(checked) => onChange({ ...settings, exact: checked })}
          />
        </div>
      </div>
    </Panel>
  )
}
