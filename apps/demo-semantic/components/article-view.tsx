'use client'

import type { Article, Hit } from '@/lib/types'
import { MODE_COLOR, cx } from './ui'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * An article, and the four articles nearest to it in the embedding space.
 *
 * The related list is the quietest demonstration in the demo and possibly the most useful
 * one: it is a vector search with no query and no encoder, run against the article's own
 * stored embedding. "More like this" is the same feature as semantic search pointed at a
 * document instead of at a sentence somebody typed.
 */
export function ArticleView({
  article,
  related,
  backLabel,
  onOpen,
  onArea,
  onBack
}: {
  article: Article
  related: Hit[]
  /**
   * What the first crumb goes back to. Opening an article from a result list has to lead
   * back to that list rather than to the home page — throwing away the query somebody just
   * typed is the fastest way to make a search product feel broken.
   */
  backLabel: string
  onOpen: (id: string) => void
  onArea: (area: string) => void
  onBack: () => void
}) {
  return (
    <article className="mx-auto max-w-2xl">
      <nav className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
        <button type="button" onClick={onBack} className="hover:text-accent-ink">
          {backLabel}
        </button>
        <span aria-hidden>›</span>
        <button type="button" onClick={() => onArea(article.area)} className="hover:text-accent-ink">
          {article.area}
        </button>
        <span aria-hidden>›</span>
        <span className="text-ink-muted">{article.topic}</span>
      </nav>

      <h1 className="mt-3 text-[26px] font-semibold leading-tight tracking-tight text-ink">{article.title}</h1>

      <p className="mt-2.5 text-[15px] leading-relaxed text-ink-muted">{article.summary}</p>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-line-soft py-2.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-faint">
        <span>Updated {formatDate(article.updated)}</span>
        <span>{article.views.toLocaleString()} reads</span>
        <span className="text-positive">{Math.round(article.helpful * 100)}% found this helpful</span>
        {article.audience === 'everyone' ? null : <span>For {article.audience}</span>}
      </div>

      <div className="mt-6 text-[15px] leading-[1.75] text-ink">{article.body}</div>

      <div className="mt-8 flex flex-wrap gap-1.5">
        {article.tags.map((tag) => (
          <span key={tag} className="rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-ink-muted">
            {tag}
          </span>
        ))}
      </div>

      {related.length > 0 ? (
        <section className="mt-10 border-t border-line pt-6">
          <h2 className="text-[13px] font-semibold text-ink">Related articles</h2>
          <p className="mt-0.5 text-[11.5px] text-ink-faint">
            The nearest articles in the embedding space — vector search against this article&rsquo;s own stored vector,
            with no query and no encoder involved.
          </p>

          <ul className="mt-3 divide-y divide-line-soft">
            {related.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => onOpen(hit.id)}
                  className="group flex w-full items-baseline gap-3 py-2.5 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] text-ink transition-colors group-hover:text-accent-ink group-hover:underline group-hover:underline-offset-2">
                      {hit.document.title}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-faint">
                      {hit.document.area} › {hit.document.topic}
                    </span>
                  </span>
                  <span className={cx('shrink-0 font-mono text-[10.5px] tabular-nums', MODE_COLOR.vector.text)}>
                    cos {hit.score.toFixed(2)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  )
}
