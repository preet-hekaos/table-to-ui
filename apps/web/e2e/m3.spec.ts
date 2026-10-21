/* eslint-disable @typescript-eslint/no-explicit-any -- test helper returns untyped API JSON */
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, signUpWithPack } from './helpers'

const shot = async (page: Page, name: string) => {
  if (process.env.SCREENSHOTS) await page.screenshot({ path: `../../docs/screens/m3/${name}.png`, fullPage: true })
}

async function api<T = Record<string, any>>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ([m, p, b]) => {
      const res = await fetch(p as string, {
        method: m as string,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
        body: b === undefined ? undefined : JSON.stringify(b),
      })
      if (res.status === 204) return null
      const json = await res.json()
      if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json)}`)
      return json
    },
    [method, path, body] as const,
  ) as Promise<T>
}

const today = new Date().toISOString().slice(0, 10)

/** The M3 demo script: an owner reads the numbers, checks one against its records, and adds a measure. */
test('M3 demo: insights', async ({ page }) => {
  await signUpWithPack(page, `Northstar M3 ${run}`, `m3-${run}@northstar.test`)
  const rec = (table: string, data: unknown) => api<{ id: string }>(page, 'POST', `/v1/records/${table}`, { data })

  await test.step('1. Seed a small pipeline and make the app live', async () => {
    const c = await rec('client', { name: 'Acme Corp', status: 'Active' })
    const job = await rec('requirement', { title: 'Backend Engineer', client: c.id, status: 'Open' })
    for (const [i, name] of ['Asha Verma', 'Bilal Khan', 'Chitra Nair'].entries()) {
      const cand = await rec('candidate', { full_name: name, email: `m3-${i}-${run}@gmail.com`, phone: `+91 9000${i}00000`, status: 'Active' })
      const s = await rec('submission', { summary: `${name} for Backend`, candidate: cand.id, requirement: job.id, stage: 'Sourced' })
      if (i > 0) await api(page, 'PATCH', `/v1/records/submission/${s.id}`, { version: 1, data: { stage: 'Screened', submitted_on: today } })
    }
    const rel = await api<{ version: number }>(page, 'POST', '/v1/apps/current/releases')
    await api(page, 'POST', `/v1/apps/current/releases/${rel.version}/promote`)
  })

  await test.step('2. Insights lists the dashboard with a number, bars and a trend', async () => {
    await page.goto('/insights')
    await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible()
    const active = page.getByTestId('insight-active_candidates')
    await expect.poll(async () => active.textContent(), { timeout: 20_000 }).toContain('3')
    await expect(page.getByTestId('insight-submissions_by_stage').getByRole('list', { name: 'Submissions by stage' })).toBeVisible()
    await expect(page.getByTestId('insight-submissions_sent').getByRole('img')).toBeVisible()
    await shot(page, 'insights')
  })

  await test.step('3. A trend can be read as a table', async () => {
    const card = page.getByTestId('insight-submissions_sent')
    await card.getByRole('button', { name: 'Show as table' }).click()
    await expect(card.getByRole('table', { name: /Submissions sent to clients by/ })).toBeVisible()
    await card.getByRole('button', { name: 'Show chart' }).click()
  })

  await test.step('4. Clicking a bar lists exactly those records, and the count matches', async () => {
    await page.getByRole('link', { name: /^Screened\s*2/ }).click()
    await expect(page.getByTestId('drill-count')).toHaveText(/^2 records/)
    await expect(page.getByRole('table', { name: 'Records behind this number' }).getByRole('link')).toHaveCount(2)
    await shot(page, 'drill-down')
    await page.getByRole('link', { name: '← Insights' }).click()
  })

  await test.step('5. Changing the dates changes the numbers and keeps the choice in the link', async () => {
    await page.getByLabel('Dates', { exact: true }).selectOption('custom')
    await page.getByLabel('From', { exact: true }).fill('2020-01-01')
    await page.getByLabel('To', { exact: true }).fill('2020-01-31')
    await expect(page).toHaveURL(/range=custom/)
    await expect(page.getByTestId('insight-submissions_sent').getByRole('link', { name: /^Submissions sent to clients: 0/ })).toBeVisible()
    await page.goto('/insights?range=this_month')
    await expect(page.getByLabel('Dates', { exact: true })).toHaveValue('this_month')
  })

  await test.step('6. Home shows the highlights and links to the records', async () => {
    await page.goto('/')
    await expect(page.getByTestId('measure-active_candidates')).toBeVisible()
    await expect(page.getByTestId('measure-submissions_by_stage')).toHaveCount(0)
    await page.getByRole('link', { name: /^Active candidates: 3/ }).click()
    await expect(page.getByTestId('drill-count')).toHaveText(/^3 records/)
  })

  await test.step('7. In the Studio an admin adds a measure and sees its number first', async () => {
    await page.goto('/studio?tab=insights')
    await expect(page.getByRole('list', { name: 'Measures' })).toBeVisible()
    await page.getByRole('button', { name: 'Add a measure' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Screened submissions')
    await page.getByLabel('Count records in').selectOption('submission')
    await page.getByLabel('Filter field').selectOption('stage')
    await page.getByLabel('Filter value').fill('Screened')
    await expect(page.getByTestId('measure-preview')).toContainText('Would show 2')
    await shot(page, 'builder')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByTestId('measure-row-screened_submissions')).toBeVisible()
  })

  await test.step('8. A pack measure cannot be changed, only renamed or hidden', async () => {
    await page.getByRole('button', { name: 'Edit measure Open jobs' }).click()
    await expect(page.getByText('This measure comes with the pack.')).toBeVisible()
    await expect(page.getByLabel('Count records in')).toHaveCount(0)
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  await test.step('9. After publishing, the new measure shows with the right number', async () => {
    const rel = await api<{ version: number }>(page, 'POST', '/v1/apps/current/releases')
    await api(page, 'POST', `/v1/apps/current/releases/${rel.version}/promote`)
    await page.goto('/insights')
    const card = page.getByTestId('insight-screened_submissions')
    await expect.poll(async () => card.textContent(), { timeout: 20_000 }).toContain('2')
  })

  await test.step('10. The pages pass WCAG 2.2 AA and fit a 360 px phone', async () => {
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
    for (const url of ['/insights', '/studio?tab=insights']) {
      await page.goto(url)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.waitForLoadState('networkidle')
      const r = await new AxeBuilder({ page }).withTags(tags).analyze()
      expect(r.violations, r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
    }
    await page.setViewportSize({ width: 360, height: 740 })
    await page.goto('/insights')
    await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, 'scrolls sideways at 360px').toBeLessThanOrEqual(0)
    await shot(page, 'insights-phone')
  })
})
