import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { expectReadable, run, signUpWithPack } from './helpers'

test('Excel-style column filter: values with counts, search, select all, sort, Contains, clear', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUpWithPack(page, `Excel Co ${run}`, `excel-${run}@excel.test`)
  const rows = [
    ['Asha Rao', 'Infosys', 'Active'],
    ['Bimal Das', 'Infosys', 'Placed'],
    ['Chitra Iyer', 'Wipro', 'Active'],
    ['Dev Patel', 'TCS', 'Active'],
  ]
  const made = await page.evaluate(async (data) => {
    const out: number[] = []
    for (const [i, [full_name, current_employer, status]] of data.entries()) {
      const res = await fetch('/v1/records/candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
        body: JSON.stringify({ data: { full_name, current_employer, email: `x${i}@example.in`, phone: `+91 98450 2234${i}`, status } }),
      })
      out.push(res.status)
    }
    return out
  }, rows)
  expect(made).toEqual([201, 201, 201, 201])
  await page.goto('/s/candidates')
  await expect(page.getByRole('row')).toHaveCount(5)
  const panel = page.getByRole('dialog', { name: /^Filter / })

  await test.step('Status lists its values with counts, everything ticked', async () => {
    await page.getByRole('button', { name: 'Filter Status' }).click()
    await expect(panel.getByRole('checkbox', { name: /Select all/ })).toBeChecked()
    await expect(panel.getByRole('checkbox', { name: /^Active\s*3$/ })).toBeChecked()
    await expect(panel.getByRole('checkbox', { name: /^Placed\s*1$/ })).toBeChecked()
    await expectReadable(page, panel.getByRole('button', { name: 'Apply' }))
    await testInfo.attach('filter-panel', { body: await page.screenshot(), contentType: 'image/png' })
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  })

  await test.step('Untick one value and Apply: the list narrows and a chip appears', async () => {
    await panel.getByRole('checkbox', { name: /^Placed/ }).uncheck()
    await panel.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByRole('row')).toHaveCount(4)
    await expect(page.getByLabel('Active filters')).toContainText('Status: Active')
  })

  await test.step('Counts follow the other filters; this column keeps showing all its values', async () => {
    await page.getByRole('button', { name: 'Filter Current employer' }).click()
    await expect(panel.getByRole('checkbox', { name: /^Wipro\s*1$/ })).toBeVisible()
    await expect(panel.getByRole('checkbox', { name: /^Infosys\s*1$/ })).toBeVisible() // Bimal is Placed, so only Asha counts
    await panel.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('button', { name: 'Filter Status' }).click()
    await expect(panel.getByRole('checkbox', { name: /^Placed\s*1$/ })).not.toBeChecked() // still listed, not ticked
    await panel.getByRole('button', { name: 'Clear' }).click()
    await expect(page.getByRole('row')).toHaveCount(5)
  })

  await test.step('Search the values; the typed result becomes the choice', async () => {
    await page.getByRole('button', { name: 'Filter Current employer' }).click()
    await panel.getByRole('searchbox', { name: /Search .* values/ }).fill('inf')
    await expect(panel.getByRole('checkbox', { name: /^Wipro/ })).toHaveCount(0)
    await expect(panel.getByRole('checkbox', { name: /Select all results/ })).toBeChecked()
    await panel.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByRole('row')).toHaveCount(3)
    await expect(page.getByLabel('Active filters')).toContainText('Infosys')
  })

  await test.step('Select all then none: Apply waits for at least one value', async () => {
    await page.getByRole('button', { name: 'Filter Current employer' }).click()
    await panel.getByRole('checkbox', { name: /Select all/ }).uncheck()
    await expect(panel.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await expect(panel.getByRole('status')).toContainText('Tick at least one value')
    await panel.getByRole('checkbox', { name: /^Wipro/ }).check()
    await panel.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByRole('row')).toHaveCount(2)
  })

  await test.step('Sort from the filter menu', async () => {
    await page.getByLabel('Active filters').getByRole('button').first().click()
    await page.getByRole('button', { name: 'Filter Full name' }).click()
    await panel.getByRole('button', { name: 'Sort Z to A' }).click()
    await expect(page.getByRole('row').nth(1)).toContainText('Dev Patel')
    await page.getByRole('button', { name: 'Filter Full name' }).click()
    await expect(panel.getByRole('button', { name: 'Sort Z to A' })).toHaveAttribute('aria-pressed', 'true')
    await panel.getByRole('button', { name: 'Sort A to Z' }).click()
    await expect(page.getByRole('row').nth(1)).toContainText('Asha Rao')
  })

  await test.step('Contains still works on text columns', async () => {
    await page.getByRole('button', { name: 'Filter Current employer' }).click()
    await panel.getByRole('tab', { name: 'Contains' }).click()
    await panel.getByRole('textbox', { name: /contains/ }).fill('tcs')
    await panel.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByRole('row')).toHaveCount(2)
    await expect(page.getByLabel('Active filters')).toContainText('contains “tcs”')
  })
})
