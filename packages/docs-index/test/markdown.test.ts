import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dialectOf, parseMarkdown, stripInlineMarkup } from '../src/markdown.js'

test('stripInlineMarkup keeps link labels and drops targets', () => {
  assert.equal(stripInlineMarkup('See the [install guide](/docs/install) first.'), 'See the install guide first.')
})

test('stripInlineMarkup drops images entirely', () => {
  assert.equal(stripInlineMarkup('Look ![a diagram](/img/d.png) here'), 'Look here')
})

test('stripInlineMarkup removes emphasis, code and strikethrough markers', () => {
  assert.equal(stripInlineMarkup('**bold** _thin_ `code` ~~gone~~'), 'bold thin code gone')
})

test('stripInlineMarkup removes html and jsx tags but keeps their text', () => {
  assert.equal(stripInlineMarkup('<Highlight color="#fd00ef">vector</Highlight> search'), 'vector search')
})

test('stripInlineMarkup removes mdx and html comments', () => {
  assert.equal(stripInlineMarkup('a {/* note */} b <!-- hidden --> c', { dialect: 'mdx' }), 'a b c')
})

test('stripInlineMarkup keeps a comment that only looks like one inside inline code', () => {
  assert.equal(
    stripInlineMarkup('Write `{/* a comment */}` to hide it.', { dialect: 'mdx' }),
    'Write {/* a comment */} to hide it.'
  )
})

test('stripInlineMarkup leaves an mdx comment alone in the md dialect', () => {
  assert.equal(stripInlineMarkup('a {/* note */} b'), 'a {/* note */} b')
})

test('stripInlineMarkup removes bare urls', () => {
  assert.equal(stripInlineMarkup('Read https://zbsearch.dev/docs for more'), 'Read for more')
})

test('stripInlineMarkup flattens tables into words', () => {
  const table = ['| Option | Default |', '| --- | --- |', '| language | english |'].join('\n')

  assert.equal(stripInlineMarkup(table), 'Option Default language english')
})

test('stripInlineMarkup removes list markers and quote markers', () => {
  assert.equal(stripInlineMarkup('- one\n2. two\n> quoted'), 'one two quoted')
})

test('stripInlineMarkup decodes the common html entities', () => {
  assert.equal(stripInlineMarkup('a&nbsp;b &amp; c &lt;d&gt;'), 'a b & c <d>')
})

test('parseMarkdown reads the title from front matter', () => {
  const { title } = parseMarkdown('---\ntitle: Getting Started\nsidebar_position: 1\n---\n\nHello.')
  assert.equal(title, 'Getting Started')
})

test('parseMarkdown unquotes a front matter title', () => {
  assert.equal(parseMarkdown('---\ntitle: "Vector Search"\n---\n').title, 'Vector Search')
})

test('parseMarkdown falls back to the first level-1 heading', () => {
  assert.equal(parseMarkdown('# Hybrid Search\n\nBody.').title, 'Hybrid Search')
})

test('parseMarkdown keeps front matter out of the content', () => {
  const { sections } = parseMarkdown('---\ntitle: T\ndescription: D\n---\n\nBody text.')
  assert.equal(sections.length, 1)
  assert.equal(sections[0].content, 'Body text.')
})

test('parseMarkdown emits an intro section for prose before the first heading', () => {
  const { sections } = parseMarkdown('Intro prose.\n\n## First\n\nSection prose.')
  assert.deepEqual(
    sections.map((section) => [section.heading, section.content]),
    [
      ['', 'Intro prose.'],
      ['First', 'Section prose.']
    ]
  )
})

test('parseMarkdown drops an empty intro section', () => {
  const { sections } = parseMarkdown('## First\n\nBody.')
  assert.deepEqual(
    sections.map((section) => section.heading),
    ['First']
  )
})

test('parseMarkdown keeps a heading whose body is empty', () => {
  const { sections } = parseMarkdown('## Reference\n\n### API\n\nBody.')
  assert.deepEqual(
    sections.map((section) => [section.heading, section.content]),
    [
      ['Reference', ''],
      ['API', 'Body.']
    ]
  )
})

test('parseMarkdown slugs headings the way docusaurus does', () => {
  const { sections } = parseMarkdown('## Vector Search\n\n## Full-Text Search!\n')
  assert.deepEqual(
    sections.map((section) => section.anchor),
    ['vector-search', 'full-text-search']
  )
})

test('parseMarkdown de-duplicates repeated heading anchors', () => {
  const { sections } = parseMarkdown('## Usage\n\na\n\n## Usage\n\nb\n')
  assert.deepEqual(
    sections.map((section) => section.anchor),
    ['usage', 'usage-1']
  )
})

test('parseMarkdown honours an explicit anchor', () => {
  const [section] = parseMarkdown('## Hybrid search {#hybrid}\n\nBody.').sections

  assert.equal(section.anchor, 'hybrid')
  assert.equal(section.heading, 'Hybrid search')
})

test('parseMarkdown records the ancestor chain of nested headings', () => {
  const { sections } = parseMarkdown(
    ['# Guides', 'a', '## Deployment', 'b', '### Vercel', 'c', '## Search', 'd'].join('\n\n')
  )

  assert.deepEqual(
    sections.map((section) => [section.heading, section.ancestors]),
    [
      ['Guides', []],
      ['Deployment', ['Guides']],
      ['Vercel', ['Guides', 'Deployment']],
      ['Search', ['Guides']]
    ]
  )
})

test('parseMarkdown ignores hashes inside fenced code', () => {
  const source = ['## Real heading', '', '```sh', '# not a heading', 'npm i zbsearch', '```', '', 'After.'].join('\n')
  const { sections } = parseMarkdown(source)
  assert.deepEqual(
    sections.map((section) => section.heading),
    ['Real heading']
  )
  assert.equal(sections[0].content, 'After.')
})

test('parseMarkdown handles tilde fences and longer backtick fences', () => {
  const source = ['~~~js', '## nope', '~~~', '', '````', '## also nope', '````', '', 'Prose.'].join('\n')

  assert.deepEqual(
    parseMarkdown(source).sections.map((section) => [section.heading, section.content]),
    [['', 'Prose.']]
  )
})

test('parseMarkdown drops mdx import and export statements', () => {
  const source = [
    "import Tabs from '@theme/Tabs'",
    'import {',
    '  TabItem,',
    '  Other',
    "} from '@theme/TabItem'",
    'export const meta = 1',
    '',
    'Actual prose.'
  ].join('\n')

  assert.deepEqual(
    parseMarkdown(source, { dialect: 'mdx' }).sections.map((section) => section.content),
    ['Actual prose.']
  )
})

test('parseMarkdown keeps admonition bodies and drops their markers', () => {
  const source = [':::tip', '', 'Use hybrid search.', '', ':::', '', 'After.'].join('\n')

  assert.equal(parseMarkdown(source).sections[0].content, 'Use hybrid search. After.')
})

test('parseMarkdown supports setext headings', () => {
  const { sections } = parseMarkdown('Intro.\n\nInstallation\n============\n\nRun npm i.')
  assert.deepEqual(
    sections.map((section) => [section.heading, section.level, section.content]),
    [
      ['', 0, 'Intro.'],
      ['Installation', 1, 'Run npm i.']
    ]
  )
})

test('parseMarkdown does not mistake a horizontal rule for a setext heading', () => {
  const { sections } = parseMarkdown('Intro.\n\n---\n\nMore.')
  assert.deepEqual(
    sections.map((section) => section.heading),
    ['']
  )
})

test('parseMarkdown strips trailing closing hashes from a heading', () => {
  assert.equal(parseMarkdown('## Setup ##\n\nBody.').sections[0].heading, 'Setup')
})

test('parseMarkdown returns nothing for an empty document', () => {
  assert.deepEqual(parseMarkdown('---\ntitle: T\n---\n').sections, [])
})

test('stripInlineMarkup keeps generics inside inline code', () => {
  assert.equal(
    stripInlineMarkup('Returns `Promise<Response>` and `Array<string>`.'),
    'Returns Promise<Response> and Array<string>.'
  )
})

test('parseMarkdown keeps md prose that starts with an esm keyword', () => {
  const { sections } = parseMarkdown('## Persist\n\nexport your index to disk.\nSecond line.', { dialect: 'md' })

  assert.equal(sections[0].content, 'export your index to disk. Second line.')
})

test('parseMarkdown drops an mdx export whose value contains a brace', () => {
  const source = ['## A', '', 'export const meta = {', "  title: 'a } b'", '}', '', 'Real prose.'].join('\n')

  assert.equal(parseMarkdown(source, { dialect: 'mdx' }).sections[0].content, 'Real prose.')
})

test('parseMarkdown reads a front matter title written as a block scalar', () => {
  assert.equal(parseMarkdown('---\ntitle: >-\n  Multi line title\n---\n\nBody.').title, 'Multi line title')
})

test('parseMarkdown ignores a title nested under another front matter key', () => {
  assert.equal(parseMarkdown('---\nhero:\n  title: Nested\nname: X\n---\n\nBody.').title, undefined)
})

test('parseMarkdown drops style and script blocks', () => {
  const { sections } = parseMarkdown('## A\n\n<style>{`.x{color:red}`}</style>\n\nProse.')

  assert.equal(sections[0].content, 'Prose.')
})

test('parseMarkdown keeps prose inside a multi line jsx block', () => {
  const source = ['## A', '', '<Tabs>', '  <TabItem value="a">Inner prose</TabItem>', '</Tabs>', '', 'After.'].join(
    '\n'
  )

  assert.equal(parseMarkdown(source, { dialect: 'mdx' }).sections[0].content, 'Inner prose After.')
})

test('parseMarkdown falls back when mdx cannot parse an explicit anchor', () => {
  const source = ["import Tabs from '@theme/Tabs'", '', '## Hybrid search {#hybrid}', '', 'Body.'].join('\n')
  const [section] = parseMarkdown(source, { dialect: 'mdx' }).sections

  assert.equal(section.anchor, 'hybrid')
  assert.equal(section.heading, 'Hybrid search')
  assert.equal(section.content, 'Body.')
})

test('parseMarkdown treats an indented block as code in md and as content in mdx', () => {
  const source = 'Intro.\n\n    # not a heading\n\nAfter.'

  assert.deepEqual(
    parseMarkdown(source, { dialect: 'md' }).sections.map((section) => section.heading),
    ['']
  )
  assert.deepEqual(
    parseMarkdown(source, { dialect: 'mdx' }).sections.map((section) => section.heading),
    ['', 'not a heading']
  )
})

test('parseMarkdown keeps a table row from running its cells together', () => {
  const source = ['## T', '', '| Option | Default |', '| --- | --- |', '| language | english |'].join('\n')

  assert.equal(parseMarkdown(source).sections[0].content, 'Option Default language english')
})

test('dialectOf picks mdx only for an mdx extension', () => {
  assert.equal(dialectOf('/docs/a.mdx'), 'mdx')
  assert.equal(dialectOf('/docs/a.md'), 'md')
  assert.equal(dialectOf(undefined), 'md')
})

test('parseMarkdown defaults to the md dialect, matching dialectOf', () => {
  const source = 'Intro.\n\n    # indented block\n\nAfter.'

  assert.deepEqual(parseMarkdown(source).sections, parseMarkdown(source, { dialect: dialectOf(undefined) }).sections)
})

test('parseMarkdown keeps inline code that looks like an mdx comment', () => {
  const source = '## A\n\nWrite `{/* a comment */}` to hide it.'

  assert.equal(parseMarkdown(source, { dialect: 'mdx' }).sections[0].content, 'Write {/* a comment */} to hide it.')
})
