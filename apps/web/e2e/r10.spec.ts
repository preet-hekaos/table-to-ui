import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { expectReadable, putFeatures, run, signUpWithPack } from './helpers'

const token = (page: Page) => page.evaluate(() => sessionStorage.getItem('tableui.token'))

async function goLive(page: Page) {
  const t = await token(page)
  const rel = await page.evaluate(async (tk) => {
    const r = await fetch('/v1/apps/current/releases', { method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' } })
    return (await r.json()) as { version: number }
  }, t)
  const ok = await page.evaluate(async ([tk, v]) => (await fetch(`/v1/apps/current/releases/${v}/promote`, { method: 'POST', headers: { Authorization: `Bearer ${tk}` } })).status, [t, rel.version] as [string | null, number])
  expect(ok).toBeLessThan(300)
}

const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(1100) // let the bars and lines finish drawing
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png`, fullPage: true })
}

async function seed(page: Page) {
  const made = await page.evaluate(async () => {
    const places = ['Kochi', 'Kochi', 'Kochi', 'Mumbai', 'Mumbai', 'Pune', 'Chennai', 'Chennai', 'Noida', 'Hyderabad', 'Hyderabad', 'Hyderabad']
    const out: number[] = []
    for (const [i, location] of places.entries()) {
      const res = await fetch('/v1/records/candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
        body: JSON.stringify({ data: { full_name: `Person ${String(i).padStart(2, '0')}`, location, status: i % 5 === 0 ? 'Archived' : 'Active', notice_period_days: 15 + i * 5, expected_ctc: 800000 + i * 50000, email: `p${i}@example.in`, phone: `+91 98450 3${String(1000 + i)}` } }),
      })
      out.push(res.status)
    }
    return out
  })
  expect(made.every((s) => s === 201)).toBe(true)
}

test('Cards: a name and one number, spread evenly whatever the count', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUpWithPack(page, `Even Co ${run}`, `even-${run}@even.test`)
  await seed(page)
  const put = (cards: unknown[]) =>
    page.evaluate(async (c) => (await fetch('/v1/studio/tables/candidate/features', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` }, body: JSON.stringify({ stat_cards: c }) })).status, cards)
  const many = [{ kind: 'count' }, { kind: 'number', field: 'notice_period_days', measure: 'avg' }, { kind: 'number', field: 'expected_ctc', measure: 'avg' }, { kind: 'value', field: 'status', value: 'Active' }, { kind: 'value', field: 'status', value: 'Archived' }, { kind: 'number', field: 'expected_ctc', measure: 'max' }]
  for (const n of [3, 4, 5, 6]) {
    expect(await put(many.slice(0, n))).toBe(200)
    await goLive(page)
    await page.goto('/s/candidates')
    const cards = page.getByTestId('stat-card')
    await expect(cards).toHaveCount(n)
    const boxes = await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) })))
    expect(new Set(boxes.map((b) => b.w)).size, `${n} cards share one width`).toBe(1)
    const rows = [...new Set(boxes.map((b) => b.y))]
    expect(rows.length, `${n} cards: rows`).toBe(n <= 4 ? 1 : 2)
    const full = await page.getByTestId('stats-strip').boundingBox()
    const last = boxes.filter((b) => b.y === boxes[0]!.y).at(-1)!
    expect(Math.abs(last.x + last.w - (full!.x + full!.width)), `${n} cards fill the row`).toBeLessThan(3)
    expect(await cards.first().locator('p').count(), 'a name and one number').toBe(2)
    if (n === 5) await shot(page, 'r10-cards-5')
  }
})

test('Chart: chosen in Studio, drawn above the table, changed on the screen, click a bar to filter', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await signUpWithPack(page, `Chart Co ${run}`, `chart-${run}@chart.test`)
  await seed(page)

  await test.step('The Features tab no longer has chart or default settings; they are on the table screen', async () => {
    await page.goto('/studio?tab=data&table=candidate&part=features')
    const panel = page.getByTestId('features-panel')
    await expect(panel.getByLabel('Show numbers as')).toHaveCount(0)
    await expect(panel.getByTestId('chart-editor')).toHaveCount(0)
    await expect(panel.getByLabel('Row density')).toHaveCount(0)
    await putFeatures(page, 'candidate', { chart: { type: 'combo', x: 'location', bucket: 'month', measures: [{ agg: 'count' }, { agg: 'avg', field: 'notice_period_days' }], top: 8 } })
    await goLive(page)
  })

  await test.step('A person switches the numbers from cards to a chart, and it is remembered', async () => {
    await page.goto('/s/candidates')
    await expect(page.getByTestId('stats-strip')).toBeVisible()
    await page.getByRole('radio', { name: 'Chart', exact: true }).click()
    await page.reload()
    await expect(page.getByTestId('chart-card')).toBeVisible()
  })

  const card = page.getByTestId('chart-card')
  await test.step('The chart is above the table and groups by location', async () => {
    await page.goto('/s/candidates')
    await expect(card).toBeVisible()
    await expect(page.getByTestId('stats-strip')).toHaveCount(0)
    await expect(card.getByRole('heading', { name: 'Candidates by location', includeHidden: true })).toBeAttached()
    await expect(card.getByRole('button', { name: /^Kochi: Candidates 3/ })).toBeVisible()
    await expect(card.getByLabel('Group by')).toHaveValue('location')
    await expect(card.getByRole('group', { name: 'Series' }).or(card.getByRole('list', { name: 'Series' }))).toContainText('Average notice period')
    await shot(page, 'r10-chart-combo')
  })

  await test.step('Hovering shows the exact numbers', async () => {
    await card.getByRole('button', { name: /^Mumbai:/ }).hover()
    const tip = page.getByTestId('chart-tip')
    await expect(tip).toContainText('Mumbai')
    await expect(tip).toContainText('Candidates')
    await expect(tip).toContainText('Click to filter the table')
    await shot(page, 'r10-chart-tip')
  })

  await test.step('Clicking a bar filters the table; clicking it again clears', async () => {
    await card.getByRole('button', { name: /^Kochi:/ }).click()
    await expect(card.getByRole('button', { name: /^Kochi:/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(card.getByRole('status')).toContainText('Location = Kochi')
    await expect(page.getByText(/3 candidates shown/)).toBeVisible()
    await expect(card.getByRole('button', { name: /^Mumbai:/ })).toBeVisible() // the other groups stay on the chart
    await shot(page, 'r10-chart-selected')
    await card.getByRole('button', { name: /^Kochi:/ }).click()
    await expect(page.getByText(/12 candidates shown/)).toBeVisible()
  })

  await test.step('Anyone can change the chart on the screen, and it is remembered', async () => {
    await card.getByLabel('Group by').selectOption({ label: 'Status' })
    await expect(card.getByRole('heading', { name: 'Candidates by status', includeHidden: true })).toBeAttached()
    await expect(card.getByRole('button', { name: /^Active:/ })).toBeVisible()
    for (const type of ['Bars', 'Horizontal bars', 'Line', 'Area', 'Share', 'Bars and line']) {
      await card.getByRole('radio', { name: type, exact: true }).click()
      await expect(card.getByRole('radio', { name: type, exact: true })).toHaveAttribute('aria-checked', 'true')
      await expect(card.getByRole('button', { name: /^Active:/ })).toBeVisible()
      await shot(page, `r10-chart-${type.toLowerCase().replace(/ /g, '-')}`)
    }
    await card.getByRole('radio', { name: 'Horizontal bars', exact: true }).click()
    await page.reload()
    await expect(card.getByRole('radio', { name: 'Horizontal bars', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(card.getByLabel('Group by')).toHaveValue('status')
  })

  await test.step('A series can be switched off in the legend, and the numbers are also a table', async () => {
    await card.getByRole('radio', { name: 'Bars and line', exact: true }).click()
    const avg = card.getByRole('button', { name: /Average notice period/ }).first()
    await expect(avg).toHaveAttribute('aria-pressed', 'true')
    await avg.click()
    await expect(avg).toHaveAttribute('aria-pressed', 'false')
    await avg.click()
    await card.getByRole('button', { name: 'Table view' }).click()
    await expect(card.getByRole('table')).toContainText('Active')
    await card.getByRole('button', { name: 'Table view' }).click()
    await card.getByRole('button', { name: 'Hide the chart' }).click()
    await expect(card.getByRole('radiogroup', { name: 'Chart type' })).toHaveCount(0)
    await card.getByRole('button', { name: 'Show the chart' }).click()
  })

  await test.step('Readable, and no accessibility violations', async () => {
    await expectReadable(page, card.getByRole('heading', { name: /Candidates by/ }), ['rest'])
    await expectReadable(page, card.getByRole('radio', { name: 'Bars', exact: true }), ['rest', 'hover'])
    const r = await new AxeBuilder({ page }).analyze()
    expect(r.violations).toEqual([])
  })
})

test('A refused save says so instead of doing nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUpWithPack(page, `Refuse Co ${run}`, `refuse-${run}@refuse.test`)
  await page.route('**/v1/studio/tables/candidate/features', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 422, contentType: 'application/problem+json', body: JSON.stringify({ type: 'x/validation', title: 'Invalid', status: 422, detail: 'Extra inputs are not permitted', errors: [{ field: 'chart', code: 'extra', message: 'Extra inputs are not permitted' }] }) })
      : route.continue(),
  )
  await page.goto('/studio?tab=data&table=candidate&part=features')
  const panel = page.getByTestId('features-panel')
  await panel.getByRole('switch', { name: 'Drag to reorder' }).uncheck()
  await panel.getByRole('button', { name: 'Save features' }).click()
  await expect(page.getByText('Could not save features').first()).toBeVisible()
  await expect(page.getByText(/restart the API/).first()).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Save features' })).toBeEnabled()
})
