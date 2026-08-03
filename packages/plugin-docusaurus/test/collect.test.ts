import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { type AllContent, collectRecords, collectSourceDocuments, resolveSourcePath } from '../src/node/collect.js'
import { resolveOptions } from '../src/node/options.js'

const options = resolveOptions()

async function siteWith(files: Record<string, string>): Promise<string> {
  const siteDir = await mkdtemp(path.join(tmpdir(), 'zbsearch-docusaurus-'))

  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(siteDir, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content, 'utf8')
  }

  return siteDir
}

function docsContent(docs: unknown[], version: Record<string, unknown> = {}): AllContent {
  return {
    'docusaurus-plugin-content-docs': {
      default: { loadedVersions: [{ isLast: true, label: 'Next', docs, ...version }] }
    }
  }
}

test('resolveSourcePath expands the @site alias', () => {
  assert.equal(resolveSourcePath('@site/docs/intro.md', '/site'), path.join('/site', 'docs/intro.md'))
})

test('resolveSourcePath leaves absolute paths alone', () => {
  assert.equal(resolveSourcePath('/elsewhere/intro.md', '/site'), '/elsewhere/intro.md')
})

test('collectSourceDocuments reads docs metadata', () => {
  const documents = collectSourceDocuments(
    docsContent([{ permalink: '/docs/intro', source: '@site/docs/intro.md', title: 'Intro', sourceDirName: '.' }]),
    '/site',
    options
  )

  assert.deepEqual(documents, [
    {
      permalink: '/docs/intro',
      file: path.join('/site', 'docs/intro.md'),
      title: 'Intro',
      breadcrumb: [],
      category: 'Docs'
    }
  ])
})

test('collectSourceDocuments turns the source directory into a breadcrumb', () => {
  const [document] = collectSourceDocuments(
    docsContent([
      { permalink: '/docs/g/d/vercel', source: '@site/docs/g/d/vercel.md', sourceDirName: 'guides/deploy-targets' }
    ]),
    '/site',
    options
  )

  assert.deepEqual(document.breadcrumb, ['Guides', 'Deploy Targets'])
})

test('collectSourceDocuments skips old docs versions by default', () => {
  const content: AllContent = {
    'docusaurus-plugin-content-docs': {
      default: {
        loadedVersions: [
          { isLast: true, label: 'Next', docs: [{ permalink: '/docs/a', source: '@site/a.md' }] },
          { isLast: false, label: '1.0', docs: [{ permalink: '/docs/1.0/a', source: '@site/v1/a.md' }] }
        ]
      }
    }
  }

  assert.deepEqual(
    collectSourceDocuments(content, '/site', options).map((document) => document.permalink),
    ['/docs/a']
  )
  const all = collectSourceDocuments(content, '/site', resolveOptions({ indexAllDocsVersions: true }))
  assert.deepEqual(
    all.map((document) => document.permalink),
    ['/docs/a', '/docs/1.0/a']
  )
  assert.deepEqual(all[1].breadcrumb, ['1.0'])
})

test('collectSourceDocuments reads blog metadata', () => {
  const documents = collectSourceDocuments(
    {
      'docusaurus-plugin-content-blog': {
        default: {
          blogPosts: [{ metadata: { permalink: '/blog/hello', source: '@site/blog/hello.md', title: 'Hello' } }]
        }
      }
    },
    '/site',
    options
  )

  assert.deepEqual(
    documents.map((document) => [document.permalink, document.title, document.category]),
    [['/blog/hello', 'Hello', 'Blog']]
  )
})

test('collectSourceDocuments indexes mdx pages and skips react pages', () => {
  const documents = collectSourceDocuments(
    {
      'docusaurus-plugin-content-pages': {
        default: [
          { type: 'mdx', permalink: '/about', source: '@site/src/pages/about.md' },
          { type: 'jsx', permalink: '/', source: '@site/src/pages/index.tsx' }
        ]
      }
    },
    '/site',
    options
  )

  assert.deepEqual(
    documents.map((document) => document.permalink),
    ['/about']
  )
})

test('collectSourceDocuments honours the content type switches', () => {
  const content: AllContent = {
    ...docsContent([{ permalink: '/docs/a', source: '@site/a.md' }]),
    'docusaurus-plugin-content-blog': {
      default: { blogPosts: [{ metadata: { permalink: '/blog/b', source: '@site/b.md' } }] }
    }
  }

  assert.deepEqual(
    collectSourceDocuments(content, '/site', resolveOptions({ blog: false })).map((item) => item.permalink),
    ['/docs/a']
  )
  assert.deepEqual(
    collectSourceDocuments(content, '/site', resolveOptions({ docs: false })).map((item) => item.permalink),
    ['/blog/b']
  )
})

test('collectSourceDocuments applies excludeRoutes globs', () => {
  const content = docsContent([
    { permalink: '/docs/public', source: '@site/a.md' },
    { permalink: '/docs/internal/secret', source: '@site/b.md' },
    { permalink: '/docs/internal/deep/secret', source: '@site/c.md' }
  ])

  assert.deepEqual(
    collectSourceDocuments(content, '/site', resolveOptions({ excludeRoutes: ['/docs/internal/**'] })).map(
      (item) => item.permalink
    ),
    ['/docs/public']
  )

  assert.deepEqual(
    collectSourceDocuments(content, '/site', resolveOptions({ excludeRoutes: ['/docs/internal/*'] })).map(
      (item) => item.permalink
    ),
    ['/docs/public', '/docs/internal/deep/secret']
  )
})

test('collectSourceDocuments de-duplicates permalinks across plugin instances', () => {
  const content: AllContent = {
    'docusaurus-plugin-content-docs': {
      default: { loadedVersions: [{ isLast: true, docs: [{ permalink: '/docs/a', source: '@site/a.md' }] }] },
      other: { loadedVersions: [{ isLast: true, docs: [{ permalink: '/docs/a', source: '@site/a.md' }] }] }
    }
  }

  assert.equal(collectSourceDocuments(content, '/site', options).length, 1)
})

test('collectSourceDocuments ignores entries missing a permalink or a source', () => {
  const content = docsContent([{ permalink: '/docs/a' }, { source: '@site/b.md' }, {}, null, 'nope'])
  assert.deepEqual(collectSourceDocuments(content, '/site', options), [])
})

test('collectSourceDocuments tolerates content plugins that are absent', () => {
  assert.deepEqual(collectSourceDocuments({}, '/site', options), [])
})

test('collectRecords turns a page into one record per section', async () => {
  const siteDir = await siteWith({
    'docs/search.md': [
      '---',
      'title: Search',
      '---',
      '',
      'ZBSearch supports several modes.',
      '',
      '## Vector search',
      '',
      'Embeddings and cosine similarity.',
      '',
      '### Tuning',
      '',
      'Pick a similarity threshold.'
    ].join('\n')
  })
  const { records, failures } = await collectRecords(
    docsContent([
      { permalink: '/docs/search', source: '@site/docs/search.md', title: 'Search', sourceDirName: 'guides' }
    ]),
    siteDir,
    options
  )

  assert.deepEqual(failures, [])
  assert.deepEqual(records, [
    {
      title: 'Search',
      section: '',
      hierarchy: 'Guides › Search',
      content: 'ZBSearch supports several modes.',
      url: '/docs/search',
      category: 'Docs',
      path: ''
    },
    {
      title: 'Search',
      section: 'Vector search',
      hierarchy: 'Guides › Search',
      content: 'Embeddings and cosine similarity.',
      url: '/docs/search#vector-search',
      category: 'Docs',
      path: ''
    },
    {
      title: 'Search',
      section: 'Tuning',
      hierarchy: 'Guides › Search › Vector search',
      content: 'Pick a similarity threshold.',
      url: '/docs/search#tuning',
      category: 'Docs',
      path: 'Vector search'
    }
  ])
})

test('collectRecords falls back to the title inside the file', async () => {
  const siteDir = await siteWith({ 'docs/a.md': '# From the heading\n\nBody.' })
  const { records } = await collectRecords(
    docsContent([{ permalink: '/docs/a', source: '@site/docs/a.md' }]),
    siteDir,
    options
  )

  assert.equal(records[0].title, 'From the heading')
})

test('collectRecords reports an unreadable file instead of failing the build', async () => {
  const siteDir = await siteWith({ 'docs/a.md': 'Body.' })
  const { records, failures } = await collectRecords(
    docsContent([
      { permalink: '/docs/a', source: '@site/docs/a.md' },
      { permalink: '/docs/missing', source: '@site/docs/missing.md' }
    ]),
    siteDir,
    options
  )

  assert.equal(records.length, 1)
  assert.equal(failures.length, 1)
  assert.ok(failures[0].file.endsWith('missing.md'))
})
