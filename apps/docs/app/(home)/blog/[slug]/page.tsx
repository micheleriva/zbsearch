import { getMDXComponents } from '@/components/mdx';
import { asBlogPostData } from '@/lib/blog';
import { blog } from '@/lib/source';
import { gitConfig } from '@/lib/shared';
import { InlineTOC } from 'fumadocs-ui/components/inline-toc';
import { ArrowLeft, Calendar, User } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function BlogPostPage(props: PageProps<'/blog/[slug]'>) {
  const params = await props.params;
  const page = blog.getPage([params.slug]);

  if (!page) notFound();

  const data = asBlogPostData(page.data);
  const MDX = data.body;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-12">
      <Link
        href="/blog"
        className="mb-8 inline-flex items-center gap-2 text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to blog
      </Link>

      <header className="mb-10 border-b pb-8">
        <h1 className="text-4xl font-bold tracking-tight">{data.title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-fd-muted-foreground">{data.description}</p>
        <div className="mt-6 flex flex-wrap gap-6 text-sm text-fd-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <User className="size-4" />
            {data.author}
          </span>
          <span className="inline-flex items-center gap-2">
            <Calendar className="size-4" />
            {data.date.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </span>
        </div>
      </header>

      <article className="prose min-w-0 flex-1">
        <InlineTOC items={data.toc} />
        <MDX components={getMDXComponents()} />
      </article>

      <footer className="mt-12 border-t pt-8 text-sm text-fd-muted-foreground">
        <p>
          Source on{' '}
          <a
            href={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/apps/docs/content/blog/${page.path}`}
            className="text-fd-primary hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          .
        </p>
      </footer>
    </main>
  );
}

export function generateStaticParams(): { slug: string }[] {
  return blog.getPages().map((page) => ({
    slug: page.slugs[0]!,
  }));
}

export async function generateMetadata(props: PageProps<'/blog/[slug]'>): Promise<Metadata> {
  const params = await props.params;
  const page = blog.getPage([params.slug]);

  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
