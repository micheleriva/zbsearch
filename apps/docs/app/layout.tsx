import { RootProvider } from 'fumadocs-ui/provider/next'
import './global.css'
import { Inter } from 'next/font/google'
import type { Metadata } from 'next'

const inter = Inter({
  subsets: ['latin']
})

export const metadata: Metadata = {
  metadataBase: new URL('https://zbsearch.dev'),
  title: {
    default: 'ZBSearch',
    template: '%s | ZBSearch'
  },
  description:
    'A complete search engine in your browser, server, or edge network with support for full-text, vector, and hybrid search.'
}

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
