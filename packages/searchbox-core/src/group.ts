import type { SearchHit, SearchHitGroup } from './types.js'

function pageOf(hit: SearchHit): string {
  const hash = hit.url.indexOf('#')

  return hash === -1 ? hit.url : hit.url.slice(0, hash)
}

export function groupHits(hits: SearchHit[]): SearchHitGroup[] {
  const groups: SearchHitGroup[] = []
  const byPage = new Map<string, SearchHitGroup>()

  for (const hit of hits) {
    const page = pageOf(hit)
    const existing = byPage.get(page)

    if (existing) {
      existing.hits.push(hit)
      continue
    }

    const group: SearchHitGroup = {
      id: page,
      title: hit.title,
      category: hit.category,
      hits: [hit]
    }

    byPage.set(page, group)
    groups.push(group)
  }

  return groups
}

export function flattenGroups(groups: SearchHitGroup[]): SearchHit[] {
  return groups.flatMap((group) => group.hits)
}

export function wrapIndex(index: number, delta: number, length: number): number {
  if (length === 0) {
    return -1
  }

  return (((index + delta) % length) + length) % length
}
