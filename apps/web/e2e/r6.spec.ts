import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { expectReadable, openTables, run, schemaAction, signUpWithPack } from './helpers'

/** Set SHOTS_DIR to also save the screenshots as files. */
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png` })
}

test('Studio tables: a picker and a menu instead of a side panel; chips instead of checkboxes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUpWithPack(page, `Chips Co ${run}`, `chips-${run}@chips.test`)
  await page.goto('/studio?tab=data&table=candidate')

  await test.step('There is no side list; the table is chosen from a searchable picker', async () => {
    await expect(page.getByRole('navigation', { name: 'Tables' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Table: Candidate/ })).toBeVisible()
    const nav = await openTables(page)
    await shot(page, 'r6-picker')
    await page.getByLabel('Search tables').fill('cli')
    await expect(nav.getByRole('button', { name: /Client/ })).toBeVisible()
    await expect(nav.getByRole('button', { name: /Candidate/ })).toHaveCount(0)
    await page.getByLabel('Search tables').fill('zzz')
    await expect(page.getByText('No table matches')).toBeVisible()
    await page.getByLabel('Search tables').fill('requirement')
    await nav.getByRole('button', { name: /Requirement/ }).first().click()
    await expect(page.getByRole('button', { name: /Table: Requirement/ })).toBeVisible()
  })

  await test.step('New table is up front; the schema actions sit in the More menu', async () => {
    await expect(page.getByRole('button', { name: 'New table' })).toBeVisible()
    await page.getByRole('button', { name: 'More table actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Import schema' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Export schema' })).toBeVisible()
    await shot(page, 'r6-more')
    await page.keyboard.press('Escape')
    await schemaAction(page, 'Export schema')
    await expect(page.getByRole('dialog', { name: 'Export schema' })).toBeVisible()
    await page.keyboard.press('Escape')
  })

  await test.step('Features: chips, with the same names for assistive tools', async () => {
    await page.goto('/studio?tab=data&table=candidate&part=features')
    const panel = page.getByTestId('features-panel')
    const sw = panel.getByRole('switch', { name: /Group rows/ })
    await expect(sw).toBeChecked()
    await expect(panel.locator('input[type="checkbox"]')).toHaveCount(0)
    const grid = panel.getByTestId('field-grid')
    const sort = grid.getByRole('checkbox', { name: 'Sort by Email' })
    await expect(sort).toBeChecked()
    await expectReadable(page, sort) // on
    await sort.uncheck()
    await expect(sort).not.toBeChecked()
    await expectReadable(page, sort) // off
    await expectReadable(page, sw)
  })

  await test.step('Hovering a chip explains it', async () => {
    const grid = page.getByTestId('field-grid')
    await grid.getByRole('checkbox', { name: 'Export Email' }).hover()
    await expect(page.getByRole('tooltip').filter({ hasText: 'Include this field when people export rows.' }).first()).toBeVisible()
    await page.getByTestId('features-panel').getByRole('switch', { name: /Export data/ }).uncheck()
    await grid.getByRole('checkbox', { name: 'Export Email' }).hover({ force: true })
    await expect(page.getByRole('tooltip').filter({ hasText: 'Switch on "Export data" above first.' }).first()).toBeVisible()
    await page.getByTestId('features-panel').getByRole('switch', { name: /Export data/ }).check()
    await page.mouse.move(0, 0)
    await shot(page, 'r6-features')
    await testInfo.attach('features', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  })
})
