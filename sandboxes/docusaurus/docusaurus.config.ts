import type * as Preset from '@docusaurus/preset-classic'
import type { Config } from '@docusaurus/types'
import type { ZBSearchDocusaurusOptions } from '@zbsearch/plugin-docusaurus'
import { themes as prismThemes } from 'prism-react-renderer'

const zbsearchOptions: ZBSearchDocusaurusOptions = {
  excludeRoutes: ['/docs/internal/**']
}

const config: Config = {
  title: 'ZBSearch Sandbox',
  tagline: 'A Docusaurus site that searches with ZBSearch',
  favicon: 'img/favicon.svg',
  url: 'https://zbsearch.dev',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn'
    }
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en']
  },
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts'
        },
        blog: {
          showReadingTime: true,
          onInlineAuthors: 'ignore',
          onUntruncatedBlogPosts: 'ignore'
        },
        theme: {
          customCss: './src/css/custom.css'
        }
      } satisfies Preset.Options
    ]
  ],
  plugins: [['@zbsearch/plugin-docusaurus', zbsearchOptions]],
  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: false
    },
    navbar: {
      title: 'ZBSearch Sandbox',
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs' },
        { to: '/blog', label: 'Blog', position: 'left' },
        { to: '/about', label: 'About', position: 'left' }
      ]
    },
    footer: {
      style: 'dark',
      copyright: 'Built with Docusaurus, searched with ZBSearch.'
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula
    }
  } satisfies Preset.ThemeConfig
}

export default config
