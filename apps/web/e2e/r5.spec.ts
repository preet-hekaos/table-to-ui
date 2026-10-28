import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { expectReadable, run, signUpWithPack } from './helpers'

const token = (page: Page) => page.evaluate(() => sessionStorage.getItem('tableui.token'))

/** Publish the Draft and make it Live, the way the Versions screen does. */
async function goLive(page: Page) {
  const t = await token(page)
  const rel = await page.evaluate(async (tk) => {
    const r = await fetch('/v1/apps/current/releases', { method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' } })
    return (await r.json()) as { version: number }
  }, t)
  const ok = await page.evaluate(async ([tk, v]) => (await fetch(`/v1/apps/current/releases/${v}/promote`, { method: 'POST', headers: { Authorization: `Bearer ${tk}` } })).status, [t, rel.version] as [string | null, number])
  expect(ok).toBeLessThan(300)
}

/** Set SHOTS_DIR to also save the screenshots as files. */
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png` })
}

test('Field grid: the owner decides what people can do with each field', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUpWithPack(page, `Grid Co ${run}`, `grid-${run}@grid.test`)
  const made = await page.evaluate(async () => {
    const rows = [['Asha Rao', 'Active', 24, 'Pune'], ['Bala Nair', 'Active', 60, 'Surat'], ['Chitra Iyer', 'Archived', 12, 'Goa']] as const
    const out: number[] = []
    for (const [i, [full_name, status, total_experience, location]] of rows.entries()) {
      const res = await fetch('/v1/records/candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
        body: JSON.stringify({ data: { full_name, status, total_experience, location, email: `g${i}@example.in`, phone: `+91 98450 3234${i}` } }),
      })
      out.push(res.status)
    }
    return out
  })
  expect(made).toEqual([201, 201, 201])

  await test.step('Before any change the list shows the automatic columns and tiles', async () => {
    await page.goto('/s/candidates')
    await expect(page.getByRole('columnheader', { name: /Location/ })).toBeVisible()
    const tile = page.getByTestId('stat-tile').first()
    await expect(tile).toContainText('Average')
    await expectReadable(page, tile.locator('p').first())
    await expectReadable(page, tile.locator('p').nth(1))
    await shot(page, 'r5-tiles')
  })

  await test.step('Set the grid in Studio', async () => {
    await page.goto('/studio?tab=data&table=candidate&part=features')
    const grid = page.getByTestId('field-grid')
    await expect(grid).toBeVisible()
    await expect(grid.getByRole('checkbox', { name: 'Show Full name by default' })).toBeDisabled()
    await grid.getByRole('checkbox', { name: 'Show Location by default' }).uncheck()
    await grid.getByRole('checkbox', { name: 'Edit Status in the list' }).uncheck()
    await grid.getByRole('checkbox', { name: 'Change Status for many rows' }).uncheck()
    await grid.getByRole('checkbox', { name: 'Export Phone' }).uncheck()
    await page.getByTestId('features-panel').getByLabel('Row density').selectOption('comfortable')
    for (const th of await grid.getByRole('columnheader').all()) await expectReadable(page, th)
    await shot(page, 'r5-grid')
    await testInfo.attach('grid', { body: await page.screenshot(), contentType: 'image/png' })
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
    await page.getByTestId('features-panel').getByRole('button', { name: 'Save features' }).click()
    await expect(page.getByText('Saved features for Candidate').first()).toBeVisible()
    await goLive(page)
  })

  await test.step('The list follows the grid', async () => {
    await page.goto('/s/candidates')
    await expect(page.getByRole('columnheader', { name: /Full name/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /Location/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Comfortable' })).toBeVisible()
    // Status can no longer be edited in the list.
    await page.getByRole('row', { name: /Asha Rao/ }).getByText('Active').dblclick()
    await expect(page.getByLabel('Status of Asha Rao')).toHaveCount(0)
    // A person can still add a column the owner did not show.
    await page.getByRole('button', { name: 'Columns' }).click()
    await page.getByRole('checkbox', { name: 'Location' }).check()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('columnheader', { name: /Location/ })).toBeVisible()
    await shot(page, 'r5-list')
    await testInfo.attach('list', { body: await page.screenshot(), contentType: 'image/png' })
  })

  await test.step('Bulk edit leaves Status out', async () => {
    await page.getByRole('row', { name: /Asha Rao/ }).getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Change a value' }).click()
    const options = await page.getByLabel('Field to change').locator('option').allTextContents()
    expect(options.join('|')).not.toContain('Status')
    expect(options.length).toBeGreaterThan(1)
  })
})
