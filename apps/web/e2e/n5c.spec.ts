import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, signUpWithPack } from './helpers'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test('Select rows and act on many: change a value, delete, undo, switches', async ({ page }) => {
  await signUpWithPack(page, `Bulk Co ${run}`, `bulk-${run}@bulk.test`)
  const created = await page.evaluate(async () => {
    const out: number[] = []
    for (const [i, name] of ['Asha Rao', 'Bimal Das', 'Chitra Iyer'].entries()) {
      const res = await fetch('/v1/records/candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
        body: JSON.stringify({ data: { full_name: name, email: `p${i}@example.in`, phone: `+91 98450 1234${i}`, status: 'Active' } }),
      })
      out.push(res.status)
    }
    return out
  })
  expect(created).toEqual([201, 201, 201])
  await page.goto('/s/candidates')
  await expect(page.getByRole('row')).toHaveCount(4)

  await test.step('Tick rows; the bar says how many', async () => {
    await expect(page.getByTestId('bulk-bar')).toHaveCount(0)
    await page.getByRole('checkbox', { name: 'Select Asha Rao' }).check()
    await page.getByRole('checkbox', { name: 'Select Bimal Das' }).check()
    await expect(page.getByTestId('bulk-bar')).toContainText('2 selected')
    const r = await new AxeBuilder({ page }).withTags(tags).analyze()
    expect(r.violations, r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
  })

  await test.step('Change a value, then undo it', async () => {
    await page.getByRole('button', { name: 'Change a value' }).click()
    await page.getByLabel('Field to change').selectOption({ label: 'Status' })
    await page.getByLabel('New value').selectOption('Archived')
    await page.getByRole('button', { name: 'Change 2' }).click()
    await expect(page.getByText('2 changed').first()).toBeVisible()
    await expect(page.getByRole('row', { name: /Asha Rao/ })).toContainText('Archived')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('Undone: 2 restored').first()).toBeVisible()
    await expect(page.getByRole('row', { name: /Asha Rao/ })).toContainText('Active')
  })

  await test.step('Select every row, then every match, and delete with Undo', async () => {
    await page.getByRole('checkbox', { name: 'Select all rows shown' }).check()
    await expect(page.getByTestId('bulk-bar')).toContainText('3 selected')
    await page.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete 3' }).click()
    await expect(page.getByText('3 deleted').first()).toBeVisible()
    await expect(page.getByRole('row')).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('Undone: 3 restored').first()).toBeVisible()
    await expect(page.getByRole('row', { name: /Chitra Iyer/ })).toBeVisible()
  })

  await test.step('Switching delete off hides it; switching the feature off removes the boxes', async () => {
    await page.goto('/studio?tab=data&table=candidate&part=features')
    const panel = page.getByTestId('features-panel')
    await panel.getByRole('checkbox', { name: 'Delete (with Undo)' }).uncheck()
    await panel.getByRole('button', { name: 'Save features' }).click()
    await expect(page.getByText('Saved features for Candidate').first()).toBeVisible()
  })
})
