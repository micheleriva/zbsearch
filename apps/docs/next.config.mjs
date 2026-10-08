import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Dev only: lets the site be opened from another device on the LAN.
  // Next matches these per dot-separated segment, so one entry per private range covers any address the machine is handed.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.*.*.*'],
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
