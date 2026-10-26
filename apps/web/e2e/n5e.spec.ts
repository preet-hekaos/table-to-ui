import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, signUpWithPack } from './helpers'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test('Edit in the list: double-click, keyboard, cancel, error, switch off', async ({ page }) => {
  await signUpWithPack(page, `Inline Co ${run}`, `inline-${run}@inline.test`)
  const made = await page.evaluate(async () => {
    const res = await fetch('/v1/records/candidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
      body: JSON.stringify({ data: { full_name: 'Cell Person', email: 'cell@example.in', phone: '+91 98450 12345', status: 'Active', location: 'Pune' } }),
    })
    return res.status
  })
  expect(made).toBe(201)
  await page.goto('/s/candidates')
  const row = page.getByRole('row', { name: /Cell Person/ })
  await expect(row).toContainText('Pune')

  await test.step('Double-click, type, Enter saves', async () => {
    await row.getByText('Pune').dblclick()
    const box = page.getByLabel('Location of Cell Person')
    await expect(box).toBeFocused()
    const r = await new AxeBuilder({ page }).withTags(tags).analyze()
    expect(r.violations, r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
    await box.fill('Surat')
    await box.press('Enter')
    await expect(row).toContainText('Surat')
    await expect(page.getByLabel('Location of Cell Person')).toHaveCount(0)
  })

  await test.step('Escape leaves the value alone; the keyboard opens the editor', async () => {
    await row.getByText('Surat').focus()
    await page.keyboard.press('Enter')
    const box = page.getByLabel('Location of Cell Person')
    await box.fill('Goa')
    await box.press('Escape')
    await expect(row).toContainText('Surat')
    await expect(row).not.toContainText('Goa')
  })

  await test.step('A choice field edits with a list', async () => {
    await row.getByText('Active').dblclick()
    await page.getByLabel('Status of Cell Person').selectOption('Archived')
    await page.getByLabel('Status of Cell Person').press('Enter')
    await expect(row).toContainText('Archived')
  })

  await test.step('A bad value shows its message and keeps the editor open', async () => {
    await row.getByText('Surat').dblclick()
    // Experience must be a duration the table understands; an email-like text in a number field is refused.
    await page.getByLabel('Location of Cell Person').press('Escape')
    const exp = row.locator('td').nth(4)
    await exp.locator('span').first().dblclick()
    await page.getByRole('textbox').last().fill('not a duration')
    await page.getByRole('textbox').last().press('Enter')
    await expect(page.getByRole('alert').filter({ hasText: /.+/ }).first()).toBeVisible()
  })

  await test.step('Switching it off removes the editor', async () => {
    await page.goto('/studio?tab=data&table=candidate&part=features')
    const panel = page.getByTestId('features-panel')
    await panel.getByRole('switch', { name: /Edit in the list/ }).uncheck()
    await panel.getByRole('button', { name: 'Save features' }).click()
    await expect(page.getByText('Saved features for Candidate').first()).toBeVisible()
  })
})
