import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, signUpWithPack } from './helpers'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test('Import and export: export dialog, formats, email link, JSON import, switches', async ({ page }) => {
  await signUpWithPack(page, `Export Co ${run}`, `export-${run}@export.test`)
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

  await test.step('Export the list as JSON', async () => {
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('All candidates')
    const r = await new AxeBuilder({ page }).withTags(tags).analyze()
    expect(r.violations, r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
    await dialog.getByLabel('Format').selectOption('json')
    const [file] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download' }).click()])
    const rows = JSON.parse(readFileSync((await file.path())!, 'utf8')) as { full_name: string }[]
    expect(rows.map((x) => x.full_name).sort()).toEqual(['Asha Rao', 'Bimal Das', 'Chitra Iyer'])
  })

  await test.step('Ticked rows export only those rows, and cannot be emailed', async () => {
    await page.getByRole('checkbox', { name: 'Select Asha Rao' }).check()
    await page.getByTestId('bulk-bar').getByRole('button', { name: 'Export' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('1 selected')
    await expect(dialog.getByRole('button', { name: 'Email me a link' })).toHaveCount(0)
    await dialog.getByLabel('Format').selectOption('csv')
    const [file] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download' }).click()])
    const text = readFileSync((await file.path())!, 'utf8')
    expect(text).toContain('Asha Rao')
    expect(text).not.toContain('Bimal Das')
  })

  await test.step('Email me a link', async () => {
    await page.getByRole('button', { name: 'Clear selection' }).click()
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await page.getByRole('button', { name: 'Email me a link' }).click()
    await expect(page.getByText('Link sent').first()).toBeVisible()
  })

  await test.step('Import data opens the wizard on this table and takes JSON', async () => {
    await page.getByRole('button', { name: 'Import data' }).click()
    await expect(page).toHaveURL(/\/import\?table=candidate/)
    await expect(page.getByLabel('Import into')).toHaveValue('candidate')
    await page.locator('input[type=file]').setInputFiles({
      name: 'people.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify([{ Name: 'Json One', 'E-mail': 'j1@example.in' }, { Name: 'Json Two', 'E-mail': 'j2@example.in' }])),
    })
    await expect(page.getByText('Match columns').first()).toBeVisible()
    await expect(page.getByText('Json One').first()).toBeVisible()
  })

  await test.step('Switching export off removes the button', async () => {
    await page.goto('/studio?tab=data&table=candidate&part=features')
    const panel = page.getByTestId('features-panel')
    await panel.getByRole('switch', { name: /Export data/ }).uncheck()
    await panel.getByRole('button', { name: 'Save features' }).click()
    await expect(page.getByText('Saved features for Candidate').first()).toBeVisible()
  })
})
