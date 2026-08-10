'use client'

import type { Product } from '@/lib/types'
import { formatPrice } from '@/lib/format'
import { HighlightedText } from './highlighted-text'
import { cx } from './ui'

function Stars({ rating, reviews }: { rating: number; reviews?: number }) {
  return (
    <span className="flex items-center gap-1.5" title={`${rating.toFixed(2)} out of 5`}>
      <span className="flex" aria-hidden>
        {[0, 1, 2, 3, 4].map((index) => (
          <svg key={index} viewBox="0 0 12 12" className="h-[12px] w-[12px]">
            <path
              d="M6 1 7.5 4.4 11 4.8 8.4 7.2 9.1 10.7 6 9 2.9 10.7 3.6 7.2 1 4.8 4.5 4.4Z"
              className={index < Math.round(rating) ? 'fill-star' : 'fill-line'}
            />
          </svg>
        ))}
      </span>
      <span className="text-[11px] text-ink-faint">
        {rating.toFixed(1)}
        {reviews === undefined ? '' : ` (${reviews})`}
      </span>
    </span>
  )
}

export function ProductCard({
  product,
  term = '',
  featured,
  score,
  inCart,
  saved,
  onAdd,
  onSave
}: {
  product: Product
  term?: string
  /** Set when a merchandising rule put this product where it is. */
  featured?: boolean
  /** BM25 score, shown only while the search console asks for it. */
  score?: number
  inCart: number
  saved: boolean
  onAdd: () => void
  onSave: () => void
}) {
  const discounted = product.discount >= 1

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-line bg-card transition-shadow hover:shadow-lg hover:shadow-black/5">
      <div className="relative aspect-square overflow-hidden bg-white">
        <img
          src={product.image}
          alt={product.title}
          width={400}
          height={400}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain p-5 transition-transform duration-300 group-hover:scale-[1.05]"
        />

        <div className="absolute left-2.5 top-2.5 flex flex-col items-start gap-1">
          {featured ? (
            <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-card">
              Featured
            </span>
          ) : null}
          {discounted ? (
            <span className="rounded-full bg-sale px-2 py-0.5 text-[10px] font-semibold text-white">
              −{Math.round(product.discount)}%
            </span>
          ) : null}
          {!product.inStock ? (
            <span className="rounded-full bg-shade px-2 py-0.5 text-[10px] font-semibold text-ink-muted">Sold out</span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onSave}
          aria-label={saved ? `Remove ${product.title} from saved` : `Save ${product.title}`}
          aria-pressed={saved}
          className={cx(
            'absolute right-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-full border border-line bg-card/90 backdrop-blur transition-colors',
            saved ? 'text-sale' : 'text-ink-faint hover:text-ink'
          )}
        >
          <svg viewBox="0 0 20 20" className="h-[16px] w-[16px]" fill={saved ? 'currentColor' : 'none'} aria-hidden>
            <path
              d="M10 16.5S3.5 12.8 3.5 8.4A3.4 3.4 0 0 1 10 6.9a3.4 3.4 0 0 1 6.5 1.5c0 4.4-6.5 8.1-6.5 8.1Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {score !== undefined ? (
          <span className="absolute bottom-2.5 left-2.5 rounded bg-ink/80 px-1.5 py-0.5 font-mono text-[10px] text-card tabular-nums">
            {score === 0 ? 'pinned' : score.toFixed(2)}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1 border-t border-line-soft p-3.5">
        <span className="truncate text-[11px] uppercase tracking-wide text-ink-faint">
          <HighlightedText text={product.brand || product.category} term={term} />
        </span>

        <h3 className="line-clamp-2 text-[13.5px] font-medium leading-snug text-ink">
          <HighlightedText text={product.title} term={term} />
        </h3>

        <div className="mt-0.5">
          <Stars rating={product.rating} reviews={product.reviews} />
        </div>

        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <div className="flex items-baseline gap-1.5">
            <span className={cx('text-[15px] font-semibold tabular-nums', discounted ? 'text-sale' : 'text-ink')}>
              {formatPrice(product.price)}
            </span>
            {discounted ? (
              <span className="text-[11px] tabular-nums text-ink-faint line-through">
                {formatPrice(product.listPrice)}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onAdd}
            disabled={!product.inStock}
            className={cx(
              'shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
              !product.inStock
                ? 'cursor-not-allowed bg-shade text-ink-faint'
                : inCart > 0
                  ? 'bg-shade text-ink hover:bg-line'
                  : 'bg-ink text-card hover:bg-ink/85'
            )}
          >
            {!product.inStock ? 'Sold out' : inCart > 0 ? `In cart · ${inCart}` : 'Add'}
          </button>
        </div>
      </div>
    </article>
  )
}
