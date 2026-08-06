import { expect, test } from '@playwright/test'
import { openSearch, setDarkMode } from './helpers.js'

const LIGHT_SURFACE = 'rgb(255, 255, 255)'
const DARK_SURFACE = 'rgb(22, 18, 29)'

async function surface(page: import('@playwright/test').Page): Promise<string> {
  const box = await openSearch(page)

  return box.dialog.evaluate((node) => getComputedStyle(node).backgroundColor)
}

test.describe('a light site', () => {
  test.use({ colorScheme: 'dark' })

  test('stays light even when the operating system prefers dark', async ({ page }) => {
    await page.goto('/')
    await setDarkMode(page, false)

    expect(await surface(page)).toBe(LIGHT_SURFACE)
  })
})

test.describe('a dark site', () => {
  test.use({ colorScheme: 'light' })

  test('stays dark even when the operating system prefers light', async ({ page }) => {
    await page.goto('/')
    await setDarkMode(page, true)

    expect(await surface(page)).toBe(DARK_SURFACE)
  })
})

test('switching the site appearance re-themes the dialog', async ({ page }) => {
  await page.goto('/')
  await setDarkMode(page, false)

  expect(await surface(page)).toBe(LIGHT_SURFACE)

  await page.keyboard.press('Escape')
  await setDarkMode(page, true)

  expect(await surface(page)).toBe(DARK_SURFACE)
})
