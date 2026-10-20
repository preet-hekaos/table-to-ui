import { expect, test } from '@playwright/test'
import { run, signUpWithPack } from './helpers'

// A 1x1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

/** M1-S02 home and checklist, S06 branding, S07 regional formats. */
test('Home checklist, branding with logo and accent, Indian formats', async ({ page }) => {
  await signUpWithPack(page, `Brand Co ${run}`, `brand-${run}@brand.test`)

  await test.step('S02. Home shows the app version and the setup checklist', async () => {
    await expect(page.getByTestId('app-version')).toContainText('v1')
    const list = page.getByTestId('setup-checklist')
    await expect(list).toContainText('0 of 4 done')
    for (const item of ['Import your data', 'Invite your team', 'Set roles and permissions', 'Brand the app']) await expect(list).toContainText(item)
  })

  await test.step('S06. Weak accent is refused with a passing shade offered', async () => {
    await page.getByRole('link', { name: 'Brand the app' }).click()
    await expect(page.getByRole('tab', { name: 'Branding' })).toHaveAttribute('aria-selected', 'true')
    await page.getByLabel('Accent colour').fill('#7dd3fc')
    await page.getByRole('button', { name: 'Save branding' }).click()
    const offer = page.getByRole('button', { name: /^Use #/ })
    await expect(offer).toBeVisible()
    await offer.click()
  })

  await test.step('S06. Logo, app name and accent reach the app frame', async () => {
    await page.getByLabel(/^Logo/).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG })
    await expect(page.getByRole('img', { name: 'Current logo' })).toBeVisible()
    await page.getByLabel('App name').fill('Brand Hire')
    await page.getByRole('button', { name: 'Save branding' }).click()
    await expect(page.getByText('Branding saved').first()).toBeVisible()
    await expect(page.getByTestId('app-name')).toHaveText('Brand Hire')
    await expect(page.getByTestId('app-logo')).toBeVisible()
    const accent = await page.locator('[data-theme="agency"]').evaluate((el) => getComputedStyle(el).getPropertyValue('--agency-accent'))
    expect(accent.trim()).not.toBe('')
    await page.goto('/')
    await expect(page.getByTestId('setup-checklist')).toContainText('1 of 4 done')
  })

  await test.step('S07. Money reads as rupees and LPA; dates as 19 Oct 2026', async () => {
    await page.goto('/records/client/new')
    await page.getByLabel(/^Name/).fill('Zen Retail')
    await page.getByRole('button', { name: 'Save client' }).click()
    await expect(page.getByRole('heading', { name: 'Zen Retail' })).toBeVisible()
    await page.goto('/records/requirement/new')
    await page.getByLabel(/^Title/).fill('Data Engineer')
    await page.getByLabel(/^Client( \*)?$/).selectOption({ label: 'Zen Retail' })
    await page.getByLabel(/^Budget up to/).fill('12.5 LPA')
    await page.getByLabel(/^Target date/).fill('2026-10-19')
    await page.getByRole('button', { name: 'Save requirement' }).click()
    await expect(page.getByText('₹12,50,000 · 12.5 LPA')).toBeVisible()
    await expect(page.getByText('19 Oct 2026')).toBeVisible()
  })
})
