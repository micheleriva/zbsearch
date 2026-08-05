# OneStore — a ZBSearch ecommerce demo

A storefront where the entire search stack runs in the browser on
[ZBSearch](https://zbsearch.dev). There is no API and no server round trip: the index is
built on page load from a bundled catalog, and every keystroke calls `search()` as a plain
synchronous function.

```sh
pnpm --filter @zbsearch/demo-ecommerce dev   # http://localhost:3001
```

## Two halves

**The shop** is the whole page: departments, a home page with trending and deals rows, a
faceted results page, a cart and a saved list. It never mentions relevance tuning.

**The search console** is the docked strip along the bottom. Open it and a drawer shows
what the shop is actually running — index stats, merchandising rules, boost weights,
matching parameters, a benchmark, and the exact `search()` call behind whatever is on
screen. Everything in it is live: change a boost and the grid behind it re-orders.

## What it demonstrates

| Feature | Where to see it | API |
| --- | --- | --- |
| Results pinning (merchandising) | Console → Merchandising. Pinned products wear a "Featured" badge in the shop | `insertPin` / `deletePin` |
| Field boosting | Console → Field boosting. Search `leather`, drag `description` up | `search({ boost })` |
| Facets | Category and brand counts in the results sidebar | `search({ facets })` |
| Filters | Price, rating, availability, and the department nav | `search({ where })` |
| Sorting | The sort dropdown, and the home page's trending / deals rows | `search({ sortBy })` |
| Typo tolerance | Search `lether bag` | `search({ tolerance })` |
| Exact match | Console → Matching | `search({ exact })` |
| Threshold | Search `blue cotton shirt`, pull the slider to 1 | `search({ threshold })` |
| Autocomplete | The dropdown under the search box | `suggest` |
| Match highlighting | The marks in titles and brands | `@zbsearch/highlight` |
| Throughput | Console → Benchmark | — |

### Pinning rules

Four rules ship in [`lib/pins.ts`](lib/pins.ts), each showing off a different part of the
API:

- **`gift_guide`** — no product in the catalog describes itself as a gift, so relevance
  has nothing to rank. Three promoted documents turn the query into a landing page.
- **`laptop_hero`** — overrides BM25, which would otherwise lead with the two products
  that have "Laptop" in the title.
- **`iphone_upsell`** — `starts_with` anchoring, so it only fires when the query opens
  with "iphone".
- **`luxury_watches`** — two conditions, implicitly ANDed.

Pins are applied after filtering and sorting, so a pinned product surfaces even when it
does not match the query or the active filters. That is deliberate — merchandising is
supposed to win — but it is worth knowing when you write rules.

## The catalog

194 products with images, from the public [DummyJSON](https://dummyjson.com) dataset. Both
`data/catalog.json` and `public/products/*.webp` are committed, so the demo runs offline.
To refresh them:

```sh
pnpm --filter @zbsearch/demo-ecommerce catalog
```

`brand` and `category` are each indexed twice: as `string`, which full-text search and
boosting run against, and as `enum` (`brandKey`, `categoryKey`), which filters and facets
run against. Enums match on exact values, so they are immune to stemming.

The 24 categories are grouped into six departments in [`lib/departments.ts`](lib/departments.ts)
for the nav; picking one sets a `where` filter over every category it contains.

## A note on the timings

The console shows what ZBSearch itself reports for the last query. In a browser that
number comes from `performance.now()`, which is clamped to roughly 100μs — an order of
magnitude coarser than a single query over this catalog, so single readings are quantised.

The benchmark works around it by timing a whole pass over 16 terms as one sample and
dividing back down. On a 2024 MacBook Pro that lands around 90,000 queries per second,
with a mean near 11μs.

Category and brand facets are computed disjunctively — selecting "Laptops" must not zero
out every other category — so each rendered results page is actually three `search()`
calls, two of them `preflight`. The console's "round trip" stat covers all three.

## Layout

```
app/         Next.js app router entry, global CSS
components/  Shop chrome (site-header, home-sections, product-card, filter-rail,
             cart, site-footer) and the console (search-console, engine-console,
             merchandising-panel, benchmark-panel, query-inspector, ui)
lib/         Index creation, query building, pinning rules, departments, catalog
scripts/     Catalog builder
data/        Generated catalog (committed)
```

Both light and dark themes follow `prefers-color-scheme`; there is no toggle. The console
stays dark in both.

Product data and imagery come from DummyJSON and are used here for demonstration only.
Nothing ships and no payment is ever taken.
