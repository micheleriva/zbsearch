import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { asBlogPostData } from '@/lib/blog'
import { blog } from '@/lib/source'

export default function BlogPage() {
  const posts = blog
    .getPages()
    .map((post) => ({ post, data: asBlogPostData(post.data) }))
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-fd-primary/8 blur-3xl" />
      </div>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-16">
        <header className="mb-14">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Blog</h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-fd-muted-foreground">
            Engineering notes on building ZBSearch. <br />
            Architecture, performance, and deployment.
          </p>
        </header>

        <ul className="divide-y divide-fd-border border-y border-fd-border">
          {posts.map(({ post, data }) => (
            <li key={post.url}>
              <Link
                href={post.url}
                className="group flex flex-col gap-3 py-8 transition-colors sm:flex-row sm:items-baseline sm:gap-10"
              >
                <time
                  dateTime={data.date.toISOString()}
                  className="shrink-0 text-sm tabular-nums text-fd-muted-foreground sm:w-28"
                >
                  {data.date.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                </time>

                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-semibold tracking-tight text-fd-foreground transition-colors group-hover:text-fd-primary sm:text-2xl">
                    {data.title}
                    <ArrowUpRight className="ml-1.5 inline size-4 -translate-y-0.5 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-1 group-hover:opacity-100" />
                  </h2>
                  <p className="mt-2 text-[15px] leading-relaxed text-fd-muted-foreground">{data.description}</p>
                  <p className="mt-3 text-sm text-fd-muted-foreground/80">{data.author}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
