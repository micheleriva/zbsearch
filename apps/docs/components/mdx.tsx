import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import { CostCalculator } from '@/components/cloudflare/cost-calculator'
import { Iframe } from '@/lib/components/iframe'
import { Mermaid } from '@/components/mdx/mermaid'
import { BenchChart } from '@/components/blog/bench-chart'
import { SearchBoxLiveDemo } from '@/components/blog/searchbox-live-demo'

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    CostCalculator,
    Iframe,
    Mermaid,
    BenchChart,
    SearchBoxLiveDemo,
    ...components
  } satisfies MDXComponents
}

export const useMDXComponents = getMDXComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
