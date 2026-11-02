import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { run, signUpWithPack, pickNewFieldType, setFieldFeature } from './helpers'
import { freshSession, publishLive } from './live-effect'

/**
 * S6.4 The full journey: the owner builds a PAN number field in Studio (type, rules, transformation, switches, label,
 * order), publishes, and a recruiter in a separate session uses it everywhere. Then the owner changes the rule and
 * publishes again, and finally rolls Live back.
 */
type Reply = { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any
const call = (page: Page, method: string, path: string, body?: unknown): Promise<Reply> =>
  page.evaluate(
    async ([m, p, b]) => {
      const r = await fetch(p as string, { method: m as string, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` }, body: b ? JSON.stringify(b) : undefined })
      return { status: r.status, body: await r.json().catch(() => null) }
    },
    [method, path, body] as [string, string, unknown],
  )

const cand = (n: number, pan?: string) => ({ full_name: `Journey ${n}`, email: `j${n}-${run}@example.in`, phone: `+91 98450 8${String(n).padStart(4, '0')}`, status: 'Active', ...(pan ? { pan_number: pan } : {}) })

test('S6.4 the full journey: Studio to the recruiter, a new rule, and a rollback', async ({ page, browser }) => {
  test.setTimeout(600_000)
  await page.setViewportSize({ width: 1500, height: 1100 })
  await signUpWithPack(page, `S6 Journey ${run}`, `s6j-${run}@studio.test`)
  const old = await call(page, 'POST', '/v1/records/candidate', { data: cand(1) })
  expect(old.status).toBe(201)
  expect((await call(page, 'PUT', '/v1/ai/settings', { enabled: true, tables: [] })).status).toBe(200)
  const dialogOf = (name: string) => page.getByRole('dialog', { name })

  await test.step('1. Studio: add the field PAN number from the Type picker', async () => {
    await page.goto('/studio')
    await page.getByRole('button', { name: 'Add field' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Label/).fill('PAN no')
    await pickNewFieldType(page, /^PAN \(India\)/)
    await dialog.getByRole('button', { name: 'Add field' }).click()
    await expect(page.getByRole('row', { name: /pan_no / })).toBeVisible()
  })

  await test.step('2. Add a library rule and an own rule from words', async () => {
    await page.getByRole('button', { name: /^(Add|\d+ rules?)\. Validation of PAN no/ }).click()
    const pop = page.getByRole('dialog', { name: 'Validation for PAN no' })
    await pop.getByRole('button', { name: 'PAN', exact: true }).click()
    await pop.getByLabel(/^Message of PAN/).fill('Use the PAN format ABCDE1234F.')
    await pop.getByLabel('Describe the allowed values').fill('5 letters, then 4 digits, then 1 letter')
    await pop.getByRole('button', { name: 'Make a pattern' }).click()
    await pop.getByTestId('proposal').getByRole('button', { name: 'Use as rule' }).click()
    await expect(pop.getByRole('list', { name: 'Rules' }).getByRole('listitem')).toHaveCount(2)
    await pop.getByRole('button', { name: 'Done' }).click()
  })

  await test.step('3. Add a transformation rule: trim, then capitals', async () => {
    await page.getByTestId('transform-of-pan_no').click()
    const p = dialogOf('Transformation rules · PAN no')
    for (const action of ['trim spaces', 'lower, UPPER or Title Case']) {
      await p.getByLabel('New rule condition').selectOption({ label: 'matches a pattern' })
      await p.getByLabel('New rule action').selectOption({ label: action })
      const n = await p.getByRole('list', { name: 'Rules' }).getByRole('listitem').count()
      await p.getByLabel(new RegExp(`^Rule ${n} (values|condition value|pattern)$`)).fill('.+')
    }
    await p.getByLabel('Rule 2 case').selectOption({ label: 'UPPER CASE' })
    await p.getByLabel('Value to try 1').fill('  abcde1234f ')
    await expect(p.getByTestId('try-result-0')).toContainText('ABCDE1234F')
    await p.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByTestId('transform-of-pan_no')).not.toContainText('Add')
  })

  await test.step('4. Tick Unique, Searchable and Filterable, and set it Required', async () => {
    await setFieldFeature(page, 'PAN no', 'Unique', true)
    await setFieldFeature(page, 'PAN no', 'Searchable', true)
    await setFieldFeature(page, 'PAN no', 'Filterable', true)
    await page.getByRole('switch', { name: 'PAN no is required' }).click()
    await expect(page.getByRole('switch', { name: 'PAN no is required' })).toBeChecked()
  })

  await test.step('5. Rename the label and move the field up', async () => {
    await page.getByRole('row', { name: /pan_no / }).getByRole('button', { name: 'PAN no', exact: true }).click()
    await page.getByLabel('Label of pan_no').fill('PAN number')
    await page.getByLabel('Label of pan_no').press('Enter')
    await expect(page.getByRole('row', { name: /pan_no / })).toContainText('PAN number')
    const handle = page.getByRole('button', { name: /^Move PAN number\./ })
    await handle.focus()
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp')
  })

  await test.step('6. Review the changes in plain words, then publish', async () => {
    await page.getByTestId('draft-banner').getByRole('button', { name: 'Review changes' }).click()
    const review = page.getByRole('dialog')
    await expect(review).toContainText('PAN number')
    await expect(review).toContainText('added')
    await page.keyboard.press('Escape')
    await publishLive(page)
  })

  const rec = await freshSession(browser, page)
  await rec.setViewportSize({ width: 1500, height: 1100 })

  await test.step('7a. The recruiter sees label, position and the required mark; a bad value is refused and a good one saved in capitals', async () => {
    await rec.goto('/records/candidate/new')
    const labels = await rec.locator('label').allTextContents()
    const at = labels.findIndex((t) => t.startsWith('PAN number'))
    expect(at).toBeGreaterThanOrEqual(0)
    expect(at).toBeLessThan(labels.findIndex((t) => t.startsWith('Phone')) + 4)
    await expect(rec.getByLabel(/^PAN number/)).toBeVisible()
    await rec.getByLabel(/^Full name/).fill('Priya Nair')
    await rec.getByLabel(/^Email/).fill(`priya-${run}@example.in`)
    await rec.getByLabel(/^Phone/).fill('+91 98450 60001')
    await rec.getByLabel(/^PAN number/).fill('not a pan')
    await rec.getByRole('button', { name: 'Save candidate' }).click()
    await expect(rec.getByText('Use the PAN format ABCDE1234F.')).toBeVisible()
    await rec.getByLabel(/^PAN number/).fill('  abcde1234f ')
    await rec.getByRole('button', { name: 'Save candidate' }).click()
    await expect(rec.getByRole('heading', { name: 'Priya Nair' })).toBeVisible()
    await expect(rec.getByText('ABCDE1234F')).toBeVisible()
    await rec.screenshot({ path: '../../docs/screens/studio-table/s6/journey-recruiter-record.png' })
  })

  await test.step('7b. Required and Unique: a missing PAN and a repeated PAN are refused', async () => {
    expect((await call(rec, 'POST', '/v1/records/candidate', { data: cand(2) })).status).toBe(422)
    const dup = await call(rec, 'POST', '/v1/records/candidate', { data: cand(3, 'abcde1234f') })
    expect(dup.status).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(dup.body)).toMatch(/pan_number/)
  })

  await test.step('7c. Import a file with good, bad and duplicate rows', async () => {
    const csv = ['Name,E-mail,Mobile,PAN number', `Imp One,imp1-${run}@example.in,9845070001,FGHIJ5678K`, `Imp Two,imp2-${run}@example.in,9845070002,short`, `Imp Three,imp3-${run}@example.in,9845070003,ABCDE1234F`].join('\n')
    await rec.goto('/import')
    await rec.getByLabel('Import into').selectOption({ label: 'Candidates' })
    await rec.getByLabel('Spreadsheet').setInputFiles({ name: 'pan.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await expect(rec.getByLabel('Field for PAN number', { exact: true })).toHaveValue('pan_number')
    await rec.getByRole('button', { name: 'Check the data' }).click()
    const report = rec.getByTestId('validation-report')
    await expect(report).toContainText('Ready1')
    await expect(report).toContainText('With problems2')
    await rec.getByRole('button', { name: /^Load/ }).click()
    await expect(rec.getByTestId('reconciliation')).toContainText('Import finished', { timeout: 30_000 })
    await expect(rec.getByTestId('reconciliation')).toContainText('Added1')
  })

  await test.step('7d. Bulk edit, search an older record by the new field, filter, sort and export', async () => {
    const olderId = old.body.id as string
    const p = await call(rec, 'PATCH', `/v1/records/candidate/${olderId}`, { version: 1, data: { pan_number: 'zzzzz9999z' } })
    expect(p.status, JSON.stringify(p.body)).toBe(200)
    await rec.goto('/s/candidates')
    await rec.getByRole('searchbox').or(rec.getByPlaceholder('Search candidates')).first().fill('ZZZZZ9999Z')
    await expect(rec.getByRole('link', { name: 'Journey 1' })).toBeVisible()
    await expect(rec.getByRole('link', { name: 'Priya Nair' })).toHaveCount(0)
    await rec.getByPlaceholder('Search candidates').fill('')
    await expect(rec.getByRole('link', { name: 'Priya Nair' })).toBeVisible()
    await rec.getByRole('checkbox', { name: 'Select Priya Nair' }).check()
    await rec.getByTestId('bulk-bar').getByRole('button', { name: 'Change a value' }).click()
    await rec.getByLabel('Field to change').selectOption({ label: 'Current title' })
    await rec.getByLabel('New value').fill('Reviewed')
    await rec.getByRole('button', { name: /^Change 1/ }).click()
    await expect(rec.getByText('Reviewed').first()).toBeVisible()
    const filtered = await call(rec, 'GET', '/v1/records/candidate?c.pan_number=ZZZZZ')
    expect(filtered.body.items.map((r: { data: { full_name: string } }) => r.data.full_name)).toEqual(['Journey 1'])
    const sorted = await call(rec, 'GET', '/v1/records/candidate?sort=pan_number&direction=asc')
    expect(sorted.status).toBe(200)
    await rec.getByRole('button', { name: 'Export', exact: true }).click()
    const dialog = rec.getByRole('dialog')
    await dialog.getByLabel('Columns').selectOption('all')
    await dialog.getByLabel('Format').selectOption('csv')
    const [file] = await Promise.all([rec.waitForEvent('download'), dialog.getByRole('button', { name: 'Download' }).click()])
    expect(readFileSync((await file.path())!, 'utf8')).toContain('ABCDE1234F')
  })

  await test.step('8. The owner changes the rule and publishes; the recruiter’s next save follows it', async () => {
    await page.goto('/studio')
    await page.getByRole('button', { name: /^(Add|\d+ rules?)\. Validation of PAN number/ }).click()
    const pop = page.getByRole('dialog', { name: 'Validation for PAN number' })
    await pop.getByLabel(/^Message of PAN/).first().fill('PAN looks wrong. Check the card.')
    await pop.getByRole('button', { name: 'Done' }).click()
    await publishLive(page)
    await rec.goto('/records/candidate/new')
    await rec.getByLabel(/^Full name/).fill('Second Try')
    await rec.getByLabel(/^Email/).fill(`second-${run}@example.in`)
    await rec.getByLabel(/^Phone/).fill('+91 98450 60002')
    await rec.getByLabel(/^PAN number/).fill('not a pan')
    await rec.getByRole('button', { name: 'Save candidate' }).click()
    await expect(rec.getByText('PAN looks wrong. Check the card.')).toBeVisible()
  })

  await test.step('9. The owner rolls Live back; the app returns to the earlier rule', async () => {
    await page.goto('/studio?tab=versions')
    await page.getByRole('button', { name: 'Roll back Live' }).click()
    await expect(page.getByText(/Rolled back to version/).first()).toBeVisible()
    await rec.goto('/records/candidate/new')
    await rec.getByLabel(/^Full name/).fill('Third Try')
    await rec.getByLabel(/^Email/).fill(`third-${run}@example.in`)
    await rec.getByLabel(/^Phone/).fill('+91 98450 60003')
    await rec.getByLabel(/^PAN number/).fill('not a pan')
    await rec.getByRole('button', { name: 'Save candidate' }).click()
    await expect(rec.getByText('Use the PAN format ABCDE1234F.')).toBeVisible()
  })
  await rec.context().close()
})
