import { getSearchIndex } from '@/lib/search-index'

export const revalidate = false

export async function GET() {
  const { payloadJson } = await getSearchIndex()

  return new Response(payloadJson, {
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}
