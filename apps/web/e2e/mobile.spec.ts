import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { run, signUpWithPack } from './helpers'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function api(page: Page, path: string, data: unknown) {
  const token = await page.evaluate(() => sessionStorage.getItem('tableui.token'))
  const r = await page.request.post(path, { data, headers: { Authorization: `Bearer ${token}` } })
  expect(r.ok(), await r.text()).toBeTruthy()
  return r.json()
}

async function check(page: Page, path: string) {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `${path} scrolls sideways at 360px`).toBeLessThanOrEqual(0)
  const r = await new AxeBuilder({ page }).withTags(tags).analyze()
  expect(r.violations, `${path}: ${r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')}`).toEqual([])
}

/** The M1 demo screens on a 360 px phone: every one fits, passes axe and keeps actions in reach. */
test('M1 screens at 360 px', async ({ page }) => {
  await signUpWithPack(page, `Phone Co ${run}`, `phone-${run}@phone.test`)
  const cand = await api(page, '/v1/records/candidate', { data: { full_name: 'Arjun Menon', email: `arjun.${run}@gmail.com`, phone: '+91 98450 12345', skills: ['Java'], location: 'Pune', status: 'Active' } })
  await api(page, '/v1/records/interaction', { data: { candidate: cand.id, summary: 'Intro call', kind: 'Call' } })
  const client = await api(page, '/v1/records/client', { data: { name: 'Aurora Fintech' } })
  const req = await api(page, '/v1/records/requirement', { data: { title: 'Java lead', client: client.id, skills: ['Java'] } })
  await page.setViewportSize({ width: 360, height: 740 })
  for (const path of ['/', '/s/candidates', `/records/candidate/${cand.id}`, '/s/clients', '/s/requirements', `/records/requirement/${req.id}`, `/match/requirement_matches/${req.id}`, '/s/cv_intake', '/import', '/studio', '/settings']) {
    await check(page, path)
  }
  await page.goto(`/records/candidate/${cand.id}`)
  // Key details and recent activity come before the tabs; actions sit in a bottom bar.
  const summary = page.getByTestId('profile-summary')
  const tabs = page.getByRole('tablist', { name: 'Record sections' })
  expect((await summary.boundingBox())!.y).toBeLessThan((await tabs.boundingBox())!.y)
  const bar = page.getByRole('navigation', { name: 'Record actions' })
  await expect(bar.getByRole('link', { name: 'Edit' })).toBeVisible()
  const box = (await bar.boundingBox())!
  expect(box.y + box.height).toBeGreaterThan(700)
  // Facets fold behind a Filters button.
  await page.goto('/s/candidates')
  await expect(page.getByTestId('facets')).toBeHidden()
  await page.getByRole('button', { name: 'Filters' }).click()
  await expect(page.getByTestId('facets')).toBeVisible()
})
