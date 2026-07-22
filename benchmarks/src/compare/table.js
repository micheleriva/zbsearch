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

function formatValue(unit, value) {
  if (unit === 'ops') return formatOps(value)
  if (unit === 'bytes') return formatBytes(value)
  return formatMs(value)
}

export function compareRow(row) {
  const leftKey = row.leftKey ?? 'orama'
  const rightKey = row.rightKey ?? 'zbsearch'
  const leftLabel = row.leftLabel ?? 'Orama'
  const rightLabel = row.rightLabel ?? 'ZBSearch'
  const left = row[leftKey] ?? row.orama ?? row.left
  const right = row[rightKey] ?? row.zbsearch ?? row.right
  const { name, unit, higherIsBetter = unit === 'ops' } = row
  const tieThresholdPct = row.tieThresholdPct ?? 1

  let winner = 'tie'
  let delta = '0%'
  let pct = 0

  if (left != null && right != null && left !== 0 && right !== 0) {
    const ratio = right / left
    pct = (ratio - 1) * 100
    const absPct = Math.abs(pct)

    if (absPct < tieThresholdPct) {
      winner = 'tie'
      delta = `~${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
    } else if (higherIsBetter) {
      winner = right > left ? rightLabel : leftLabel
      delta = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
    } else {
      winner = right < left ? rightLabel : leftLabel
      delta = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
    }
  } else if (left == null && right != null) {
    winner = rightLabel
    delta = 'n/a'
  } else if (right == null && left != null) {
    winner = leftLabel
    delta = 'n/a'
  }

  const rightIsBetter =
    left != null &&
    right != null &&
    left !== 0 &&
    ((higherIsBetter && right > left) || (!higherIsBetter && right < left))

  const leftIsBetter =
    left != null &&
    right != null &&
    left !== 0 &&
    ((higherIsBetter && left > right) || (!higherIsBetter && left < right))

  return {
    metric: name,
    left: formatValue(unit, left),
    right: formatValue(unit, right),
    orama: formatValue(unit, left),
    zbsearch: formatValue(unit, right),
    winner,
    delta,
    unit,
    pct,
    higherIsBetter,
    rightIsBetter,
    leftIsBetter,
    raw: { left, right, orama: left, zbsearch: right }
  }
}

export function toMarkdownTable(rows, meta) {
  const leftLabel = meta.leftLabel ?? `Orama ${meta.oramaVersion ?? ''}`.trim()
  const rightLabel = meta.rightLabel ?? `ZBSearch ${meta.zbsearchVersion ?? ''}`.trim()
  const title = meta.title ?? `${leftLabel} vs ${rightLabel}`
  const subtitle =
    meta.subtitle ??
    (meta.oramaVersion && meta.zbsearchVersion
      ? `Orama **${meta.oramaVersion}** vs ZBSearch **${meta.zbsearchVersion}**`
      : `${leftLabel} vs ${rightLabel}`)
  const deltaHeader = meta.deltaHeader ?? `Δ (${meta.rightShort ?? 'right'} / ${meta.leftShort ?? 'left'})`

  const lines = [
    `## ${title}`,
    '',
    subtitle,
    '',
    `| Metric | ${leftLabel} | ${rightLabel} | Winner | ${deltaHeader} |`,
    `| --- | ---: | ---: | --- | ---: |`
  ]

  for (const row of rows) {
    lines.push(
      `| ${row.metric} | ${row.left ?? row.orama} | ${row.right ?? row.zbsearch} | ${row.winner} | ${row.delta} |`
    )
  }

  return lines.join('\n')
}

export function toAsciiTable(rows, meta) {
  const leftLabel = meta.leftLabel ?? `Orama ${meta.oramaVersion ?? ''}`.trim()
  const rightLabel = meta.rightLabel ?? `ZBSearch ${meta.zbsearchVersion ?? ''}`.trim()
  const deltaHeader = meta.deltaHeader ?? `Δ (${meta.rightShort ?? 'right'}/${meta.leftShort ?? 'left'})`

  const headers = ['Metric', leftLabel, rightLabel, 'Winner', deltaHeader]
  const data = rows.map((row) => [
    row.metric,
    row.left ?? row.orama,
    row.right ?? row.zbsearch,
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
    meta.title ?? `${leftLabel} vs ${rightLabel}`,
    rule,
    formatLine(headers, aligns),
    rule,
    ...data.map((row) => formatLine(row, aligns)),
    rule
  ]

  return lines.join('\n')
}

export function summarizeWinners(rows, labels = { left: 'Orama', right: 'ZBSearch' }) {
  const counts = { [labels.left]: 0, [labels.right]: 0, tie: 0 }
  for (const row of rows) {
    counts[row.winner] = (counts[row.winner] ?? 0) + 1
  }
  return counts
}

export function classifyChanges(rows, { thresholdPct = 5, rightLabel = 'PR' } = {}) {
  const regressions = []
  const improvements = []

  for (const row of rows) {
    if (row.winner === 'tie') continue
    const absPct = Math.abs(row.pct)
    if (absPct < thresholdPct) continue

    const entry = {
      metric: row.metric,
      delta: row.delta,
      pct: row.pct,
      winner: row.winner
    }

    if (row.winner === rightLabel) {
      improvements.push(entry)
    } else {
      regressions.push(entry)
    }
  }

  return { regressions, improvements, thresholdPct }
}
