import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import path from 'node:path'
import { openTables, run, schemaAction, signUpWithPack, openSection } from './helpers'

const samples = path.resolve(process.cwd(), '../../samples/schema')
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test('Import a schema from a SQL file: preview first, then Draft tables', async ({ page }) => {
  await signUpWithPack(page, `Schema Co ${run}`, `schema-${run}@schema.test`)
  await page.goto('/studio')
  const dialog = page.getByRole('dialog')

  await test.step('Nothing is created by choosing a file', async () => {
    await schemaAction(page, 'Import schema')
    await page.getByLabel('Schema files').setInputFiles(path.join(samples, 'hiring-schema.sql'))
    await expect(dialog.getByTestId('schema-table-clients')).toContainText('Schema + 2 rows')
    await expect(dialog.getByTestId('schema-table-jobs')).toContainText('Schema only')
    await expect(dialog.getByText('Link to Clients (foreign key)')).toBeVisible()
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/n4-preview.png` })
    const r = await new AxeBuilder({ page }).withTags(tags).analyze()
    expect(r.violations, r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
    await page.keyboard.press('Escape')
    await expect((await openTables(page)).getByRole('button', { name: /Clients/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  await test.step('Edit one type, leave one table out, create', async () => {
    await schemaAction(page, 'Import schema')
    await page.getByLabel('Schema files').setInputFiles(path.join(samples, 'hiring-schema.sql'))
    await dialog.getByLabel('Type of openings in jobs').selectOption('decimal')
    await dialog.getByLabel('Create ', { exact: false }).last().uncheck()
    await dialog.getByRole('button', { name: /^Create 2 tables/ }).click()
    await expect(page.getByText('Created 2 tables in Draft').first()).toBeVisible()
  })

  await test.step('They are in Draft, with their fields, on the Tables list and the canvas', async () => {
    const nav = await openTables(page)
    await expect(nav.getByRole('button', { name: /Clients/ })).toBeVisible()
    await expect(nav.getByRole('button', { name: /Applicants/ })).toHaveCount(0)
    await nav.getByRole('button', { name: /Jobs/ }).click()
    await expect(page.getByText('Link to another table').first()).toBeVisible()
    await expect(page.getByText('Number with decimals').first()).toBeVisible()
    await openSection(page, 'Canvas')
    await expect(page.getByTestId('box-jobs')).toBeVisible()
    await expect(page.getByTestId('box-clients')).toBeVisible()
  })

  await test.step('After publishing, an empty imported table offers Import data', async () => {
    await page.getByTestId('draft-banner').getByRole('button', { name: 'Publish Draft to Test' }).click()
    await expect(page.getByText(/is in Test/).first()).toBeVisible()
    await page.goto('/studio?tab=versions')
    await page.getByRole('button', { name: 'Make Live' }).first().click()
    await expect(page.getByText(/is now Live/).first()).toBeVisible()
    await page.goto('/s/clients_list')
    await expect(page.getByRole('heading', { name: 'No clients yet' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import data' })).toBeVisible()
  })
})

test('A header-only CSV makes an empty table, and Excel sheets become tables', async ({ page }) => {
  await signUpWithPack(page, `Schema Two ${run}`, `schema2-${run}@schema.test`)
  await page.goto('/studio?tab=map')
  await schemaAction(page, 'Import schema')
  const dialog = page.getByRole('dialog')
  await page.getByLabel('Schema files').setInputFiles([
    path.join(samples, 'recruitment-headers-only.csv'),
    path.join(samples, 'hiring-workbook.xlsx'),
    path.join(samples, 'employee-schema.json'),
  ])
  await expect(dialog.getByTestId('schema-table-recruitment_headers_only')).toContainText('Schema only')
  await expect(dialog.getByTestId('schema-table-requirements')).toContainText('Schema + 2 rows')
  await expect(dialog.getByTestId('schema-table-employee')).toBeVisible()
  await dialog.getByRole('button', { name: /^Create 6 tables/ }).click()
  await expect(page.getByText('Created 6 tables in Draft').first()).toBeVisible()
  await expect(page.getByTestId('box-requirements')).toBeVisible()
})

test('An unsupported file is explained and nothing is created', async ({ page }) => {
  await signUpWithPack(page, `Schema Three ${run}`, `schema3-${run}@schema.test`)
  await page.goto('/studio')
  await schemaAction(page, 'Import schema')
  await page.getByLabel('Schema files').setInputFiles({ name: 'notes.rtf', mimeType: 'application/rtf', buffer: Buffer.from('{\\rtf1 hello}') })
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('not supported yet')
  // a PDF with no text in it (a scan) is explained before any AI is asked
  await page.getByLabel('Schema files').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') })
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('no readable text')
})
