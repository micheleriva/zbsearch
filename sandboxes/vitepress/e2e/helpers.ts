import { expect, type Locator, type Page } from '@playwright/test'

export function searchBox(page: Page) {
  const dialog = page.getByTestId('zbs-searchbox')

  return {
    button: page.getByTestId('zbs-search-button'),
    dialog,
    backdrop: page.getByTestId('zbs-searchbox-backdrop'),
    input: page.getByTestId('zbs-searchbox-input'),
    hits: dialog.getByTestId('zbs-hit'),
    groups: dialog.locator('.zbs-searchbox__group-title'),
    branding: page.getByTestId('zbs-searchbox-branding'),
    noResults: page.getByTestId('zbs-searchbox-no-results'),
    selected: dialog.locator('[data-selected="true"]')
  }
}

async function openWith(page: Page, act: () => Promise<void>): Promise<ReturnType<typeof searchBox>> {
  const box = searchBox(page)

  await box.button.waitFor()

  await expect(async () => {
    if ((await box.dialog.count()) === 0) {
      await act()
    }

    await expect(box.dialog).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })

  await expect(box.input).toBeFocused()

  return box
}

export function openSearch(page: Page): Promise<ReturnType<typeof searchBox>> {
  return openWith(page, () => searchBox(page).button.click({ timeout: 2000 }))
}

export function openSearchWithKey(page: Page, key: string): Promise<ReturnType<typeof searchBox>> {
  return openWith(page, () => page.keyboard.press(key))
}

export async function query(box: ReturnType<typeof searchBox>, term: string): Promise<void> {
  await box.input.fill(term)
  await expect(box.dialog.locator('.zbs-searchbox__list')).not.toHaveAttribute('data-state', 'loading')
}

export async function hitUrls(hits: Locator): Promise<string[]> {
  return hits.locator('.zbs-searchbox__hit-link').evaluateAll((nodes) =>
    nodes.map((node) => {
      const url = new URL((node as HTMLAnchorElement).href)

      return `${url.pathname}${url.hash}`
    })
  )
}

/** Drives VitePress's own appearance toggle and waits for it to settle. */
export async function setDarkMode(page: Page, dark: boolean): Promise<void> {
  const current = await page.locator('html').evaluate((node) => node.classList.contains('dark'))

  if (current !== dark) {
    const visibleSwitch = page.locator('.VPSwitchAppearance:visible').first()

    // Below a certain width VitePress folds the appearance switch into its
    // overflow menu, so open that first when the switch is not on screen.
    if ((await visibleSwitch.count()) === 0) {
      await page.locator('.VPNavBarExtra button:visible').first().click()
    }

    await visibleSwitch.click()
  }

  await expect(page.locator('html')).toHaveAttribute('data-theme', dark ? 'dark' : 'light')
}
