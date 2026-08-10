# Atlas Help Center — a ZBSearch semantic and hybrid search demo

A help center that runs the same query three ways and shows you the difference:

|              |                                            |                           |
| ------------ | ------------------------------------------ | ------------------------- |
| **Keyword**  | BM25 over an inverted index                | finds the words you typed |
| **Semantic** | cosine similarity over sentence embeddings | finds what you meant      |
| **Hybrid**   | both rankings, normalised and blended      | finds either              |

Everything happens in the tab. The index is built on page load, the document vectors are
bundled with it, and query embeddings are produced locally by a transformer in a Web
Worker. There is no server and nothing you type leaves the browser.

```sh
pnpm --filter @zbsearch/demo-semantic dev   # http://localhost:3002
```

## The point

Neither keyword nor semantic search is sufficient on its own, and the demo is built so you
can watch both of them fail.

Search **`i can't log in`** in Keyword mode. Nothing in the corpus says "log in" — the
articles all say "sign in" — so after stop-word removal the only term left is `log`, and
you get the article about _diagnostic logs_. Switch to Semantic and the right article is
first.

Now search **`429`**. Semantic returns nothing at all: a bare status code carries no
meaning for an encoder to work with, and no document clears the similarity floor. Keyword
finds it instantly, because that is exactly what an inverted index is for.

Hybrid answers both. That is the entire argument, and **Compare** puts the three rankings
side by side so you can see where they disagree.

## Measured, not asserted

`scripts/evaluate.mjs` scores the 18 curated queries in [`data/queries.json`](data/queries.json)
against all three modes, using the same schema, tokeniser and defaults the browser uses.

```sh
pnpm --filter @zbsearch/demo-semantic evaluate
```

| mode     | answer ranked first | answer in top 10 | MRR       |
| -------- | ------------------- | ---------------- | --------- |
| Keyword  | 11/18               | 17/18            | 0.691     |
| Semantic | **17/18**           | 17/18            | **0.944** |
| Hybrid   | 16/18               | **18/18**        | 0.935     |

Hybrid is the only mode that answers every query, and that is the column that matters: a
mode which returns nothing has no rank to average. Semantic edges it on MRR by 0.009 while
failing outright on `429`.

Hybrid is not uniformly better and the script shows that too. On `the app is draining my
battery` pure semantic puts the right article first and hybrid drops it to third, because
the lexical half has an opinion and is wrong. Blending is insurance against a mode failing
completely, paid for with a little precision when both modes work.

## What it demonstrates

| Feature                | Where to see it                                    | API                                  |
| ---------------------- | -------------------------------------------------- | ------------------------------------ |
| Vector search          | The Semantic mode                                  | `search({ mode: 'vector', vector })` |
| Hybrid search          | The Hybrid mode                                    | `search({ mode: 'hybrid' })`         |
| Blend weights          | Console → Ranking → `hybridWeights`                | `search({ hybridWeights })`          |
| Similarity floor       | Console → Ranking → `similarity`                   | `search({ similarity })`             |
| Filtered vector search | Pick an area in the sidebar while in Semantic mode | `search({ mode: 'vector', where })`  |
| Nearest neighbours     | "Related articles" at the foot of any article      | `search({ mode: 'vector', vector })` |
| Facets over any mode   | The counts in the sidebar                          | `search({ facets })`                 |
| Field boosting         | Console → Ranking → `boost.*`                      | `search({ boost })`                  |
| Typo tolerance         | Console → Ranking → `tolerance`                    | `search({ tolerance })`              |
| Stop words             | 33 languages available; English is on              | `components.tokenizer.stopWords`     |
| Match highlighting     | The marks on keyword and hybrid hits               | `@zbsearch/highlight`                |
| Throughput             | Console → Throughput                               | —                                    |

Filters are worth singling out. `where` is evaluated **before** the vector index is
consulted, so narrowing to one area makes semantic search consider fewer candidates rather
than filtering its output afterwards.

The related-articles list is the quietest demonstration here and possibly the most useful.
It is a vector search with no query and no encoder: the article's own stored embedding is
handed straight back to the index, and the nearest neighbours fall out. "More like this" is
the same feature as semantic search, pointed at a document instead of at a sentence
somebody typed.

## Why not `@zbsearch/plugin-embeddings`

The obvious choice would have been our own plugin, which generates embeddings locally with
Universal Sentence Encoder. It was measured against the alternatives on a support-KB probe
of 15 paraphrase queries, of the kind this demo is built on:

| encoder                             | dimensions | answer ranked first |
| ----------------------------------- | ---------- | ------------------- |
| USE (`@zbsearch/plugin-embeddings`) | 512        | 10/15               |
| `bge-small-en-v1.5`                 | 384        | 13/15               |
| `gte-small`                         | 384        | 14/15               |
| **`all-MiniLM-L6-v2`**              | **384**    | **15/15**           |

USE is a 2018 model and it shows: it put "Configuring single sign-on with SAML" first for
_add a colleague to my account_, and the article on updating a card first for _how do I get
a receipt for accounting_. Those are the exact queries this demo exists to get right, so it
uses `all-MiniLM-L6-v2` through transformers.js instead.

Nothing about that choice is specific to ZBSearch. The engine takes a `vector` like any
other parameter and never sees the model — swapping encoders means changing one file.

**This is worth acting on separately:** `plugin-embeddings` is pinned to a model that is no
longer competitive, and it carries a stray `console.log` on every search
([`packages/plugin-embeddings/src/index.ts`](../../packages/plugin-embeddings/src/index.ts)).

## The corpus

150 help-center articles for a product that does not exist, in
[`data/articles.json`](data/articles.json). They were written for this demo rather than
sourced, for two reasons: no licensing question, and full control over the vocabulary gap
that makes the comparison legible. Articles use product and technical language; the curated
queries use the words a frustrated person actually types.

Both halves of the corpus are committed, so the demo runs offline apart from the one-time
model download.

```sh
pnpm --filter @zbsearch/demo-semantic corpus   # re-embed after editing articles.json
```

`build-corpus.mjs` writes `data/embeddings.json`: 150 × 384 int8 components — 56 KB of
vector data, 77 KB once base64 encoded into JSON. Quantising to int8 keeps the cosine
between a vector and its round trip above 0.9999 and moved no ranking in the evaluation.
The components of a unit vector never approach ±1, so the scale is taken from the observed
maximum rather than fixed at 127, which is what buys that precision back.

The file also carries a hash of the article text. Edit an article without re-running the
script and the console says so, because stale vectors are otherwise invisible: search keeps
working and quietly ranks against the previous wording.

## Two numbers that will surprise you

**`similarity` defaults to 0.8 in ZBSearch, and 0.2 here.** That default suits encoders
whose unrelated pairs already score around 0.7. With this model they do not: measured over
the curated queries, the right article scores between 0.39 and 0.74 — except for `429`,
which manages 0.15 — while the best wrong article sits between 0.14 and 0.48. At 0.8 this
demo would return nothing at all, ever. The floor is a property of the encoder, not of the
engine, and the console exposes it as a slider for that reason.

0.2 came out of a sweep: it keeps every query's answer except `429`, whose 0.15 is
indistinguishable from that query's noise floor of 0.14, and leaves around nine articles to
rank. Below it, unrelated articles start arriving.

**Typo tolerance is off by default.** An edit distance of 1 is cheap insurance on long words
and actively harmful on short ones — it makes `429` match `428`. This corpus is full of
short identifiers on purpose.

## The encoder

`all-MiniLM-L6-v2`, quantised to int8, about 23 MB, fetched from the Hugging Face CDN on
first use and cached by the browser afterwards. It is loaded lazily: nothing is downloaded
until you focus the search box, and Keyword mode never needs it at all.

It runs in a Web Worker, on WebGPU where the browser offers it and WASM otherwise. Encoding
a query takes roughly 20 ms on WebGPU against roughly 40 μs for the search that follows —
three orders of magnitude apart, which is why the throughput benchmark excludes it and the
encoder panel reports it separately.

## Layout

```
app/         Next.js entry, global CSS
components/  The product — topbar, sidebar, home, results, result-row, article-view,
             compare-view, mode-switch — and the console: search-console, encoder-panel,
             tuning-panel, index-panel, benchmark-panel, query-inspector, ui
lib/         encoder.ts (worker client), engine.ts (index and queries), corpus.ts,
             schema.mjs and embedding-text.mjs (shared with the scripts)
workers/     The encoder worker
scripts/     build-corpus.mjs, evaluate.mjs
data/        articles.json (source), embeddings.json (generated), queries.json
```

The page is an ordinary help center: browse by area, read an article, follow a related one.
Nothing above the console mentions a cosine. Everything that explains how the search works
lives in the drawer along the bottom, and everything in it is live — move a boost and the
list behind it re-orders.

`schema.mjs` and `embedding-text.mjs` are plain JavaScript rather than TypeScript on
purpose. The Node scripts and the browser bundle both import them, which is what guarantees
that the evaluation measures the index the demo actually runs and that a document is
described to the encoder the same way at build time and at query time.

Each mode owns a colour and keeps it everywhere it appears — the switch, the score bars,
the compare columns, the console readouts: **amber** for keyword, **teal** for semantic,
**blue** for hybrid, which is also the product accent because hybrid is the mode this
product would ship with. The three hues sit far enough apart to stay legible in a 3px score
bar, which is the smallest place any of them has to work.

The app is light only. The console is the deliberate exception — a dark instrument panel,
the way developer tooling has always looked.
