'use client'

import { useState } from 'react'
import { MODE_LABELS } from '@/lib/engine'
import type { Mode } from '@/lib/types'
import { ConsoleButton, Panel } from './ui'

/**
 * Renders the params object, with the query vector collapsed.
 *
 * Printing 384 floats would bury everything else in the call, but replacing them with a
 * bare "[…]" hides the one thing worth seeing — that the vector really is just an array
 * of numbers handed to `search()` like any other parameter. So the first few components
 * are kept and the rest counted.
 */
function render(params: Record<string, unknown>, expandVector: boolean): string {
  const json = JSON.stringify(
    params,
    (key, value) => {
      if (key === 'value' && Array.isArray(value) && value.length > 8 && !expandVector) {
        const head = value.slice(0, 4).map((component) => Number(component.toFixed(4)))
        return `[${head.join(', ')}, … ${value.length - 4} more]`
      }

      return typeof value === 'number' && !Number.isInteger(value) ? Number(value.toFixed(4)) : value
    },
    2
  )

  // The elided vector comes back as a JSON string; unquote it so it reads as an array.
  return json.replace(/"(\[[^"]*more\])"/g, '$1')
}

export function QueryInspector({
  mode,
  params,
  elapsed
}: {
  mode: Mode
  params: Record<string, unknown>
  elapsed: string
}) {
  const [expanded, setExpanded] = useState(false)
  const hasVector = mode !== 'fulltext'

  return (
    <Panel
      title="Query"
      hint={`The exact call behind what is on screen. ZBSearch reported ${elapsed} for it.`}
      action={
        hasVector ? (
          <ConsoleButton onClick={() => setExpanded(!expanded)}>
            {expanded ? 'collapse vector' : 'expand vector'}
          </ConsoleButton>
        ) : null
      }
    >
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-console-ink">
        <span className="text-console-muted">search(db, </span>
        {render(params, expanded)}
        <span className="text-console-muted">)</span>
      </pre>

      <p className="text-[11px] leading-relaxed text-console-muted">
        {MODE_LABELS[mode]} mode.{' '}
        {mode === 'fulltext'
          ? 'No vector is involved, so no encoder is loaded and the call is synchronous.'
          : 'The vector was produced by the encoder from the query text; everything else is the same index and the same filters as the other modes.'}
      </p>
    </Panel>
  )
}
