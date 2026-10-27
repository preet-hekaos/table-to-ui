import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { openTables, run, schemaAction, signUpWithPack } from './helpers'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test('A PDF that describes the data becomes a proposal in Import schema, checked before anything is made', async ({ page, browser }) => {
  // a real PDF, printed by the browser from a small page of text
  const ctx = await browser.newContext()
  const doc = await ctx.newPage()
  await doc.setContent('<p>Firms: Name, City, Email</p><p>Vacancies: Title, Firm, Start date</p>')
  const pdf = await doc.pdf()
  await ctx.close()

  await signUpWithPack(page, `Reader Co ${run}`, `reader-${run}@reader.test`)
  await page.goto('/studio')

  await test.step('With AI off, the document is refused plainly and nothing is created', async () => {
    await schemaAction(page, 'Import schema')
    await page.getByLabel('Schema files').setInputFiles({ name: 'plan.pdf', mimeType: 'application/pdf', buffer: pdf })
    await expect(page.getByRole('alert').filter({ hasText: /AI is switched off/ })).toBeVisible()
    await page.keyboard.press('Escape')
  })

  await test.step('Switch AI on, then the same file shows a proposal with a notice', async () => {
    await page.evaluate(async () => {
      await fetch('/v1/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
        body: JSON.stringify({ enabled: true, tables: [] }),
      })
    })
    await schemaAction(page, 'Import schema')
    await page.getByLabel('Schema files').setInputFiles({ name: 'plan.pdf', mimeType: 'application/pdf', buffer: pdf })
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/Read by AI from plan.pdf/)).toBeVisible()
    await expect(dialog.getByText(/check every table, field and link/)).toBeVisible()
    await expect(dialog.getByTestId('schema-table-firms')).toBeVisible()
    await expect(dialog.getByTestId('schema-table-vacancies')).toBeVisible()
    await expect(dialog.getByText(/Link to Firms/)).toBeVisible()
    const r = await new AxeBuilder({ page }).withTags(tags).analyze()
    expect(r.violations, r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
  })

  await test.step('Nothing exists until the person confirms', async () => {
    await page.keyboard.press('Escape')
    await expect((await openTables(page)).getByRole('button', { name: /Firms/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })
})
