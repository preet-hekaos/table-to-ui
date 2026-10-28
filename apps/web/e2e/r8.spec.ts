import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { expectReadable, expectSection, openSection, run, signUpWithPack } from './helpers'

/** Set SHOTS_DIR to also save the screenshots as files. */
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png` })
}

test('Studio header: one toolbar, a section switcher, and the pipeline strip', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUpWithPack(page, `Header Co ${run}`, `header-${run}@header.test`)
  await page.goto('/studio?tab=data&table=candidate')

  await test.step('The nine tabs are gone; one switcher names the section', async () => {
    await expect(page.getByRole('tab', { name: 'Canvas' })).toHaveCount(0)
    await expectSection(page, 'Tables')
    await expect(page.getByRole('group', { name: 'Environments' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Set up by chat', exact: true })).toBeVisible()
    await expect(page.getByTestId('env-draft')).toBeVisible()
    await shot(page, 'r8-toolbar')
  })

  await test.step('The switcher groups the sections and marks where you are', async () => {
    await page.getByRole('button', { name: /Change section/ }).click()
    const nav = page.getByRole('navigation', { name: 'Studio sections' })
    for (const g of ['Build', 'Automate', 'Ship']) await expect(nav.getByText(g, { exact: true })).toBeVisible()
    await expect(nav.getByRole('button', { name: /^Tables/ })).toHaveAttribute('aria-current', 'true')
    await expect(nav.getByRole('button')).toHaveCount(8)
    await expectReadable(page, nav.getByRole('button', { name: /^Canvas/ }).locator('span').nth(1), ['rest'])
    await shot(page, 'r8-switcher')
    await page.keyboard.press('Escape')
    await expect(nav).toBeHidden()
  })

  await test.step('Moving between sections keeps the toolbar', async () => {
    await openSection(page, 'Versions')
    await expectSection(page, 'Versions')
    await expect(page).toHaveURL(/tab=versions/)
    await openSection(page, 'Canvas')
    await expectSection(page, 'Canvas')
    await page.getByRole('button', { name: 'Set up by chat', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Set up by chat', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })

  await test.step('Pattern library lives in the more menu', async () => {
    await page.getByRole('button', { name: 'More Studio links' }).click()
    await expect(page.getByRole('menuitem', { name: 'Pattern library' })).toHaveAttribute('href', '/patterns')
    await page.keyboard.press('Escape')
  })

  await test.step('Tables: the switcher sits in the header; the table and its parts share one row below', async () => {
    await openSection(page, 'Tables')
    const switcher = page.getByRole('button', { name: /Change section/ })
    const chat = page.getByRole('button', { name: 'Set up by chat', exact: true })
    const picker = page.getByRole('button', { name: /Change table/ })
    const parts = page.getByRole('tablist', { name: /parts/ })
    await expect(parts).toBeVisible()
    await expect(picker).toBeVisible()
    const [a, b, c, d] = await Promise.all([switcher.boundingBox(), chat.boundingBox(), picker.boundingBox(), parts.boundingBox()])
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(8) // switcher and chat button share the header row
    expect(a!.x).toBeLessThan(b!.x)
    expect(a!.y).toBeLessThan(c!.y) // the toolbar below holds only the table's own controls
    expect(Math.abs(c!.y - d!.y)).toBeLessThan(8)
    expect(c!.x).toBeLessThan(d!.x)
    await expect(page.getByRole('button', { name: 'Add field' })).toBeVisible()
    const rows = page.getByRole('table', { name: /fields/ }).locator('tbody tr')
    const h = (await rows.first().boundingBox())!.height
    expect(h, 'a compact field row').toBeLessThan(40)
    await page.getByRole('tab', { name: 'Features' }).click()
    await expect(page.getByTestId('features-panel')).toBeVisible()
    await expectReadable(page, page.getByRole('tab', { name: 'Fields' }), ['rest', 'hover'])
    await expectReadable(page, page.getByRole('tab', { name: 'Features' }), ['rest'])
    await expectReadable(page, switcher, ['rest', 'hover', 'focus'])
    await page.getByRole('tab', { name: 'Fields' }).click()
    await shot(page, 'r8-fields')
    await shot(page, 'r8-tables')
  })

  await test.step('No accessibility violations, with the switcher open too', async () => {
    let r = await new AxeBuilder({ page }).analyze()
    expect(r.violations).toEqual([])
    await page.getByRole('button', { name: /Change section/ }).click()
    r = await new AxeBuilder({ page }).analyze()
    expect(r.violations).toEqual([])
  })
})

test('Studio header fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await signUpWithPack(page, `Phone Co ${run}`, `phone-${run}@header.test`)
  await page.goto('/studio?tab=data&table=candidate')
  await page.getByRole('button', { name: /Change section/ }).click()
  await expect(page.getByRole('navigation', { name: 'Studio sections' }).getByRole('button', { name: /^Versions/ })).toBeVisible()
  await shot(page, 'r8-phone')
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  expect(wide).toBe(false)
})
