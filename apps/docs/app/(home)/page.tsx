import Link from 'next/link';
import { ServerCodeBlock } from 'fumadocs-ui/components/codeblock.rsc';
import {
  ArrowRight,
  BarChart3,
  Filter,
  Github,
  Globe2,
  Layers,
  MapPin,
  Pin,
  Puzzle,
  Search,
  Sparkles,
  TrendingUp,
  Wand2,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const stats = [
  { label: 'Faster full-text search', value: '61%', detail: 'on complex queries' },
  { label: 'Faster geosearch', value: '8,700%', detail: 'at 500m radius' },
  { label: 'Faster vector search', value: '508%', detail: 'using the new IVF index' },
  { label: 'Bundle size', value: '<2kb', detail: 'full, tree-shakeable engine in the browser' },
];

const features: { title: string; description: string; icon: LucideIcon; href: string }[] = [
  {
    title: 'Full-Text Search',
    description: 'Typo-tolerant BM25 with stemming in 30+ languages.',
    icon: Search,
    href: '/docs/zbsearch-js/search',
  },
  {
    title: 'Vector Search',
    description: 'Fast similarity search with optional IVF indexing.',
    icon: Sparkles,
    href: '/docs/zbsearch-js/search/vector-search',
  },
  {
    title: 'Hybrid Search',
    description: 'Combine keyword and semantic relevance in one query.',
    icon: Zap,
    href: '/docs/zbsearch-js/search/hybrid-search',
  },
  {
    title: 'Search Filters',
    description: 'Filter by numbers, enums, booleans, and nested fields.',
    icon: Filter,
    href: '/docs/zbsearch-js/search/filters',
  },
  {
    title: 'Geosearch',
    description: 'Radius, polygon, and sorted geo queries on BKD trees.',
    icon: MapPin,
    href: '/docs/zbsearch-js/search/geosearch',
  },
  {
    title: 'Results Pinning',
    description: 'Merchandising rules to boost or pin specific results.',
    icon: Pin,
    href: '/docs/zbsearch-js/results-pinning',
  },
  {
    title: 'Facets',
    description: 'Aggregate counts across categories at search time.',
    icon: Layers,
    href: '/docs/zbsearch-js/search/facets',
  },
  {
    title: 'Fields Boosting',
    description: 'Weight schema properties to shape ranking.',
    icon: TrendingUp,
    href: '/docs/zbsearch-js/search/fields-boosting',
  },
  {
    title: 'Typo Tolerance',
    description: 'Forgiving matching powered by Levenshtein distance.',
    icon: Wand2,
    href: '/docs/zbsearch-js/search#typo-tolerance',
  },
  {
    title: 'BM25',
    description: 'Industry-standard ranking out of the box.',
    icon: BarChart3,
    href: '/docs/zbsearch-js/search/bm25',
  },
  {
    title: '30+ Languages',
    description: 'Tokenization and stemming for global text search.',
    icon: Globe2,
    href: '/docs/zbsearch-js/supported-languages',
  },
  {
    title: 'Plugin System',
    description: 'Extend indexing, search, and persistence with hooks.',
    icon: Puzzle,
    href: '/docs/zbsearch-js/plugins',
  },
];

const exampleCode = `import { create, insert, search } from 'zbsearch'

const db = create({
  schema: {
    title: 'string',
    embedding: 'vector[384]',
  },
})

await insert(db, {
  title: 'Noise cancelling headphones',
  embedding: [0.8271, 0.9274, 0.8371, 0,1723, 0.5291, ...],
})

const results = search(db, {
  term: 'best headphones',
  mode: 'hybrid',
})
`;

export default async function HomePage() {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute top-0 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-fd-primary/10 blur-3xl" />
        <div className="absolute top-32 -right-24 h-72 w-72 rounded-full bg-fd-primary/5 blur-3xl" />
        <div className="absolute top-48 -left-24 h-64 w-64 rounded-full bg-fd-primary/5 blur-3xl" />
      </div>

      <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 pt-16 pb-10 text-center">
        <h1 className="max-w-4xl text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
          Search without
          <span className="block bg-gradient-to-r from-fd-foreground via-fd-foreground to-fd-muted-foreground bg-clip-text text-transparent">
            the bullshit.
          </span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-fd-muted-foreground sm:text-xl">
          A zero-bs fork of Orama maintained by the original team. Full-text, vector, and hybrid
          search in your browser, server, or edge - in less than 2kb.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs/zbsearch-js"
            className="inline-flex items-center gap-2 rounded-full bg-fd-primary px-6 py-3 text-sm font-semibold text-fd-primary-foreground shadow-lg shadow-fd-primary/20 transition-transform hover:scale-[1.02]"
          >
            Get Started
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/docs/zbsearch-js/vs-orama"
            className="inline-flex items-center gap-2 rounded-full border bg-fd-card/50 px-6 py-3 text-sm font-semibold backdrop-blur-sm transition-colors hover:bg-fd-accent"
          >
            ZBSearch vs Orama
          </Link>
          <a
            href="https://github.com/micheleriva/zbsearch"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border bg-fd-card/50 px-6 py-3 text-sm font-semibold text-fd-muted-foreground backdrop-blur-sm transition-colors hover:bg-fd-accent hover:text-fd-foreground"
          >
            <Github className="size-4" />
            GitHub
          </a>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-3 px-6 pb-14 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border bg-fd-card/40 p-5 text-center backdrop-blur-sm transition-colors hover:border-fd-primary/30 hover:bg-fd-card/70"
          >
            <p className="text-3xl font-bold tracking-tight text-fd-primary sm:text-4xl">
              {stat.value}
            </p>
            <p className="mt-1 text-sm font-medium">{stat.label}</p>
            <p className="mt-1 text-xs text-fd-muted-foreground">{stat.detail}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 pb-10">
        <div className="overflow-hidden rounded-2xl border bg-fd-card/50 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-2 border-b bg-fd-muted/30 px-4 py-3">
            <span className="size-2.5 rounded-full bg-red-500/80" />
            <span className="size-2.5 rounded-full bg-yellow-500/80" />
            <span className="size-2.5 rounded-full bg-green-500/80" />
            <span className="ml-2 text-xs text-fd-muted-foreground">app.ts</span>
          </div>
          <div className="[&_figure]:m-0 [&_figure]:rounded-none [&_figure]:border-0 [&_pre]:my-0 [&_pre]:rounded-none [&_pre]:border-0 [&_pre]:bg-transparent">
            <ServerCodeBlock
              lang="ts"
              code={exampleCode}
              codeblock={{ className: 'bg-transparent shadow-none' }}
            />
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 pb-20">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Everything you need to search
          </h2>
          <p className="mt-2 text-fd-muted-foreground">
            The same Orama API you know - faster internals, no vendor lock-in.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ title, description, icon: Icon, href }) => (
            <Link
              key={title}
              href={href}
              className="group rounded-2xl border bg-fd-card/30 p-5 text-left backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-fd-primary/25 hover:bg-fd-card/60 hover:shadow-md"
            >
              <div className="mb-4 inline-flex rounded-xl border bg-fd-background p-2.5 text-fd-primary transition-colors group-hover:border-fd-primary/30 group-hover:bg-fd-primary/10">
                <Icon className="size-5" />
              </div>
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-fd-muted-foreground">
                {description}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
