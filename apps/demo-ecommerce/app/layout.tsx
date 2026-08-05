import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'OneStore — everything you need, found instantly',
  description:
    'A demo storefront where the whole search stack — full-text, facets, filters, field boosting and merchandising pins — runs client-side on ZBSearch.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
