# @zbsearch/highlight

Highlights the parts of a text that match a search term, and trims a long text down to an excerpt around
the first match.

It has no dependencies and no opinion about where the text came from, so it works just as well on the output
of [ZBSearch](https://zbsearch.dev) as on anything else.

## Installation

```sh
npm install @zbsearch/highlight
```

## Usage

```ts
import { Highlight } from '@zbsearch/highlight'

const result = new Highlight().highlight('The quick brown fox', 'quick')

result.HTML // 'The <mark class="zbsearch-highlight">quick</mark> brown fox'
result.positions // [{ start: 4, end: 8 }]
```

`positions` reports each match as a `{ start, end }` pair, with `end` pointing at the last character of the
match rather than past it. Use it when you need to render matches yourself, for example in a framework that
would otherwise need `dangerouslySetInnerHTML`.

### Excerpts

`trim` crops the text around its first match, adding an ellipsis on whichever side was cut:

```ts
new Highlight().highlight(longArticle, 'vector').trim(160)
```

A text that already fits is returned whole. When nothing matched, the opening `trimLength` characters are
kept instead.

## Options

```ts
new Highlight({
  caseSensitive: false,
  strategy: 'partialMatch',
  HTMLTag: 'mark',
  CSSClass: 'zbsearch-highlight'
})
```

| Option | Default | Description |
| --- | --- | --- |
| `caseSensitive` | `false` | Whether case has to match |
| `strategy` | `'partialMatch'` | How a term is matched against the text |
| `HTMLTag` | `'mark'` | Element wrapped around each match in `HTML` |
| `CSSClass` | `'zbsearch-highlight'` | Class set on that element |

### Strategies

Every term in the search string is matched independently; whitespace separates them.

| Strategy | Searching `vec` in `the vectorised store` |
| --- | --- |
| `wholeWordMatch` | nothing: `vec` is not a word here |
| `partialMatch` | `vec`, the term itself |
| `partialMatchFullWord` | `vectorised`, the whole word the term appears in |

`partialMatchFullWord` is the one to reach for alongside a search engine that expands prefixes: the engine
matched the whole word, so highlighting only the typed prefix would understate why the result is there.

## Styling

The `HTML` output carries a class rather than inline styles:

```css
.zbsearch-highlight {
  background: transparent;
  color: #a800e0;
  font-weight: 700;
}
```

## License

Apache-2.0
