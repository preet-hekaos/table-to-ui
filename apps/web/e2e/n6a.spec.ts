import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, schemaAction, signUpWithPack } from './helpers'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test('Export schema: choose a format and tables, download, accessible', async ({ page }) => {
  await signUpWithPack(page, `Blueprint Co ${run}`, `blueprint-${run}@blueprint.test`)
  await page.goto('/studio?tab=map')
  await schemaAction(page, 'Export schema')
  const dialog = page.getByRole('dialog', { name: 'Export schema' })
  await expect(dialog.getByText('Tables (13 of 13)')).toBeVisible()
  const r = await new AxeBuilder({ page }).withTags(tags).analyze()
  expect(r.violations, r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])

  await test.step('JSON Schema with every table', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download' }).click()])
    expect(dl.suggestedFilename()).toBe('schema.json')
    const doc = JSON.parse(readFileSync((await dl.path())!, 'utf8'))
    expect(Object.keys(doc.$defs)).toHaveLength(13)
    expect(doc.$defs.requirement.properties.client.$ref).toBe('#/$defs/client')
  })

  await test.step('SQL for two tables', async () => {
    await schemaAction(page, 'Export schema')
    await dialog.getByLabel('Format').selectOption('sql')
    await dialog.getByRole('button', { name: 'Select none' }).click()
    await expect(dialog.getByRole('button', { name: 'Download' })).toBeDisabled()
    await dialog.getByLabel('Client', { exact: true }).check()
    await dialog.getByLabel('Contact', { exact: true }).check()
    await expect(dialog.getByText('Tables (2 of 13)')).toBeVisible()
    const [dl] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download' }).click()])
    expect(dl.suggestedFilename()).toBe('schema.sql')
    const sql = readFileSync((await dl.path())!, 'utf8')
    expect(sql).toContain('CREATE TABLE client')
    expect(sql).toContain('CREATE TABLE contact')
    expect(sql).not.toContain('CREATE TABLE candidate')
  })

  await test.step('The Tables tab has the button too', async () => {
    await page.goto('/studio?tab=data')
    await schemaAction(page, 'Export schema')
    await expect(page.getByRole('dialog', { name: 'Export schema' })).toBeVisible()
  })
})
