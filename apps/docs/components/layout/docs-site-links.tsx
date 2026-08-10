'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'
import { benchmarksRoute, blogRoute } from '@/lib/shared'

const siteLinks = [
  { text: 'Docs', url: '/docs/zbsearch', prefix: '/docs' },
  { text: 'Benchmarks', url: benchmarksRoute, prefix: benchmarksRoute },
  { text: 'Blog', url: blogRoute, prefix: blogRoute }
]

/**
 * Site-level navigation for the docs sidebar. Three full-width rows of the same
 * weight as the page tree read as part of it; one compact strip between rules
 * keeps them available without competing with the pages below.
 */
export function DocsSiteLinks() {
  const pathname = usePathname()

  return (
    // -mb-4 cancels the `mb-4` the sidebar puts on the last link item, leaving
    // the first tree heading's own `mt-6` as the whole gap.
    <nav className="-mb-4 flex items-center gap-0.5 border-y border-fd-border py-1.5 text-[0.8125rem]">
      {siteLinks.map((link) => (
        <Link
          key={link.url}
          href={link.url}
          data-active={pathname.startsWith(link.prefix)}
          className={cn(
            'rounded-md px-2 py-1 text-fd-muted-foreground transition-colors',
            'hover:bg-fd-accent/50 hover:text-fd-foreground',
            'data-[active=true]:text-fd-primary'
          )}
        >
          {link.text}
        </Link>
      ))}
    </nav>
  )
}
