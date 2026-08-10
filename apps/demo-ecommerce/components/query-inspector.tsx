'use client'

import { Panel } from './ui'

const INLINE_WIDTH = 46

/**
 * Pretty-prints the search params the way you'd write them by hand: object literals with
 * bare keys, and anything short enough kept on one line so the facet ranges don't turn
 * into forty lines of scrolling.
 */
function pretty(value: unknown, indent = ''): string {
  const compact = JSON.stringify(value)
    ?.replace(/"([A-Za-z_$][\w$]*)":/g, '$1: ')
    .replace(/,/g, ', ')

  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined'
  }

  if (compact !== undefined && compact.length + indent.length <= INLINE_WIDTH) {
    return compact
  }

  const inner = indent + '  '

  if (Array.isArray(value)) {
    return `[\n${value.map((item) => `${inner}${pretty(item, inner)}`).join(',\n')}\n${indent}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)

  return `{\n${entries.map(([key, item]) => `${inner}${key}: ${pretty(item, inner)}`).join(',\n')}\n${indent}}`
}

function Line({ text }: { text: string }) {
  const match = /^(\s*)([A-Za-z_$][\w$]*):\s(.*)$/.exec(text)

  if (!match) {
    return <span className="text-console-ink/80">{text}</span>
  }

  const [, indent, key, rest] = match

  return (
    <>
      <span>{indent}</span>
      <span className="text-console-brand">{key}</span>
      <span className="text-console-muted">: </span>
      <span className="text-console-ink/80">{rest}</span>
    </>
  )
}

export function QueryInspector({ params }: { params: Record<string, unknown> }) {
  const body = pretty(params).split('\n').slice(1, -1)

  return (
    <Panel
      title="Query inspector"
      hint="The exact call behind the grid above. It updates on every keystroke, filter and slider."
    >
      <pre className="max-h-80 overflow-auto font-mono text-[10.5px] leading-[1.65]">
        <code>
          <span className="text-console-ink">search</span>
          <span className="text-console-muted">(catalog, {'{'}</span>
          {'\n'}
          {body.map((line, index) => (
            <span key={index}>
              <Line text={line} />
              {'\n'}
            </span>
          ))}
          <span className="text-console-muted">{'})'}</span>
        </code>
      </pre>
    </Panel>
  )
}
