import { source } from '@/lib/source'
import { SearchBoxDemo } from '@/components/searchbox-demo'

/**
 * MDX-friendly wrapper around the home page's search box demo: fetches the
 * docs pages on the server so blog posts can drop in `<SearchBoxLiveDemo />`
 * without props. Like the home page band, the demo renders nothing below the
 * `lg` breakpoint.
 */
export function SearchBoxLiveDemo() {
  const docs = source.getPages().map((page) => ({
    id: page.url,
    url: page.url,
    title: page.data.title,
    section: page.slugs[0] === 'cloudflare' ? 'Cloudflare' : 'ZBSearch',
    snippet: page.data.description
  }))

  return (
    <div className="not-prose my-8">
      <SearchBoxDemo docs={docs} stacked defaultTerm="vector search" />
    </div>
  )
}
