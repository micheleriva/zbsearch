'use client'

import type { Settings, View } from '@/lib/types'
import { Field, Panel, Slider, cx } from './ui'

const BOOST_FIELDS = ['title', 'summary', 'tags', 'body'] as const

/**
 * The knobs behind the current ranking.
 *
 * Each one is disabled in the modes it does not apply to, rather than hidden: half of what
 * this panel teaches is which parameters belong to which half of a hybrid query.
 */
export function TuningPanel({
  view,
  settings,
  onChange,
}: {
  view: View
  settings: Settings
  onChange: (settings: Settings) => void
}) {
  const usesVector = view !== 'fulltext'
  const usesText = view !== 'vector'
  const usesBlend = view === 'hybrid' || view === 'compare'

  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })

  return (
    <Panel title="Ranking">
      <div className={cx('space-y-3 text-vector', !usesVector && 'opacity-40')}>
        <Field label="similarity" value={settings.similarity.toFixed(2)}>
          <Slider
            min={0}
            max={0.9}
            step={0.01}
            value={settings.similarity}
            onChange={similarity => set({ similarity })}
            accent="text-vector"
          />
        </Field>
        <p className="text-[11px] leading-relaxed text-console-muted">
          The floor a cosine has to clear to count as a hit. ZBSearch defaults this to 0.80, which suits
          encoders whose unrelated pairs already sit high; with this model the best match ever measured on
          this corpus is 0.74, so that default would return nothing at all. Pull it up and watch the
          semantic results thin out one by one.
        </p>
      </div>

      <div className={cx('space-y-3 text-hybrid', !usesBlend && 'opacity-40')}>
        <Field
          label="hybridWeights"
          value={`text ${(1 - settings.vectorWeight).toFixed(2)} · vector ${settings.vectorWeight.toFixed(2)}`}
        >
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={settings.vectorWeight}
            onChange={vectorWeight => set({ vectorWeight })}
            accent="text-hybrid"
          />
        </Field>
        <p className="text-[11px] leading-relaxed text-console-muted">
          Both rankings are normalised to their own top score before being added, so this is a true split
          rather than a comparison of raw scores. At 0.00 hybrid collapses onto keyword; at 1.00 it is
          semantic with a lexical tie-break.
        </p>
      </div>

      <div className={cx('space-y-3 text-lexical', !usesText && 'opacity-40')}>
        <Field label="tolerance" value={settings.tolerance}>
          <Slider
            min={0}
            max={2}
            step={1}
            value={settings.tolerance}
            onChange={tolerance => set({ tolerance })}
            accent="text-lexical"
          />
        </Field>
        <p className="text-[11px] leading-relaxed text-console-muted">
          Edit distance allowed per term. Typo tolerance is the lexical answer to a query that does not
          match; the vector index needs no equivalent because near-misses are already near in the space.
        </p>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1">
          {BOOST_FIELDS.map(field => (
            <Field key={field} label={`boost.${field}`} value={settings.boosts[field]}>
              <Slider
                min={1}
                max={8}
                step={1}
                value={settings.boosts[field]}
                onChange={value => set({ boosts: { ...settings.boosts, [field]: value } })}
                accent="text-lexical"
              />
            </Field>
          ))}
        </div>
      </div>
    </Panel>
  )
}
