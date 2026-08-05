'use client'

const COLUMNS = [
  { title: 'Shop', links: ['New arrivals', 'Best sellers', 'Deals of the week', 'Gift cards'] },
  { title: 'Help', links: ['Track an order', 'Shipping & delivery', 'Returns', 'Contact us'] },
  { title: 'Company', links: ['About OneStore', 'Careers', 'Press', 'Sustainability'] },
  { title: 'Legal', links: ['Terms of sale', 'Privacy', 'Cookies', 'Accessibility'] },
]

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-line bg-card">
      <div className="mx-auto max-w-[1500px] px-4 py-10 lg:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <span className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-[13px] font-bold leading-none text-card">
                1
              </span>
              <span className="text-[16px] font-semibold tracking-tight text-ink">OneStore</span>
            </span>
            <p className="mt-3 max-w-xs text-[12.5px] leading-relaxed text-ink-muted">
              A demo storefront. Nothing here ships, and no payment is ever taken.
            </p>
          </div>

          {COLUMNS.map(column => (
            <div key={column.title}>
              <h3 className="text-[12.5px] font-semibold text-ink">{column.title}</h3>
              <ul className="mt-2.5 space-y-1.5">
                {column.links.map(link => (
                  <li key={link}>
                    <span className="text-[12.5px] text-ink-muted">{link}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-5 text-[11.5px] text-ink-faint">
          <p>© {new Date().getFullYear()} OneStore. A demonstration, not a shop.</p>
          <p>
            Search runs in your browser on{' '}
            <a href="https://zbsearch.dev" className="font-medium text-brand-ink hover:underline">
              ZBSearch
            </a>
            . Product data from DummyJSON.
          </p>
        </div>
      </div>
    </footer>
  )
}
