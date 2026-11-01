import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, signUpWithPack, setTableWide } from './helpers'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test('Group rows: choose a field, open and close headings, switch off', async ({ page }) => {
  await signUpWithPack(page, `Group Co ${run}`, `group-${run}@group.test`)
  const made = await page.evaluate(async () => {
    const out: number[] = []
    for (const [i, [name, status]] of [['Asha Rao', 'Active'], ['Bimal Das', 'Placed'], ['Chitra Iyer', 'Active'], ['Dev Patel', 'Archived']].entries()) {
      const res = await fetch('/v1/records/candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
        body: JSON.stringify({ data: { full_name: name, email: `g${i}@example.in`, phone: `+91 98450 1234${i}`, status } }),
      })
      out.push(res.status)
    }
    return out
  })
  expect(made).toEqual([201, 201, 201, 201])
  await page.goto('/s/candidates')
  await expect(page.getByRole('row')).toHaveCount(5)

  await test.step('Group by a field: a heading per value with its count', async () => {
    await page.getByLabel('Group by').selectOption({ label: 'Status' })
    await expect(page.getByRole('table').getByRole('button', { name: /Active \(2\)/ })).toBeVisible()
    await expect(page.getByRole('table').getByRole('button', { name: /Placed \(1\)/ })).toBeVisible()
    await expect(page.getByRole('table').getByRole('button', { name: /Archived \(1\)/ })).toBeVisible()
    const r = await new AxeBuilder({ page }).withTags(tags).analyze()
    expect(r.violations, r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
  })

  await test.step('Close a heading to hide its rows, open it again', async () => {
    await page.getByRole('table').getByRole('button', { name: /Active \(2\)/ }).click()
    await expect(page.getByRole('table').getByRole('button', { name: /Active \(2\)/ })).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('row', { name: /Asha Rao/ })).toHaveCount(0)
    await expect(page.getByRole('row', { name: /Bimal Das/ })).toBeVisible()
    await page.getByRole('button', { name: 'Expand all groups' }).click()
    await expect(page.getByRole('row', { name: /Asha Rao/ })).toBeVisible()
    await page.getByRole('button', { name: 'Collapse all groups' }).click()
    await expect(page.getByRole('row', { name: /Bimal Das/ })).toHaveCount(0)
  })

  await test.step('No grouping puts the list back', async () => {
    await page.getByLabel('Group by').selectOption('')
    await expect(page.getByRole('row')).toHaveCount(5)
  })

  await test.step('Switching it off removes the control', async () => {
    await setTableWide(page, 'Group rows', false)
  })
})
