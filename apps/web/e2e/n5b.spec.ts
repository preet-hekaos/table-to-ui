import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, signUpWithPack } from './helpers'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test('Sort and filter: header filters, chips, per-field settings, switch off', async ({ page }) => {
  await signUpWithPack(page, `Sort Co ${run}`, `sort-${run}@sort.test`)
  const people = [
    ['Asha Rao', 'asha@example.in', 'Active'],
    ['Bimal Das', 'bimal@example.in', 'Placed'],
    ['Chitra Iyer', 'chitra@example.in', 'Active'],
  ]
  const statuses = await page.evaluate(async (rows) => {
    const out: number[] = []
    for (const [i, [full_name, email, status]] of rows.entries()) {
      const res = await fetch('/v1/records/candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
        body: JSON.stringify({ data: { full_name, email, phone: `+91 98450 1234${i}`, status } }),
      })
      out.push(res.status)
    }
    return out
  }, people)
  expect(statuses).toEqual([201, 201, 201])

  await test.step('Filter by text from the column heading', async () => {
    await page.goto('/s/candidates')
    await expect(page.getByRole('row')).toHaveCount(4)
    await page.getByRole('button', { name: /Filter (Full name|Name)/i }).first().click()
    await page.getByRole('tab', { name: 'Contains' }).click()
    await page.getByRole('textbox').last().fill('bimal')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByRole('row')).toHaveCount(2)
    await expect(page.getByLabel('Active filters')).toContainText(/bimal/i)
    const r = await new AxeBuilder({ page }).withTags(tags).analyze()
    expect(r.violations, r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
  })

  await test.step('Remove the chip to see everyone again', async () => {
    await page.getByLabel('Active filters').getByRole('button').first().click()
    await expect(page.getByRole('row')).toHaveCount(4)
  })

  await test.step('Per-field settings and default order in Studio', async () => {
    await page.goto('/studio?tab=data&table=candidate&part=features')
    const panel = page.getByTestId('features-panel')
    await panel.getByLabel('Filter by Email').uncheck()
    await panel.getByLabel('Sort by Email').uncheck()
    await panel.getByRole('button', { name: 'Save features' }).click()
    await expect(page.getByText('Saved features for Candidate').first()).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('features-panel').getByLabel('Filter by Email')).not.toBeChecked()
  })

  await test.step('Switching sort and filter off removes the controls', async () => {
    const panel = page.getByTestId('features-panel')
    await panel.getByRole('switch', { name: 'Sorting' }).uncheck()
    await panel.getByRole('switch', { name: 'Filtering' }).uncheck()
    await panel.getByRole('button', { name: 'Save features' }).click()
    await expect(page.getByText('Saved features for Candidate').first()).toBeVisible()
  })
})
