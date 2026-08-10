import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  redirects: async () => [
    {
      source: '/docs',
      destination: '/docs/zbsearch',
      permanent: false
    },
    {
      source: '/docs/zbsearch-js',
      destination: '/docs/zbsearch',
      permanent: true
    },
    {
      source: '/docs/zbsearch-js/:path*',
      destination: '/docs/zbsearch/:path*',
      permanent: true
    }
  ]
}

export default withMDX(config)
