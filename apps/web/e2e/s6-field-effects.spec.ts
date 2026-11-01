import { expect, test, type Page } from '@playwright/test'
import { run, signUpWithPack } from './helpers'
import { freshSession, publishLive } from './live-effect'

/**
 * S6.2 Every field setting reaches the live app. The owner changes fields the way Studio does and publishes;
 * a separate session opens the real form, list and import wizard and uses them.
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

const person = (n: number, extra: Record<string, unknown> = {}) => ({ full_name: `Person ${n}`, email: `f${n}-${run}@example.in`, phone: `+91 98450 5${String(n).padStart(4, '0')}`, status: 'Active', ...extra })

test('S6.2 field settings reach the live form, list, API and import', async ({ page, browser }) => {
  test.setTimeout(280_000)
  await page.setViewportSize({ width: 1500, height: 1100 })
  await signUpWithPack(page, `S6 Fields ${run}`, `s6f-${run}@studio.test`)

  let panKey = ''
  await test.step('The owner changes fields in the Draft and makes them Live', async () => {
    const added = await call(page, 'POST', '/v1/studio/tables/candidate/fields', { label: 'PAN number', preset: 'pan_in', help: 'As printed on the card', group: 'Identity' })
    expect(added.status, JSON.stringify(added.body)).toBe(201)
    panKey = added.body.key
    expect(panKey).toBe('pan_number')
    expect(added.body.source).toBe('agency')
    const tables = await call(page, 'GET', '/v1/studio/tables')
    const status = (tables.body as { key: string; fields: { key: string; options: string[] }[] }[]).find((t) => t.key === 'candidate')!.fields.find((f) => f.key === 'status')!
    const patches: [string, Record<string, unknown>][] = [
      ['current_title', { help: 'As on the latest payslip', group: 'Work today', type: 'long_text' }],
      ['status', { options: [...status.options, 'On hold'] }],
      ['notice_period_days', { min: 0, max: 90 }],
      ['current_employer', { max_length: 5 }],
      ['location', { rules: [{ name: 'Letters only', kind: 'pattern', pattern: '^[A-Za-z ]+$', message: 'Use letters only', enabled: true }], filterable: false }],
      ['source', { hidden: true }],
      ['full_name', { label: 'Candidate name' }], // a pack field is edited exactly like one the builder added (source is not read)
    ]
    for (const [key, body] of patches) {
      const r = await call(page, 'PATCH', `/v1/studio/tables/candidate/fields/${key}`, body)
      expect(r.status, `${key}: ${JSON.stringify(r.body)}`).toBe(200)
    }
    const m = await call(page, 'POST', '/v1/studio/measures', { label: 'Total notice days', table: 'candidate', aggregate: 'sum', field: 'notice_period_days', display: 'number', home: true })
    expect(m.status, JSON.stringify(m.body)).toBe(201)
    await publishLive(page)
  })

  const s = await freshSession(browser, page)
  await s.setViewportSize({ width: 1500, height: 1100 })

  await test.step('key, help, group, type, options, hidden, label: the live form', async () => {
    await s.goto('/records/candidate/new')
    await expect(s.getByLabel('PAN number')).toBeVisible()
    await expect(s.getByText('As printed on the card')).toBeVisible()
    await expect(s.getByRole('group', { name: 'Identity' })).toBeVisible()
    await expect(s.getByText('As on the latest payslip')).toBeVisible()
    await expect(s.getByRole('group', { name: 'Work today' })).toBeVisible()
    expect(await s.getByLabel('Current title').evaluate((e) => e.tagName)).toBe('TEXTAREA')
    expect(await s.getByLabel(/^Status/).locator('option').allTextContents()).toContain('On hold')
    await expect(s.getByLabel(/^Source/)).toHaveCount(0)
    await expect(s.getByLabel(/Candidate name/)).toBeVisible()
  })

  await test.step('max_length and save_as: the form saves PAN in capitals', async () => {
    await s.getByLabel(/Candidate name/).fill('Priya Nair')
    await s.getByLabel(/^Email/).fill(`priya-${run}@example.in`)
    await s.getByLabel(/^Phone/).fill('+91 98450 60001')
    await s.getByLabel('PAN number').fill('abcde1234f')
    await s.getByRole('button', { name: 'Save candidate' }).click()
    await expect(s.getByRole('heading', { name: 'Priya Nair' })).toBeVisible()
    await expect(s.getByText('ABCDE1234F')).toBeVisible()
  })

  await test.step('min, max, max_length and rules: the live API refuses what the settings forbid', async () => {
    const refused = async (n: number, extra: Record<string, unknown>, text: string) => {
      const r = await call(s, 'POST', '/v1/records/candidate', { data: person(n, extra) })
      expect(r.status, JSON.stringify(r.body)).toBe(422)
      expect(JSON.stringify(r.body)).toContain(text)
    }
    await refused(1, { notice_period_days: 120 }, 'notice_period_days')
    await refused(2, { notice_period_days: -1 }, 'notice_period_days')
    await refused(3, { current_employer: 'Infosys' }, 'current_employer')
    await refused(4, { location: 'Bengaluru1' }, 'Use letters only')
    await refused(5, { pan_number: 'ABCDE1234FG' }, 'pan_number')
    const ok = await call(s, 'POST', '/v1/records/candidate', { data: person(6, { notice_period_days: 45, current_employer: 'TCS', location: 'Bengaluru' }) })
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
  })

  await test.step('hidden: the API leaves the field out; normalize: a different spelling of an email is a duplicate', async () => {
    const mine = await call(s, 'POST', '/v1/records/candidate', { data: person(7, { email: `Dup-${run}@Example.in` }) })
    expect(mine.status).toBe(201)
    expect(Object.keys(mine.body.data)).not.toContain('source')
    const dup = await call(s, 'POST', '/v1/records/candidate', { data: person(8, { email: `dup-${run}@example.in` }) })
    expect(dup.status).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(dup.body)).toMatch(/email/i)
  })

  await test.step('filterable: the list offers no filter on Location, and still filters on Status', async () => {
    await s.goto('/s/candidates')
    await expect(s.getByRole('row').nth(1)).toBeVisible()
    await expect(s.getByRole('button', { name: 'Filter Location' })).toHaveCount(0)
    await expect(s.getByRole('button', { name: 'Filter Status' })).toBeVisible()
  })

  await test.step('aliases and key: the import wizard recognises other names and the new field', async () => {
    await s.goto('/import?table=candidate')
    await s.locator('input[type=file]').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from('Candidate Name,Mobile Number,PAN number\nAsha Rao,9845012345,ABCDE1234F\n') })
    await expect(s.getByText('Match columns').first()).toBeVisible()
    await expect(s.getByLabel('Field for Candidate Name')).toHaveValue('full_name')
    await expect(s.getByLabel('Field for Mobile Number')).toHaveValue('phone')
    await expect(s.getByLabel('Field for PAN number')).toHaveValue('pan_number')
  })

  await test.step('ref_table: a related form offers the records of the table it points at', async () => {
    await s.goto('/records/submission/new')
    await expect(s.getByLabel(/^Candidate/)).toBeVisible()
    expect(await s.getByLabel(/^Candidate/).locator('option').allTextContents()).toContain('Priya Nair')
  })

  await test.step('default: an old default now reads as an if-blank rule on the form', async () => {
    await s.goto('/records/interview/new')
    await expect(s.getByText('Left blank, this becomes “Video”.')).toBeVisible()
  })

  await test.step('analytics: a measure on a number field shows in Insights for everyone', async () => {
    await s.goto('/')
    await expect(s.getByText('Total notice days').first()).toBeVisible()
  })
  await s.context().close()
})
