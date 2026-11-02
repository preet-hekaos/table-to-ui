import { expect, test, type Page } from '@playwright/test'
import { run, signUpWithPack } from './helpers'
import { freshSession, publishLive } from './live-effect'

const SHOTS = '../../docs/screens/studio-table/s5'
const cell = (page: Page) => page.getByTestId('transform-of-notice_period_days')
const panel = (page: Page) => page.getByRole('dialog', { name: 'Transformation rules · Notice period (days)' })

async function addRule(page: Page, when: string, whenArgs: string | null, action: string, value: string | null) {
  const p = panel(page)
  await p.getByLabel('New rule condition').selectOption({ label: when })
  await p.getByLabel('New rule action').selectOption({ label: action })
  const n = await p.getByRole('list', { name: 'Rules' }).getByRole('listitem').count()
  const rule = `Rule ${n}`
  if (whenArgs !== null) await p.getByLabel(new RegExp(`^${rule} (values|condition value|pattern)$`)).fill(whenArgs)
  if (value !== null) await p.getByLabel(new RegExp(`^${rule} (action value|characters to remove)$`)).last().fill(value)
}

test('S5.2 the Transformation rules panel: build three rules, try values, order, switch, Cancel versus Done', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1500, height: 1100 })
  await signUpWithPack(page, `S5 Rules ${run}`, `s5a-${run}@studio.test`)
  await page.goto('/studio')

  await test.step('The column says Add until there are rules', async () => {
    await expect(cell(page)).toContainText('Add')
  })

  await test.step('Build the three rules of the mockup', async () => {
    await cell(page).click()
    await expect(panel(page)).toBeVisible()
    await addRule(page, 'is blank', null, 'set to a value', '30')
    await panel(page).getByRole('checkbox', { name: 'and stop' }).first().check()
    await addRule(page, 'equals any of', 'immediate, serving, ASAP', 'set to a value', '0')
    await addRule(page, 'matches a pattern', '^(\\d+)\\s*d(ays?)?$', 'keep the part that matched', null)
    await expect(panel(page).getByRole('list', { name: 'Rules' }).getByRole('listitem')).toHaveCount(3)
    await panel(page).getByLabel('Rule 1 action value').waitFor()
  })

  await test.step('Try a value runs the real function and names the rule that applied', async () => {
    const p = panel(page)
    await p.getByLabel('Value to try 1').fill('Serving')
    await expect(p.getByTestId('try-result-0')).toContainText('0')
    await expect(p.getByTestId('try-result-0')).toContainText('rule 2 applied')
    await p.getByRole('button', { name: '+ Another value' }).click()
    await p.getByLabel('Value to try 2').fill('45 days')
    await expect(p.getByTestId('try-result-1')).toContainText('45')
    await p.getByRole('button', { name: '+ Another value' }).click()
    await p.getByLabel('Value to try 3').fill('banana')
    await expect(p.getByTestId('try-result-2')).toContainText('refused')
    await page.screenshot({ path: `${SHOTS}/after-panel.png` })
  })

  await test.step('Reorder and switch off change the preview', async () => {
    const p = panel(page)
    await p.getByRole('switch', { name: 'Rule 2 is on' }).click()
    await expect(p.getByTestId('try-result-0')).toContainText('no rule applied')
    await p.getByRole('switch', { name: 'Rule 2 is on' }).click()
    await expect(p.getByTestId('try-result-0')).toContainText('rule 2 applied')
    await p.getByRole('button', { name: 'Move rule 3 up' }).click()
    await expect(p.getByLabel('Rule 2 condition')).toHaveValue('matches')
    await p.getByRole('button', { name: 'Move rule 2 down' }).click()
  })

  await test.step('Cancel throws everything away; Done saves to the Draft', async () => {
    await panel(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(cell(page)).toContainText('Add')
    await cell(page).click()
    await expect(panel(page).getByRole('list', { name: 'Rules' }).getByRole('listitem')).toHaveCount(0)
    await addRule(page, 'is blank', null, 'set to a value', '30')
    await panel(page).getByRole('checkbox', { name: 'and stop' }).first().check()
    await addRule(page, 'equals any of', 'immediate, serving, ASAP', 'set to a value', '0')
    await addRule(page, 'matches a pattern', '^(\\d+)\\s*d(ays?)?$', 'keep the part that matched', null)
    await panel(page).getByRole('button', { name: 'Done' }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect(cell(page)).toContainText('If blank → 30')
    await expect(cell(page)).toContainText('+2 more')
    await cell(page).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/after-cell.png` })
  })

  await test.step('Studio to live: a blank notice saves 30, Serving saves 0, 45 days saves 45', async () => {
    await publishLive(page)
    const other = await freshSession(browser, page)
    const make = (i: number, notice?: string) =>
      other.evaluate(
        async ([n, notice]) => {
          const r = await fetch('/v1/records/candidate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
            body: JSON.stringify({ data: { full_name: `P${n}`, email: `p${n}@x.test`, phone: `+91 98450 4${n}000`, status: 'Active', ...(notice === undefined ? {} : { notice_period_days: notice }) } }),
          })
          return { status: r.status, v: ((await r.json()) as { data?: { notice_period_days?: unknown } }).data?.notice_period_days }
        },
        [i, notice] as [number, string | undefined],
      )
    expect(await make(1)).toEqual({ status: 201, v: 30 })
    expect(await make(2, 'Serving')).toEqual({ status: 201, v: 0 })
    expect(await make(3, '45 days')).toEqual({ status: 201, v: 45 })
    await other.context().close()
  })
})

test('S5.3 say it in words: disabled with AI off, a checked suggestion with AI on, added only by Use as rule', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1100 })
  await signUpWithPack(page, `S5 Words ${run}`, `s5w-${run}@studio.test`)
  await page.goto('/studio')

  await test.step('With AI off the panel is disabled and says why', async () => {
    await cell(page).click()
    const p = panel(page)
    await expect(p.getByText('AI is off for this workspace, so this panel is disabled')).toBeVisible()
    await expect(p.getByLabel('Describe what should happen')).toBeDisabled()
    await p.getByRole('button', { name: 'Cancel' }).click()
  })

  await test.step('An admin turns AI on', async () => {
    const status = await page.evaluate(async () => {
      const r = await fetch('/v1/ai/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` }, body: JSON.stringify({ enabled: true, tables: [] }) })
      return r.status
    })
    expect(status).toBe(200)
    await page.goto('/studio')
  })

  await test.step('A description makes a checked suggestion; nothing is added until Use as rule', async () => {
    await cell(page).click()
    const p = panel(page)
    await p.getByLabel('Describe what should happen').fill('if it says two months, save 60')
    await p.getByRole('button', { name: 'Make a rule' }).click()
    const prop = p.getByTestId('words-proposal')
    await expect(prop).toContainText('two months')
    await expect(prop.getByRole('list', { name: 'Examples' })).toContainText('two months→60')
    await expect(p.getByRole('list', { name: 'Rules' }).getByRole('listitem')).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/after-words.png` })
    await prop.getByRole('button', { name: 'Use as rule' }).click()
    await expect(p.getByRole('list', { name: 'Rules' }).getByRole('listitem')).toHaveCount(1)
    await expect(p.getByLabel('Rule 1 condition')).toHaveValue('equals_any')
    await p.getByLabel('Value to try 1').fill('two months')
    await expect(p.getByTestId('try-result-0')).toContainText('60')
    await p.getByRole('button', { name: 'Done' }).click()
    await expect(cell(page)).not.toContainText('Add')
  })
})

test('S5.4 Studio to live: the form hint, trim and Title Case, a rule switched off, update without the field, a refused value names itself', async ({ page, browser }) => {
  await signUpWithPack(page, `S5 Live ${run}`, `s5l-${run}@studio.test`)
  const tok = () => sessionStorage.getItem('tableui.token')
  await test.step('The owner sets three rules in the Draft and makes them Live', async () => {
    const statuses = await page.evaluate(async () => {
      const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` }
      const patch = (f: string, transforms: unknown[]) => fetch(`/v1/studio/tables/candidate/fields/${f}`, { method: 'PATCH', headers: h, body: JSON.stringify({ transforms }) }).then((r) => r.status)
      return [
        await patch('notice_period_days', [{ when: 'blank', args: [], do: 'set', value: '30', stop: true, enabled: true }]),
        await patch('full_name', [{ when: 'blank', args: [], do: 'set', value: '', stop: false, enabled: false }, { do: 'trim', when: 'contains', args: [' '], value: '', stop: false, enabled: true }, { when: 'contains', args: [' '], do: 'case', value: 'title', stop: false, enabled: true }]),
        await patch('current_title', [{ when: 'contains', args: ['xx'], do: 'clear', value: '', stop: false, enabled: false }]),
      ]
    })
    expect(statuses).toEqual([200, 200, 200])
    void tok
    await publishLive(page)
  })

  const other = await freshSession(browser, page)
  const api = (method: string, path: string, body?: unknown) =>
    other.evaluate(
      async ([m, p, b]) => {
        const r = await fetch(p as string, { method: m as string, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` }, body: b ? JSON.stringify(b) : undefined })
        return { status: r.status, body: await r.json().catch(() => null) } as { status: number; body: { id?: string; data?: Record<string, unknown>; errors?: { field: string; message: string }[] } | null }
      },
      [method, path, body] as [string, string, unknown],
    )

  await test.step('The Add form says what a blank becomes, and saves without asking for it', async () => {
    await other.goto('/records/candidate/new')
    await expect(other.getByText('Left blank, this becomes “30”.')).toBeVisible()
    await other.getByLabel(/Full name/).fill('  arjun   MENON ')
    await other.getByLabel(/^Email/).fill(`arjun-${run}@live.test`)
    await other.getByLabel(/^Phone/).fill('+91 98450 11111')
    await other.getByLabel(/Notice period/).scrollIntoViewIfNeeded()
    await other.screenshot({ path: `${SHOTS}/after-form-hint.png` })
    await other.getByRole('button', { name: 'Save candidate' }).click()
    await expect(other.getByRole('heading', { name: 'Arjun Menon' })).toBeVisible()
    await expect(other.getByText('30').first()).toBeVisible()
  })

  await test.step('An update that leaves the field out never touches it; a refused value names itself', async () => {
    const made = await api('POST', '/v1/records/candidate', { data: { full_name: 'Neha Rao', email: `neha-${run}@live.test`, phone: '+91 98450 22222', status: 'Active', notice_period_days: 45 } })
    expect(made.status, JSON.stringify(made.body)).toBe(201)
    const id = made.body!.id!
    const upd = await api('PATCH', `/v1/records/candidate/${id}`, { version: 1, data: { current_employer: 'Infosys' } })
    expect(upd.status).toBe(200)
    expect(upd.body!.data!.notice_period_days).toBe(45)
    const bad = await api('PATCH', `/v1/records/candidate/${id}`, { version: 2, data: { notice_period_days: 'banana' } })
    expect(bad.status).toBe(422)
    expect(JSON.stringify(bad.body)).toContain('whole number')
  })
  await other.context().close()
})
