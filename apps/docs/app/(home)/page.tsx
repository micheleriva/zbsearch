import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { ServerCodeBlock } from 'fumadocs-ui/components/codeblock.rsc';
import { cn } from '@/lib/cn';
import { QualitySpeedChart } from '@/components/benchmarks/quality-speed-chart';
import { SearchBoxDemo, type SearchBoxDemoDoc } from '@/components/searchbox-demo';
import { CloudflareIcon } from '@/components/icons/cloudflare';
import { DocusaurusIcon } from '@/components/icons/docusaurus';
import { StarlightIcon } from '@/components/icons/starlight';
import { VitePressIcon } from '@/components/icons/vitepress';
import { source } from '@/lib/source';
import {
  ArrowRight,
  BarChart3,
  Filter,
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

const features: { title: string; description: string; icon: LucideIcon; href: string }[] = [
  {
    title: 'Full-Text Search',
    description: 'Typo-tolerant BM25 with stemming in 30+ languages.',
    icon: Search,
    href: '/docs/zbsearch/search',
  },
  {
    title: 'Vector Search',
    description: 'Fast similarity search with optional IVF indexing.',
    icon: Sparkles,
    href: '/docs/zbsearch/search/vector-search',
  },
  {
    title: 'Hybrid Search',
    description: 'Combine keyword and semantic relevance in one query.',
    icon: Zap,
    href: '/docs/zbsearch/search/hybrid-search',
  },
  {
    title: 'Search Filters',
    description: 'Filter by numbers, enums, booleans, and nested fields.',
    icon: Filter,
    href: '/docs/zbsearch/search/filters',
  },
  {
    title: 'Geosearch',
    description: 'Radius, polygon, and sorted geo queries on BKD trees.',
    icon: MapPin,
    href: '/docs/zbsearch/search/geosearch',
  },
  {
    title: 'Results Pinning',
    description: 'Merchandising rules to boost or pin specific results.',
    icon: Pin,
    href: '/docs/zbsearch/results-pinning',
  },
  {
    title: 'Facets',
    description: 'Aggregate counts across categories at search time.',
    icon: Layers,
    href: '/docs/zbsearch/search/facets',
  },
  {
    title: 'Fields Boosting',
    description: 'Weight schema properties to shape ranking.',
    icon: TrendingUp,
    href: '/docs/zbsearch/search/fields-boosting',
  },
  {
    title: 'Typo Tolerance',
    description: 'Forgiving matching powered by Levenshtein distance.',
    icon: Wand2,
    href: '/docs/zbsearch/search#typo-tolerance',
  },
  {
    title: 'BM25',
    description: 'Industry-standard ranking out of the box.',
    icon: BarChart3,
    href: '/docs/zbsearch/search/bm25',
  },
  {
    title: '30+ Languages',
    description: 'Tokenization and stemming for global text search.',
    icon: Globe2,
    href: '/docs/zbsearch/supported-languages',
  },
  {
    title: 'Plugin System',
    description: 'Extend indexing, search, and persistence with hooks.',
    icon: Puzzle,
    href: '/docs/zbsearch/plugins',
  },
];

type Integration = {
  name: string;
  tag: string;
  description: string;
  /** Brand logo; omit for an integration with no mark of its own. */
  icon?: ComponentType<{ className?: string }>;
  /** Package to install; omit while the integration is still unreleased. */
  install?: string;
  /** Guide to link to; omit to render the cell as an unlinked "Soon" teaser. */
  href?: string;
};

const integrations: Integration[] = [
  {
    name: 'Docusaurus',
    tag: 'Docusaurus v3',
    icon: DocusaurusIcon,
    description:
      'Indexes your docs, blog posts, and MDX pages while Docusaurus builds, then replaces the default search bar with a ZBSearch dialog.',
    install: '@zbsearch/plugin-docusaurus',
    href: '/docs/zbsearch/integrations/docusaurus',
  },
  {
    name: 'Starlight',
    tag: 'Astro Starlight',
    icon: StarlightIcon,
    description:
      "Swaps Starlight's built-in Pagefind search for the same dialog, wired into your content collections.",
    install: '@zbsearch/plugin-starlight',
    href: '/docs/zbsearch/integrations/starlight',
  },
  {
    name: 'VitePress',
    tag: 'VitePress',
    icon: VitePressIcon,
    description:
      'Builds the index from VitePress’ own content loader, so results follow your srcDir, cleanUrls, and base exactly as the router does.',
    install: '@zbsearch/plugin-vitepress',
    href: '/docs/zbsearch/integrations/vitepress',
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

/**
 * A full-bleed horizontal band. The rule runs edge to edge like the header's
 * while the content stays in the 6xl column, so the page reads as a stack of
 * separated bands rather than one continuous scroll.
 */
function Band({
  children,
  className,
  inner,
}: {
  children: ReactNode;
  className?: string;
  inner?: string;
}) {
  return (
    <section className={cn('w-full border-b border-fd-border', className)}>
      <div className={cn('mx-auto w-full max-w-6xl px-6 py-16 sm:py-20', inner)}>
        {children}
      </div>
    </section>
  );
}

/** Mono micro-label that names the band above its heading. */
function BandLabel({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-fd-muted-foreground">
      {children}
    </p>
  );
}

/** Real docs pages, handed to the demo so it indexes something worth searching. */
function searchDemoDocs(): SearchBoxDemoDoc[] {
  return source.getPages().map((page) => ({
    id: page.url,
    url: page.url,
    title: page.data.title,
    section: page.slugs[0] === 'cloudflare' ? 'Cloudflare' : 'ZBSearch',
    snippet: page.data.description,
  }));
}

export default async function HomePage() {
  return (
    <div className="flex flex-1 flex-col">
      <Band
        className="relative overflow-hidden"
        inner="flex flex-col items-center py-20 text-center sm:py-24"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-24 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-fd-primary/10 blur-3xl" />
          <div className="absolute top-10 -right-24 h-72 w-72 rounded-full bg-fd-primary/5 blur-3xl" />
          <div className="absolute top-24 -left-24 h-64 w-64 rounded-full bg-fd-primary/5 blur-3xl" />
        </div>

        <h1 className="max-w-4xl text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
          Come for the speed,
          <span className="block bg-gradient-to-r from-fd-foreground via-fd-foreground to-fd-muted-foreground bg-clip-text text-transparent">
            stay for the quality.
          </span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-fd-muted-foreground sm:text-xl">
          A zero-bs fork of Orama maintained by the original team. <br />
          Full-text, vector, and hybrid search in your browser, server, or edge - in less than 2kb.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs/zbsearch"
            className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-6 py-3 text-sm font-semibold text-fd-primary-foreground shadow-[0_0_24px_-6px] shadow-fd-primary/50 transition-colors hover:bg-fd-primary/90"
          >
            Get Started
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/docs/cloudflare"
            className="inline-flex items-center gap-2 rounded-lg border border-[#F6821F] bg-fd-card/50 px-6 py-3 text-sm font-semibold backdrop-blur-sm transition-colors hover:border-[#e86f0f] hover:bg-[#F6821F]/10"
          >
            <CloudflareIcon className="size-4" />
            Deploy to Cloudflare
          </Link>
        </div>
      </Band>

      <Band>
        <div className="mb-6 text-center">
          <BandLabel>Benchmarks</BandLabel>
        </div>
        <QualitySpeedChart />
      </Band>

      <Band>
        <div className="mb-8 text-center">
          <BandLabel>Features</BandLabel>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Everything you need to search
          </h2>
          <p className="mt-2 text-fd-muted-foreground">
            The same Orama API you know - faster internals, no vendor lock-in.
          </p>
        </div>

        {/* Same hairline grid as the integrations band: gap-px over a
            border-coloured backdrop draws the dividers, so the cards read as one
            block instead of twelve floating tiles. 12 items divides evenly by
            1, 2 and 3, so no empty cell ever exposes the backdrop. */}
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-fd-border bg-fd-border sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ title, description, icon: Icon, href }) => (
            <Link
              key={title}
              href={href}
              className="flex flex-col bg-fd-background p-6 text-left transition-colors hover:bg-fd-muted/60"
            >
              <Icon className="size-5 shrink-0 text-fd-primary" />
              <h3 className="mt-3 text-lg font-semibold tracking-tight">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-fd-muted-foreground">
                {description}
              </p>
            </Link>
          ))}
        </div>
      </Band>

      <Band>
        <div className="mb-8 text-center">
          <BandLabel>API</BandLabel>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            As simple as it gets
          </h2>
          <p className="mt-2 text-fd-muted-foreground">
            Just create an instance, insert your data, and start searching. No server, no database, no hassle.
          </p>
        </div>
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
      </Band>

      {/* The demo needs the side-by-side layout to make its point; below lg it
          collapses into a tall stack that reads worse than not showing it. */}
      <Band className="max-lg:hidden">
        <div className="mb-8 text-center">
          <BandLabel>Search box</BandLabel>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Headless, so it looks like your site
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-fd-muted-foreground">
            <code className="font-mono text-[0.9em]">@zbsearch/searchbox-react</code> ships the
            behaviour - searching, grouping, keyboard nav, a11y. The look is a handful of CSS
            variables. Switch themes and type; the index is running in your browser.
          </p>
        </div>

        <SearchBoxDemo docs={searchDemoDocs()} />
      </Band>

      <Band className="border-b-0">
        <div className="mb-8 text-center">
          <BandLabel>Integrations</BandLabel>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            ZBSearch for Docs
          </h2>
          <p className="mt-2 text-fd-muted-foreground">
            Install one package and your existing site searches like this one.
          </p>
        </div>

        {/* gap-px over a border-coloured backdrop draws the hairlines between
            cells; the column count matches the item count so no empty cell is
            ever left showing that backdrop. */}
        {/* Three up only once a cell is wide enough for the install command to
            fit unclipped; a single column below that. */}
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-fd-border bg-fd-border lg:grid-cols-3">
          {integrations.map((integration) => (
            <IntegrationCell key={integration.name} {...integration} />
          ))}
        </div>

        <p className="mt-6 text-center text-sm text-fd-muted-foreground">
          <Link
            href="/docs/zbsearch/integrations"
            className="underline underline-offset-4 transition-colors hover:text-fd-primary"
          >
            See all integrations
          </Link>{' '}
          - including the standalone React and Vue search boxes, and the markdown indexer they share.
        </p>
      </Band>
    </div>
  );
}

function IntegrationCell({ name, tag, description, icon: Icon, install, href }: Integration) {
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        {Icon && <Icon className="size-5 shrink-0 object-contain" />}
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-fd-muted-foreground">
          {tag}
        </span>
        {!href && (
          <span className="rounded-sm border border-fd-border px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.08em] text-fd-muted-foreground">
            Soon
          </span>
        )}
      </div>

      <h3 className="mt-3 text-lg font-semibold tracking-tight">{name}</h3>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-fd-muted-foreground">
        {description}
      </p>

      {install ? (
        <code className="mt-5 block overflow-x-auto whitespace-nowrap rounded-md border border-fd-border bg-fd-muted px-3 py-2 font-mono text-xs text-fd-foreground">
          npm install {install}
        </code>
      ) : (
        <span className="mt-5 block rounded-md border border-dashed border-fd-border px-3 py-2 font-mono text-xs text-fd-muted-foreground">
          In progress
        </span>
      )}

      {href && (
        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-fd-primary">
          Read the guide
          <ArrowRight className="size-3.5 transition-transform group-hover/cell:translate-x-0.5" />
        </span>
      )}
    </>
  );

  const className = 'flex flex-col bg-fd-background p-6';

  if (!href) {
    return <div className={className}>{body}</div>;
  }

  return (
    <Link href={href} className={`group/cell ${className} transition-colors hover:bg-fd-muted/60`}>
      {body}
    </Link>
  );
}
