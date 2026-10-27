import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, signUpWithPack } from './helpers'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const csv = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) })

test('Import schema suggests links from matching values, and the person decides', async ({ page }) => {
  await signUpWithPack(page, `Values Co ${run}`, `values-${run}@values.test`)
  await page.goto('/studio')
  await page.getByRole('button', { name: 'Import schema' }).click()
  const dialog = page.getByRole('dialog')
  await page.getByLabel('Schema files').setInputFiles([
    csv('firms.csv', 'Firm name,City\nAcme Ltd,Pune\nBirla Co,Delhi\nCobra Inc,Noida\n'),
    csv('vacancies.csv', 'Job title,Company\nAnalyst,Acme Ltd\nTester,acme ltd\nLead,Birla Co\nDev,Cobra Inc\n'),
  ])
  await expect(dialog.getByTestId('schema-table-vacancies')).toBeVisible()

  await test.step('A column of names is offered as a link, with the reason', async () => {
    await expect(dialog.getByText(/Link to Firms \(values match Firms Firm name\)/)).toBeVisible()
    const r = await new AxeBuilder({ page }).withTags(tags).analyze()
    expect(r.violations, r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
  })

  await test.step('It is only a suggestion: untick it and the field stays plain text', async () => {
    const tick = dialog.getByRole('checkbox', { name: /Link to Firms/ })
    await expect(tick).toBeChecked()
    await tick.uncheck()
    await dialog.getByRole('button', { name: /^Create 2 tables/ }).click()
    await expect(page.getByText('Created 2 tables in Draft').first()).toBeVisible()
  })
})
