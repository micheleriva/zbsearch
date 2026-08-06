import zbsearch from '@zbsearch/plugin-starlight'
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

export default defineConfig({
  integrations: [
    starlight({
      title: 'ZBSearch Sandbox',
      description: 'A Starlight site that searches with ZBSearch',
      plugins: [zbsearch({ excludeRoutes: ['/internal/**'] })],
      sidebar: [
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] }
      ]
    })
  ]
})
