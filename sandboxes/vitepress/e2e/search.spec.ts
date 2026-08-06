import { expect, test } from '@playwright/test'
import { hitUrls, openSearch, openSearchWithKey, query, searchBox } from './helpers.js'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('the navbar exposes the ZBSearch button instead of the built-in search', async ({ page }) => {
  const box = searchBox(page)

  await expect(box.button).toBeVisible()
  await expect(box.button).toContainText('Search')
  // VitePress always renders the slot wrapper; what matters is that its own
  // search UI never mounted into it.
  await expect(page.locator('.VPNavBarSearch')).toBeEmpty()
  await expect(page.locator('.DocSearch-Button, .VPLocalSearchBox, #local-search')).toHaveCount(0)
  await expect(box.dialog).toHaveCount(0)
})

test('the button opens the dialog and Escape closes it', async ({ page }) => {
  const box = await openSearch(page)

  await page.keyboard.press('Escape')
  await expect(box.dialog).toHaveCount(0)
  await expect(box.button).toBeFocused()
})

test('the keyboard shortcut opens the dialog', async ({ page }) => {
  const box = await openSearchWithKey(page, 'ControlOrMeta+k')

  await expect(box.input).toBeFocused()
})

test('the slash shortcut opens the dialog', async ({ page }) => {
  await openSearchWithKey(page, '/')
})

test('clicking the backdrop closes the dialog', async ({ page }) => {
  const box = await openSearch(page)

  await box.backdrop.click({ position: { x: 8, y: 8 } })
  await expect(box.dialog).toHaveCount(0)
})

test('the dialog is announced as a modal search dialog', async ({ page }) => {
  const box = await openSearch(page)

  await expect(box.dialog).toHaveAttribute('aria-modal', 'true')
  await expect(box.input).toHaveAttribute('role', 'combobox')
})

test('the footer credits ZBSearch and shows its logo', async ({ page }) => {
  const box = await openSearch(page)

  await expect(box.branding).toContainText('Search by')
  await expect(box.branding).toHaveAttribute('href', 'https://zbsearch.dev')
  await expect(box.branding.getByRole('img', { name: 'ZBSearch' })).toBeVisible()
})

test('searching finds docs content and groups it by page', async ({ page }) => {
  const box = await openSearch(page)

  await query(box, 'embeddings')

  await expect(box.hits.first()).toBeVisible()
  await expect(box.groups.filter({ hasText: 'Vector Search' })).toHaveCount(1)
  expect(await hitUrls(box.hits)).toContain('/guides/vector-search#embeddings')
})

test('matches are highlighted in the results', async ({ page }) => {
  const box = await openSearch(page)

  await query(box, 'cosine')

  await expect(box.hits.first().locator('mark').first()).toHaveText(/cosine/i)
})

test('several sections of one page share a single group heading', async ({ page }) => {
  const box = await openSearch(page)

  await query(box, 'search')

  const headings = await box.groups.locator('.zbs-searchbox__group-name').allInnerTexts()

  expect(headings.length).toBe(new Set(headings).size)
})

test('results carry the content type of the page they come from', async ({ page }) => {
  const box = await openSearch(page)

  await query(box, 'embeddings')

  await expect(box.groups.locator('.zbs-searchbox__group-tag').first()).toHaveText('Docs')
})

test('the home page is indexed at the site root', async ({ page }) => {
  const box = await openSearch(page)

  await query(box, 'kilobytes')

  expect(await hitUrls(box.hits)).toContain('/#installation')
})

test('the arrow keys move the selection and Enter opens it', async ({ page }) => {
  const box = await openSearch(page)

  await query(box, 'vector')
  await expect(box.selected).toHaveCount(1)

  await page.keyboard.press('ArrowDown')

  const target = await box.selected.locator('.zbs-searchbox__hit-link').getAttribute('href')

  await page.keyboard.press('Enter')

  await expect(box.dialog).toHaveCount(0)
  await expect(page).toHaveURL(new URL(target as string, page.url()).toString())
})

test('the selection wraps around at the end of the list', async ({ page }) => {
  const box = await openSearch(page)

  await query(box, 'similarity')

  const first = await box.selected.locator('.zbs-searchbox__hit-title').innerText()
  const count = await box.hits.count()

  for (let index = 0; index < count; index++) {
    await page.keyboard.press('ArrowDown')
  }

  await expect(box.selected.locator('.zbs-searchbox__hit-title')).toHaveText(first)
})

test('the active option is reported to assistive technology', async ({ page }) => {
  const box = await openSearch(page)

  await query(box, 'vector')

  await expect(box.selected).toHaveCount(1)
  expect(await box.input.getAttribute('aria-activedescendant')).toBe(await box.selected.getAttribute('id'))

  await page.keyboard.press('ArrowDown')

  expect(await box.input.getAttribute('aria-activedescendant')).toBe(await box.selected.getAttribute('id'))
})

test('clicking a result navigates to it', async ({ page }) => {
  const box = await openSearch(page)

  await query(box, 'threshold')

  await box.hits.filter({ hasText: 'Choosing a threshold' }).first().click()

  await expect(page).toHaveURL(/\/guides\/vector-search#choosing-a-threshold$/)
  await expect(page.getByRole('heading', { name: 'Choosing a threshold' })).toBeVisible()
})

test('an unknown term reports that nothing was found', async ({ page }) => {
  const box = await openSearch(page)

  await query(box, 'quokkaflange')

  await expect(box.noResults).toBeVisible()
  await expect(box.noResults).toContainText('quokkaflange')
  await expect(box.hits).toHaveCount(0)
})

test('excluded routes are absent from the index', async ({ page }) => {
  const box = await openSearch(page)

  await query(box, 'zsonorbit')

  await expect(box.noResults).toBeVisible()
})

test('mdx imports and admonition markers are kept out of the index', async ({ page }) => {
  const box = await openSearch(page)

  await query(box, 'nowhere')

  await expect(box.noResults).toBeVisible()
})

test('clearing the query returns the dialog to its start state', async ({ page }) => {
  const box = await openSearch(page)

  await query(box, 'vector')
  await expect(box.hits.first()).toBeVisible()

  await box.input.fill('')

  await expect(box.hits).toHaveCount(0)
  await expect(box.dialog).toContainText('Start typing')
})

test('an opened result comes back as a recent search', async ({ page }) => {
  const box = await openSearch(page)

  await query(box, 'embeddings')
  await box.hits.first().click()

  await openSearch(page)

  await expect(box.dialog).toContainText('Recent')
  await expect(box.hits).toHaveCount(1)
  expect(await hitUrls(box.hits)).toContain('/guides/vector-search#embeddings')
})

test('a recent search can be removed', async ({ page }) => {
  const box = await openSearch(page)

  await query(box, 'embeddings')
  await box.hits.first().click()

  await openSearch(page)
  await expect(box.hits).toHaveCount(1)

  await box.dialog.getByRole('button', { name: /Remove this search/i }).click()

  await expect(box.hits).toHaveCount(0)
  await expect(box.dialog).toContainText('Start typing')
})

test('the index is not inlined into the page', async ({ page }) => {
  expect(await page.content()).not.toContain('searchableProperties')

  const box = await openSearch(page)

  await query(box, 'vector')
  await expect(box.hits.first()).toBeVisible()
})

test('search works from a docs page, not just the home page', async ({ page }) => {
  await page.goto('/reference/api')

  const box = await openSearch(page)

  await query(box, 'insertMultiple')

  expect(await hitUrls(box.hits)).toContain('/reference/api#insert')
})
