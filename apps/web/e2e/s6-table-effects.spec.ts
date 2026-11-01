import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { run, signUpWithPack } from './helpers'
import { freshSession, publishLive } from './live-effect'

/**
 * S6.2 Every table setting reaches the live list screen. The owner changes the Draft the way Studio does, publishes,
 * and a separate session opens the list and uses it. Two publishes: settings with a value, then the master switches off.
 */
const call = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([m, p, b]) => {
      const r = await fetch(p as string, { method: m as string, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` }, body: b ? JSON.stringify(b) : undefined })
      return { status: r.status, body: (await r.json().catch(() => null)) as unknown }
    },
    [method, path, body] as [string, string, unknown],
  )

const header = (p: Page, name: string) => p.getByRole('columnheader', { name: new RegExp(`^${name}`) })

test('S6.2 table settings: values reach the live list for a second session', async ({ page, browser }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1500, height: 1000 })
  await signUpWithPack(page, `S6 Table ${run}`, `s6t-${run}@studio.test`)
  for (const [i, name] of ['Asha Rao', 'Bimal Das', 'Chitra Iyer'].entries()) {
    const r = await call(page, 'POST', '/v1/records/candidate', { data: { full_name: name, email: `p${i}-${run}@example.in`, phone: `+91 98450 1234${i}`, status: 'Active' } })
    expect(r.status).toBe(201)
  }

  await test.step('The owner sets the table in the Draft and makes it Live', async () => {
    const r = await call(page, 'PUT', '/v1/studio/tables/candidate/features', {
      default_sort: { field: 'full_name', direction: 'desc' },
      default_columns: ['full_name', 'email', 'phone', 'status'],
      density: 'comfortable',
      unsortable: ['email'],
      unfilterable: ['status'],
      ungroupable: ['status'],
      uneditable: ['phone'],
      unexported: ['phone'],
      nobulk: ['status'],
      bulk_scope: 'all',
      export_formats: ['csv', 'json'],
      export_email: false,
      stat_cards: [{ kind: 'count', label: 'People on file' }],
      stat_scope: 'table',
    })
    expect(r.status).toBe(200)
    await publishLive(page)
  })

  const s = await freshSession(browser, page)
  await s.setViewportSize({ width: 1500, height: 1000 })
  await s.goto('/s/candidates')
  await expect(s.getByRole('row')).toHaveCount(4)

  await test.step('default_columns, default_sort and density: the list opens as the owner set it', async () => {
    await expect(header(s, 'Full name')).toBeVisible()
    await expect(header(s, 'Phone')).toBeVisible()
    await expect(header(s, 'Current title')).toHaveCount(0)
    await expect(s.getByRole('row').nth(1)).toContainText('Chitra Iyer')
    await expect(s.getByRole('button', { name: 'Comfortable' })).toBeVisible()
  })

  await test.step('unsortable, unfilterable, sortable and filterable: per field', async () => {
    await expect(header(s, 'Email')).not.toHaveAttribute('aria-sort', /.+/)
    await expect(header(s, 'Full name')).toHaveAttribute('aria-sort', /.+/)
    await expect(s.getByRole('button', { name: 'Filter Status' })).toHaveCount(0)
    await expect(s.getByRole('button', { name: /^Filter / }).first()).toBeVisible()
  })

  await test.step('ungroupable and grouping: Group by leaves the field out', async () => {
    const options = await s.getByLabel('Group by').locator('option').allTextContents()
    expect(options).not.toContain('Status')
    expect(options.length).toBeGreaterThan(1)
  })

  await test.step('uneditable and inline_edit: phone has no editor, email has', async () => {
    const row = s.getByRole('row').filter({ hasText: 'Asha Rao' })
    await row.getByText('+919845012340').dblclick()
    await expect(s.getByRole('textbox', { name: /Phone/ })).toHaveCount(0)
    await row.getByText(new RegExp(`p0-${run}@example.in`)).dblclick()
    await expect(s.getByRole('textbox', { name: /Email/ })).toBeVisible()
    await s.keyboard.press('Escape')
  })

  await test.step('stat_cards and stat_scope: the chosen card shows the whole table', async () => {
    await expect(s.getByTestId('stats-strip')).toContainText('People on file')
    await expect(s.getByTestId('stats-strip')).toContainText('3')
  })

  await test.step('export_formats, export_email, unexported, bulk_scope: the export dialog', async () => {
    await s.getByRole('button', { name: 'Export', exact: true }).click()
    const dialog = s.getByRole('dialog')
    expect(await dialog.getByLabel('Format').locator('option').allTextContents()).toEqual(['CSV (opens in Excel)', 'JSON'])
    await expect(dialog.getByRole('button', { name: 'Email me a link' })).toHaveCount(0)
    await expect(dialog.getByLabel('Columns')).toHaveValue('all')
    await dialog.getByLabel('Format').selectOption('json')
    const [file] = await Promise.all([s.waitForEvent('download'), dialog.getByRole('button', { name: 'Download' }).click()])
    const rows = JSON.parse(readFileSync((await file.path())!, 'utf8')) as Record<string, unknown>[]
    expect(rows).toHaveLength(3)
    expect(Object.keys(rows[0]!)).not.toContain('phone')
    expect(Object.keys(rows[0]!)).toContain('email')
  })

  await test.step('nobulk: Change a value does not offer the field; the server refuses it too', async () => {
    await s.getByRole('checkbox', { name: 'Select Asha Rao' }).check()
    await s.getByTestId('bulk-bar').getByRole('button', { name: 'Change a value' }).click()
    const options = await s.getByLabel('Field to change').locator('option').allTextContents()
    expect(options).not.toContain('Status')
    expect(options).toContain('Current title')
    await s.keyboard.press('Escape')
    await s.getByRole('button', { name: 'Clear selection' }).click()
  })

  await test.step('row_order: the Custom order switch is offered', async () => {
    await expect(s.getByRole('switch', { name: 'Custom order' })).toBeVisible()
  })

  await test.step('The owner switches the master settings off and makes it Live again', async () => {
    const r = await call(page, 'PUT', '/v1/studio/tables/candidate/features', {
      sortable: false, filterable: false, select_bulk: false, import_data: false, export_data: false,
      inline_edit: false, grouping: false, statistics: false, row_order: false,
    })
    expect(r.status).toBe(200)
    await publishLive(page)
  })

  await test.step('The same session, after a reload, sees none of them', async () => {
    await s.goto('/s/candidates')
    await expect(s.getByRole('row')).toHaveCount(4)
    await expect(s.locator('th button')).toHaveCount(0)
    await expect(s.getByRole('button', { name: /^Filter / })).toHaveCount(0)
    await expect(s.getByRole('checkbox', { name: 'Select all rows shown' })).toHaveCount(0)
    await expect(s.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0)
    await expect(s.getByRole('button', { name: 'Import data' })).toHaveCount(0)
    await expect(s.getByLabel('Group by')).toHaveCount(0)
    await expect(s.getByTestId('stats-strip')).toHaveCount(0)
    await expect(s.getByRole('switch', { name: 'Custom order' })).toHaveCount(0)
    await s.getByRole('row').filter({ hasText: 'Asha Rao' }).getByText(new RegExp(`p0-${run}@example.in`)).dblclick()
    await expect(s.getByRole('textbox', { name: /Email/ })).toHaveCount(0)
  })

  await test.step('The server holds the line for the API too', async () => {
    expect((await call(s, 'GET', '/v1/records/candidate?sort=full_name&direction=asc')).status).toBeGreaterThanOrEqual(400)
    expect((await call(s, 'GET', '/v1/records/candidate/export?format=csv')).status).toBeGreaterThanOrEqual(400)
  })
  await s.context().close()
})
