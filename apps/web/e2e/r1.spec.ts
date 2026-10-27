import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { run, signUpWithPack } from './helpers'

test('Sidebar: full, rail, hidden, remembered, full screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUpWithPack(page, `Rail Co ${run}`, `rail-${run}@rail.test`)
  const side = page.locator('[data-sidebar]')
  const main = page.locator('#main')
  await expect(side).toHaveAttribute('data-sidebar', 'expanded')
  const full = (await side.boundingBox())!.width
  expect(full).toBeGreaterThan(200)
  const mainFull = (await main.boundingBox())!.width

  // Collapse to the icon rail: labels stay available by name, the main area grows.
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(side).toHaveAttribute('data-sidebar', 'collapsed')
  await expect.poll(async () => (await side.boundingBox())!.width).toBeLessThan(80)
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Studio', exact: true })).toBeVisible()
  expect((await main.boundingBox())!.width).toBeGreaterThan(mainFull + 100)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Studio', exact: true }).hover()
  await expect(page.getByText('Studio', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  const rail = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(rail.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])

  // The choice is remembered across a reload.
  await page.reload()
  await expect(side).toHaveAttribute('data-sidebar', 'collapsed')

  // Ctrl+B steps rail -> hidden -> full.
  await page.keyboard.press('Control+b')
  await expect(page.locator('aside')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
  expect((await main.boundingBox())!.width).toBeGreaterThan(1400)
  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Studio', exact: true })).toBeVisible()
  await page.locator('aside').getByRole('button', { name: 'Close menu' }).click()
  await expect(page.locator('aside')).toBeHidden()
  await page.keyboard.press('Control+b')
  await expect(side).toHaveAttribute('data-sidebar', 'expanded')


  // Full screen hides the frame and Esc brings it back, without changing the saved choice.
  await page.getByRole('button', { name: 'Full screen' }).click()
  await expect(page.locator('aside')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Exit full screen' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('aside')).toBeVisible()
  await expect(side).toHaveAttribute('data-sidebar', 'expanded')
})

test('Sidebar on a phone is still an overlay menu with no collapse control', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await signUpWithPack(page, `Phone Co ${run}`, `phone-${run}@rail.test`)
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Studio', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toHaveCount(0)
})
