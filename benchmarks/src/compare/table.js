/**
 * Render comparison results as Markdown and ASCII tables.
 */

function pad(value, width, align = 'left') {
  const text = String(value)
  if (text.length >= width) return text
  const padding = ' '.repeat(width - text.length)
  return align === 'right' ? padding + text : text + padding
}

function formatOps(value) {
  if (value == null || Number.isNaN(value)) return 'n/a'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M/s`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}k/s`
  return `${value.toFixed(2)}/s`
}

function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return 'n/a'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatMs(ms) {
  if (ms == null || Number.isNaN(ms)) return 'n/a'
  if (ms < 1) return `${(ms * 1000).toFixed(1)} µs`
  if (ms < 1000) return `${ms.toFixed(2)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

/**
 * @param {{ name: string, unit: 'ops'|'bytes'|'ms', orama: number, zbsearch: number, higherIsBetter?: boolean }} row
 */
export function compareRow(row) {
  const { name, unit, orama, zbsearch, higherIsBetter = unit === 'ops' } = row
  const format =
    unit === 'ops' ? formatOps : unit === 'bytes' ? formatBytes : formatMs

  let winner = 'tie'
  let delta = '0%'

  if (orama != null && zbsearch != null && orama !== 0 && zbsearch !== 0) {
    const ratio = zbsearch / orama
    const pct = (ratio - 1) * 100
    const absPct = Math.abs(pct)

    if (absPct < 1) {
      winner = 'tie'
      delta = `~${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
    } else if (higherIsBetter) {
      winner = zbsearch > orama ? 'ZBSearch' : 'Orama'
      delta = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
    } else {
      winner = zbsearch < orama ? 'ZBSearch' : 'Orama'
      // For lower-is-better, show how much smaller/faster zbsearch is vs orama
      delta = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
    }
  } else if (orama == null && zbsearch != null) {
    winner = 'ZBSearch'
    delta = 'n/a'
  } else if (zbsearch == null && orama != null) {
    winner = 'Orama'
    delta = 'n/a'
  }

  return {
    metric: name,
    orama: format(orama),
    zbsearch: format(zbsearch),
    winner,
    delta,
    unit,
    raw: { orama, zbsearch }
  }
}

/**
 * @param {ReturnType<typeof compareRow>[]} rows
 * @param {{ oramaVersion: string, zbsearchVersion: string, title?: string }} meta
 */
export function toMarkdownTable(rows, meta) {
  const title = meta.title ?? 'Orama vs ZBSearch'
  const lines = [
    `## ${title}`,
    '',
    `Orama **${meta.oramaVersion}** vs ZBSearch **${meta.zbsearchVersion}**`,
    '',
    `| Metric | Orama ${meta.oramaVersion} | ZBSearch ${meta.zbsearchVersion} | Winner | Δ (ZB / Orama) |`,
    `| --- | ---: | ---: | --- | ---: |`
  ]

  for (const row of rows) {
    lines.push(
      `| ${row.metric} | ${row.orama} | ${row.zbsearch} | ${row.winner} | ${row.delta} |`
    )
  }

  return lines.join('\n')
}

/**
 * @param {ReturnType<typeof compareRow>[]} rows
 * @param {{ oramaVersion: string, zbsearchVersion: string, title?: string }} meta
 */
export function toAsciiTable(rows, meta) {
  const headers = [
    'Metric',
    `Orama ${meta.oramaVersion}`,
    `ZBSearch ${meta.zbsearchVersion}`,
    'Winner',
    'Δ (ZB/Orama)'
  ]
  const data = rows.map((row) => [
    row.metric,
    row.orama,
    row.zbsearch,
    row.winner,
    row.delta
  ])

  const widths = headers.map((header, i) =>
    Math.max(header.length, ...data.map((row) => String(row[i]).length))
  )

  const rule = `+-${widths.map((w) => '-'.repeat(w)).join('-+-')}-+`
  const formatLine = (cells, aligns) =>
    `| ${cells.map((cell, i) => pad(cell, widths[i], aligns[i])).join(' | ')} |`

  const aligns = ['left', 'right', 'right', 'left', 'right']
  const lines = [
    meta.title ?? 'Orama vs ZBSearch',
    rule,
    formatLine(headers, aligns),
    rule,
    ...data.map((row) => formatLine(row, aligns)),
    rule
  ]

  return lines.join('\n')
}

export function summarizeWinners(rows) {
  const counts = { Orama: 0, ZBSearch: 0, tie: 0 }
  for (const row of rows) {
    counts[row.winner] = (counts[row.winner] ?? 0) + 1
  }
  return counts
}
