import zbsearch from '@zbsearch/plugin-vitepress'
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'ZBSearch Sandbox',
  description: 'A VitePress site that searches with ZBSearch',
  srcDir: 'docs',
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: 'Guides', link: '/guides/vector-search' },
      { text: 'Reference', link: '/reference/api' }
    ],
    sidebar: [
      { text: 'Start here', items: [{ text: 'Getting Started', link: '/' }] },
      {
        text: 'Guides',
        items: [
          { text: 'Vector Search', link: '/guides/vector-search' },
          { text: 'Hybrid Search', link: '/guides/hybrid-search' }
        ]
      },
      { text: 'Reference', items: [{ text: 'API Reference', link: '/reference/api' }] }
    ]
  },
  vite: {
    plugins: [zbsearch({ excludeRoutes: ['/internal/**'] })]
  }
})
