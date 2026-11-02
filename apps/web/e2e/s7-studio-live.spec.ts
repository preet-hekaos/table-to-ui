import { expect, test } from '@playwright/test'
import { openSection, run, signUpWithPack } from './helpers'
import { freshSession, publishLive } from './live-effect'

test('Menu: rename, reorder, remove and add reach the live app after publish', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1500, height: 1100 })
  await signUpWithPack(page, `Menu Live ${run}`, `ml-${run}@studio.test`)
  await page.goto('/studio')
  await openSection(page, 'Menu')

  await test.step('Rename, move down, remove one entry, and save to Draft', async () => {
    await page.getByLabel('Label for Candidates').fill('Talent')
    await page.getByRole('button', { name: 'Move Talent down' }).click()
    await page.getByRole('button', { name: 'Remove Consent records' }).click()
    await page.getByRole('button', { name: 'Save menu' }).click()
    await expect(page.getByText('Menu saved in Draft').first()).toBeVisible()
  })

  const rec = await freshSession(browser, page)
  await test.step('Live is unchanged until publish', async () => {
    await rec.goto('/')
    await expect(rec.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Candidates', exact: true })).toBeVisible()
  })

  await test.step('After publish the live menu shows the new name, order, and no removed entry', async () => {
    await publishLive(page)
    await rec.goto('/')
    const links = rec.getByRole('navigation', { name: 'Main' }).getByRole('link')
    await expect(links.filter({ hasText: /^Talent$/ })).toBeVisible()
    await expect(links.filter({ hasText: /^Candidates$/ })).toHaveCount(0)
    await expect(rec.getByRole('link', { name: 'Consent records' })).toHaveCount(0)
    const names = (await links.allTextContents()).map((t) => t.trim())
    expect(names.indexOf('Talent'), names.join(' / ')).toBeGreaterThan(0)
  })

  await test.step('The removed entry can be added back from the screens list', async () => {
    await openSection(page, 'Menu')
    await page.getByLabel('Add a screen to the menu').selectOption({ label: 'Consent records' })
    await page.getByRole('button', { name: 'Save menu' }).click()
    await expect(page.getByText('Menu saved in Draft').first()).toBeVisible()
    await publishLive(page)
    await rec.goto('/')
    await expect(rec.getByRole('link', { name: 'Consent records' })).toBeVisible()
  })
})

test('Screens: title, grouping and empty-state text reach the live screen after publish', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1500, height: 1100 })
  await signUpWithPack(page, `Screen Live ${run}`, `sl-${run}@studio.test`)
  await page.goto('/studio?tab=data&table=candidate&part=screens')
  await page.getByLabel('Screen to configure').selectOption({ label: 'Candidates' })
  await page.getByLabel('Screen settings').getByLabel('Title', { exact: true }).fill('Talent pool')
  await page.getByLabel('Empty-state text').fill('Nobody in the pool yet')
  await page.getByRole('button', { name: 'Save screen' }).click()
  await expect(page.getByText('Saved Talent pool in Draft').or(page.getByText(/Saved .* in Draft/)).first()).toBeVisible()
  await publishLive(page)
  const rec = await freshSession(browser, page)
  await rec.goto('/s/candidates')
  await expect(rec.getByRole('heading', { name: 'Talent pool' })).toBeVisible()
  await expect(rec.getByText('Nobody in the pool yet')).toBeVisible()
})
