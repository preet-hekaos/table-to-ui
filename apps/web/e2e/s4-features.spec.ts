import { expect, test, type Page } from '@playwright/test'
import { run, signUpWithPack } from './helpers'
import { freshSession, publishLive } from './live-effect'

const SHOTS = '../../docs/screens/studio-table/s4'
const cell = (page: Page, label: string) => page.getByRole('button', { name: new RegExp(`Features of ${label}$`) })

test('S4.1 the Features cell: chips, +N, the dropdown with its eleven ticks, keyboard, and the table-wide bar', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1100 })
  await signUpWithPack(page, `S4 Cell ${run}`, `s4a-${run}@studio.test`)
  await page.goto('/studio')
  await expect(page.getByRole('table', { name: 'Candidate fields' })).toBeVisible()

  await test.step('Each row shows up to three chips, +N and a caret', async () => {
    const phone = cell(page, 'Phone')
    await expect(phone).toContainText('Sort')
    await expect(phone).not.toContainText('Filter') // the pack does not make phone numbers filterable
    await expect(phone).toContainText('Edit')
    await expect(phone).toContainText('+')
    await expect(cell(page, 'Full name')).toContainText('Shown')
  })

  await test.step('The table-wide bar is above the grid with nine switches', async () => {
    const bar = page.getByRole('group', { name: 'Table-wide switches for Candidate' })
    await expect(bar.getByRole('switch')).toHaveCount(9)
    for (const n of ['Sorting', 'Filtering', 'Edit in the list', 'Group rows', 'Export data', 'Select rows', 'Summary'])
      await expect(bar.getByRole('switch', { name: new RegExp(`^${n}`) })).toBeChecked()
  })

  await test.step('The dropdown lists the eleven ticks with their one-line meaning', async () => {
    await cell(page, 'Phone').click()
    const pop = page.getByRole('dialog', { name: 'Features of Phone' })
    await expect(pop.getByRole('checkbox')).toHaveCount(11)
    for (const n of ['Shown in the list', 'Sortable', 'Filterable', 'Editable in the list', 'Groupable', 'Exportable', 'Bulk edit', 'In the summary numbers', 'Chart axis', 'Unique', 'Searchable'])
      await expect(pop.getByRole('checkbox', { name: new RegExp(`^${n}`) })).toBeVisible()
    await expect(pop.getByRole('checkbox', { name: /^In the summary numbers/ })).toBeDisabled()
    await expect(pop.getByText('Only number fields can be summarised.')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/after-dropdown.png` })
  })

  await test.step('A tick saves at once and the chips follow; Esc closes and returns focus', async () => {
    const pop = page.getByRole('dialog', { name: 'Features of Phone' })
    await pop.getByRole('checkbox', { name: /^Sortable/ }).uncheck()
    await expect(pop.getByRole('checkbox', { name: /^Sortable/ })).not.toBeChecked()
    await expect(page.getByTestId('draft-banner')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await expect(cell(page, 'Phone')).toBeFocused()
    await expect(cell(page, 'Phone')).not.toContainText('Sort')
  })

  await test.step('Keyboard only: Enter opens, Space ticks', async () => {
    await cell(page, 'Email').focus()
    await page.keyboard.press('Enter')
    const pop = page.getByRole('dialog', { name: 'Features of Email' })
    await expect(pop).toBeVisible()
    const edit = pop.getByRole('checkbox', { name: /^Editable in the list/ })
    await edit.focus()
    await page.keyboard.press('Space')
    await expect(edit).not.toBeChecked()
    await page.keyboard.press('Escape')
  })

  await test.step('A table-wide switch greys the tick on every field and it stays off in the bar', async () => {
    const bar = page.getByRole('group', { name: 'Table-wide switches for Candidate' })
    await bar.getByRole('switch', { name: /^Export data/ }).click()
    await cell(page, 'Email').click()
    const pop = page.getByRole('dialog', { name: 'Features of Email' })
    await expect(pop.getByRole('checkbox', { name: /^Exportable/ })).toBeDisabled()
    await expect(pop.getByText('Turn on Export data in the bar above first.')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('features-panel').getByRole('switch', { name: /Export data/ })).not.toBeChecked()
    await bar.getByRole('switch', { name: /^Export data/ }).click()
    await expect(bar.getByRole('switch', { name: /^Export data/ })).toBeChecked()
    await page.screenshot({ path: `${SHOTS}/after-fields-tab.png`, fullPage: true })
  })
})

const api = (page: Page, method: string, url: string, body?: unknown) =>
  page.evaluate(
    async ([m, u, b]) => {
      const r = await fetch(u as string, { method: m as string, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` }, body: b ? JSON.stringify(b) : undefined })
      return { status: r.status, body: (await r.json().catch(() => null)) as Record<string, unknown> | null }
    },
    [method, url, body] as [string, string, unknown],
  )

test('S4.3 Unique: duplicates block the publish and are listed; then a second user cannot save a duplicate', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1500, height: 1100 })
  await signUpWithPack(page, `S4 Uniq ${run}`, `s4b-${run}@studio.test`)
  const make = async (i: number, title: string) =>
    api(page, 'POST', '/v1/records/candidate', { data: { full_name: `Person ${i}`, email: `u${i}@x.test`, phone: `+91 98450 3${i}000`, status: 'Active', current_title: title } })
  expect((await make(1, 'Code-1')).status).toBe(201)
  expect((await make(2, 'code-1')).status).toBe(201)
  expect((await make(3, 'Code-3')).status).toBe(201)

  await page.goto('/studio')
  await page.getByRole('button', { name: /Features of Current title$/ }).click()
  await page.getByRole('checkbox', { name: /^Unique/ }).check()
  await page.keyboard.press('Escape')

  await test.step('The Studio lists the duplicate values and publishing is refused', async () => {
    const box = page.getByTestId('unique-blockers')
    await expect(box).toContainText('Current title')
    await expect(box).toContainText('Code-1 (2)')
    await page.screenshot({ path: `${SHOTS}/after-unique-blocked.png` })
    const r = await api(page, 'POST', '/v1/apps/current/releases')
    expect(r.status).toBe(422)
  })

  await test.step('After the records are changed, publish works and a second user cannot add a duplicate', async () => {
    const list = await api(page, 'GET', '/v1/records/candidate?limit=10')
    const items = (list.body?.items ?? []) as { id: string; version: number; data: { current_title?: string } }[]
    const dup = items.find((x) => x.data.current_title === 'code-1')!
    const fix = await api(page, 'PATCH', `/v1/records/candidate/${dup.id}`, { version: dup.version, data: { current_title: 'Code-2' } })
    expect(fix.status).toBe(200)
    await page.reload()
    await expect(page.getByTestId('draft-banner')).toBeVisible()
    await expect(page.getByTestId('unique-blockers')).toHaveCount(0)
    await publishLive(page)
    const other = await freshSession(browser, page)
    const r = await api(other, 'POST', '/v1/records/candidate', { data: { full_name: 'Dup', email: 'dup@x.test', phone: '+91 98450 39999', status: 'Active', current_title: 'CODE-3' } })
    expect(r.status).toBe(422)
    expect(JSON.stringify(r.body)).toContain('already used')
    await other.context().close()
  })
})

test('S4.4 Searchable: a record saved before the switch is found after publish; switching off hides it again', async ({ page, browser }) => {
  await signUpWithPack(page, `S4 Srch ${run}`, `s4c-${run}@studio.test`)
  await page.goto('/studio')
  await page.getByRole('button', { name: /Features of Location$/ }).click()
  await page.getByRole('checkbox', { name: /^Searchable/ }).uncheck()
  await page.keyboard.press('Escape')
  await publishLive(page)
  const made = await api(page, 'POST', '/v1/records/candidate', { data: { full_name: 'Old Record', email: 'old@x.test', phone: '+91 98450 38888', status: 'Active', location: 'Zebracorn Town' } })
  expect(made.status).toBe(201)
  const found = async (p: Page) => ((await api(p, 'GET', '/v1/records/candidate?q=zebracorn')).body?.items as unknown[]).length

  const other = await freshSession(browser, page)
  expect(await found(other)).toBe(0)
  await page.goto('/studio')
  await page.getByRole('button', { name: /Features of Location$/ }).click()
  await page.getByRole('checkbox', { name: /^Searchable/ }).check()
  await page.keyboard.press('Escape')
  expect(await found(other)).toBe(0) // not before publish
  await publishLive(page)
  expect(await found(other)).toBe(1)
  await other.context().close()
})
