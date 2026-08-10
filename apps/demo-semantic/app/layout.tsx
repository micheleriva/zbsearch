import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'Atlas Help Center — keyword, semantic and hybrid search on ZBSearch',
  description:
    'A help center where the same query runs three ways in the browser: BM25 over an inverted index, cosine similarity over sentence embeddings, and the two blended. Nothing is sent to a server.'
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
