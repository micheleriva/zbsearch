import Link from 'next/link';
import { asBlogPostData } from '@/lib/blog';
import { blog } from '@/lib/source';

export default function BlogPage() {
  const posts = blog
    .getPages()
    .map((post) => ({ post, data: asBlogPostData(post.data) }))
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-12">
      <div className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight">Blog</h1>
        <p className="mt-3 max-w-2xl text-lg text-fd-muted-foreground">
          Engineering notes on building ZBSearch — architecture, performance, and deployment.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {posts.map(({ post, data }) => (
          <Link
            key={post.url}
            href={post.url}
            className="group rounded-2xl border bg-fd-card/40 p-6 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-fd-primary/25 hover:bg-fd-card/70 hover:shadow-md"
          >
            <time className="text-sm text-fd-muted-foreground">
              {data.date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </time>
            <h2 className="mt-2 text-xl font-semibold group-hover:text-fd-primary">{data.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{data.description}</p>
            <p className="mt-4 text-sm font-medium text-fd-muted-foreground">{data.author}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
