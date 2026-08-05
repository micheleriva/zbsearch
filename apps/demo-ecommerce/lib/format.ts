const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

const wholeCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** Whole-dollar amounts, for facet range labels where cents are noise. */
export function formatPriceShort(value: number): string {
  return wholeCurrency.format(value)
}

export function formatPrice(value: number): string {
  return currency.format(value)
}

export function formatCount(value: number): string {
  return value >= 10_000 ? compact.format(value) : value.toLocaleString('en-US')
}

/** Renders sub-millisecond durations the way ZBSearch does: microseconds until it hurts. */
export function formatMs(ms: number): string {
  if (ms < 1) {
    return `${Math.round(ms * 1000)}μs`
  }

  return ms < 10 ? `${ms.toFixed(2)}ms` : `${ms.toFixed(1)}ms`
}
