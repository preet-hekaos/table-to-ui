import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, signUpWithPack, setTableWide } from './helpers'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test('Table features: all on by default, set per table, applied to all, shown in Draft', async ({ page }) => {
  await signUpWithPack(page, `Features Co ${run}`, `features-${run}@features.test`)

  await test.step('A table starts with every feature on', async () => {
    await page.goto('/studio?tab=data&table=candidate&part=features')
    const panel = page.getByTestId('features-panel')
    await expect(panel.getByRole('switch')).toHaveCount(4)
    for (const sw of await panel.getByRole('switch').all()) await expect(sw).toBeChecked()
    await page.getByRole('button', { name: 'Bulk action options' }).click()
    await expect(page.getByLabel('Bulk actions include')).toHaveValue('view')
    await page.keyboard.press('Escape')
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/n5a-features.png` })
    const r = await new AxeBuilder({ page }).withTags(tags).analyze()
    expect(r.violations, r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
  })

  await test.step('Switch some off and choose options; saving makes a Draft change', async () => {
    await setTableWide(page, 'Group rows', false)
    await page.goto('/studio?tab=data&table=candidate&part=features')
    const panel = page.getByTestId('features-panel')
    await page.getByRole('button', { name: 'Bulk action options' }).click()
    await page.getByRole('checkbox', { name: 'Delete (with Undo)' }).uncheck()
    await page.getByLabel('Bulk actions include').selectOption('all')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Export options' }).click()
    await page.getByRole('checkbox', { name: 'Excel' }).uncheck()
    await page.keyboard.press('Escape')
    await panel.getByRole('button', { name: 'Save features' }).click()
    await expect(page.getByText('Saved features for Candidate').first()).toBeVisible()
    await page.reload()
    await setTableWide(page, 'Group rows', false)
    await page.goto('/studio?tab=data&table=candidate&part=features')
    await page.getByRole('button', { name: 'Bulk action options' }).click()
    await expect(page.getByRole('checkbox', { name: 'Delete (with Undo)' })).not.toBeChecked()
    await expect(page.getByLabel('Bulk actions include')).toHaveValue('all')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Export options' }).click()
    await expect(page.getByRole('checkbox', { name: 'Excel' })).not.toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'CSV' })).toBeChecked()
    await page.keyboard.press('Escape')
    await page.goto('/studio?tab=data&table=client&part=features')
    await expect(page.getByTestId('features-panel').getByRole('switch', { name: /Group rows/ })).toBeChecked()
  })

  await test.step('Apply to all tables', async () => {
    await page.goto('/studio?tab=data&table=candidate&part=features')
    await page.getByTestId('features-panel').getByRole('switch', { name: /Drag to reorder/ }).uncheck()
    await page.getByRole('button', { name: 'Apply to all tables' }).click()
    await expect(page.getByText('Applied to every table').first()).toBeVisible()
    await page.goto('/studio?tab=data&table=skill&part=features')
    await expect(page.getByTestId('features-panel').getByRole('switch', { name: /Drag to reorder/ })).not.toBeChecked()
  })

  await test.step('Lists carry a slim toolbar saying what is shown', async () => {
    const created = await page.evaluate(async () => {
      const res = await fetch('/v1/records/candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
        body: JSON.stringify({ data: { full_name: 'Toolbar Person', email: 'tb@example.in', phone: '+91 98450 12345', status: 'Active' } }),
      })
      return res.status
    })
    expect(created).toBe(201)
    await page.goto('/s/candidates')
    await expect(page.getByTestId('table-toolbar')).toContainText('1 candidate shown')
  })
})
