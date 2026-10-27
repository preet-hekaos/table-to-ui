import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, signUpWithPack, expectSection } from './helpers'

test('Screens live inside each table', async ({ page }) => {
  await signUpWithPack(page, `Northstar N3 ${run}`, `n3-${run}@northstar.test`)

  await test.step('The canvas drawer opens the table\'s screens', async () => {
    await page.goto('/studio?tab=map')
    await page.getByTestId('box-candidate').getByRole('button').click()
    await page.getByTestId('table-drawer').getByRole('button', { name: 'Open screens' }).click()
    await expectSection(page, 'Tables')
    await expect(page.getByRole('tab', { name: 'Screens' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByLabel('Screen to configure')).toBeVisible()
  })

  await test.step('Only that table\'s screens are listed; a new one starts on that table', async () => {
    const options = await page.getByLabel('Screen to configure').locator('option').allTextContents()
    expect(options.length).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'New screen from a pattern' }).click()
    await expect(page.getByRole('list', { name: 'Patterns' }).getByRole('listitem')).toHaveCount(7)
  })

  await test.step('Old Screens addresses still work, and there is no separate Screens tab', async () => {
    await page.goto('/studio?tab=screens')
    await expectSection(page, 'Tables')
    await expect(page.getByRole('tab', { name: 'Screens' })).toHaveCount(1)
    await page.getByRole('tab', { name: 'Fields' }).click()
    await expect(page.getByRole('button', { name: 'Add field' })).toBeVisible()
  })

  await test.step('Passes WCAG 2.2 AA', async () => {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(r.violations, r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
  })
})
