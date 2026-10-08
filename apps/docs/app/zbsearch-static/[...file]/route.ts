import { getSearchIndex } from '@/lib/search-index'
import { notFound } from 'next/navigation'

export const revalidate = false

export async function GET(_req: Request, { params }: RouteContext<'/zbsearch-static/[...file]'>) {
  const { file } = await params
  const { staticFiles } = await getSearchIndex()
  const bytes = staticFiles?.get(file.join('/'))
  if (!bytes) notFound()

  const json = file[file.length - 1].endsWith('.json')

  return new Response(bytes.slice(), {
    headers: { 'content-type': json ? 'application/json; charset=utf-8' : 'application/octet-stream' }
  })
}

export async function generateStaticParams() {
  const { staticFiles } = await getSearchIndex()

  return Array.from(staticFiles?.keys() ?? [], (file) => ({ file: file.split('/') }))
}
