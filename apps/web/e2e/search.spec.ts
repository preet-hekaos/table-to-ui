import { expect, test, type Page } from '@playwright/test'
import { run, signUpWithPack } from './helpers'

async function api(page: Page, path: string, data: unknown) {
  const token = await page.evaluate(() => sessionStorage.getItem('tableui.token'))
  const r = await page.request.post(path, { data, headers: { Authorization: `Bearer ${token}` } })
  expect(r.ok(), await r.text()).toBeTruthy()
  return r.json()
}

/** M1-S18, S20, S22 to S25: profile, lists, search with facets, saved searches, Ctrl K, ranked matches. */
test('Search, facets, saved searches, command bar and ranked matches', async ({ page }) => {
  await signUpWithPack(page, `Search Co ${run}`, `search-${run}@search.test`)
  const cand = (n: number, extra: Record<string, unknown>) =>
    api(page, '/v1/records/candidate', { data: { email: `p${n}.${run}@gmail.com`, phone: `+91 98${n}00 0${n}000`, status: 'Active', ...extra } })
  const skilled = await cand(1, { full_name: 'Meera Skilled', skills: ['Java', 'Kafka', 'SQL'], location: 'Delhi', total_experience: 72, expected_ctc: 2800000, notice_period_days: 30 })
  await cand(2, { full_name: 'Local Lalit', skills: ['Java'], location: 'Pune', total_experience: 36, expected_ctc: 1500000, notice_period_days: 15 })
  await cand(3, { full_name: 'Python Pooja', skills: ['Python'], location: 'Chennai', total_experience: 150, expected_ctc: 4500000, notice_period_days: 60 })
  await api(page, '/v1/records/consent_record', { data: { candidate: skilled.id, purpose: 'Store profile', status: 'Given' } })
  await api(page, '/v1/records/interaction', { data: { candidate: skilled.id, summary: 'Intro call', kind: 'Call', occurred_on: '2026-10-18' } })
  const client = await api(page, '/v1/records/client', { data: { name: `Aurora ${run}`, status: 'Active' } })
  const req = await api(page, '/v1/records/requirement', {
    data: { title: 'Backend lead', client: client.id, skills: ['Java', 'Kafka', 'SQL'], location: 'Pune', min_experience: 48, max_experience: 96, budget_max: 3000000, max_notice_days: 60 },
  })

  await test.step('S23. Facets narrow the list with counts', async () => {
    await page.goto('/s/candidates')
    const facets = page.getByTestId('facets')
    await expect(facets.getByRole('button', { name: /^Java\s*2$/ })).toBeVisible()
    await facets.getByRole('button', { name: /^Java/ }).click()
    await expect(page.getByRole('link', { name: 'Python Pooja' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Meera Skilled' })).toBeVisible()
    await facets.getByRole('button', { name: /^2 to 5 yrs/ }).click()
    await expect(page.getByRole('link', { name: 'Meera Skilled' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Local Lalit' })).toBeVisible()
  })

  await test.step('S23. Save the search and reopen it from the menu', async () => {
    await page.getByRole('button', { name: 'Save search' }).click()
    await page.getByRole('dialog').getByLabel(/^Name/).fill('Junior Java')
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
    await page.goto('/')
    await page.getByRole('group', { name: 'Saved searches' }).getByRole('link', { name: 'Junior Java' }).click()
    await expect(page.getByRole('link', { name: 'Local Lalit' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Meera Skilled' })).toHaveCount(0)
  })

  await test.step('S24. Ctrl K jumps to a record by name', async () => {
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: 'Search records and screens' }).fill('Auror')
    await expect(page.getByRole('option', { name: new RegExp(`Aurora ${run}`) })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: `Aurora ${run}` })).toBeVisible()
  })

  await test.step('S25. Ranked matches show every part; weights re-rank this view', async () => {
    await page.goto(`/records/requirement/${req.id}`)
    await page.getByRole('link', { name: /See matches/ }).click()
    const ranked = page.getByRole('list', { name: 'Ranked matches' })
    await expect(ranked.getByTestId('match').first()).toContainText('Meera Skilled')
    await expect(ranked.getByTestId('match').first()).toContainText('Skills')
    await expect(ranked.getByTestId('match').last()).toContainText('Python Pooja') // passes the hard filters, scores lowest
    await page.getByLabel('Weight for Skills').fill('0')
    await page.getByLabel('Weight for Location').fill('100')
    await expect(ranked.getByTestId('match').first()).toContainText('Local Lalit')
  })

  await test.step('S18. The profile shows key details, consent, recent activity and the timeline', async () => {
    await page.goto(`/records/candidate/${skilled.id}`)
    const summary = page.getByTestId('profile-summary')
    await expect(summary).toContainText('Consent: Given')
    await expect(summary.getByLabel('Key details')).toContainText('Delhi')
    await expect(summary.getByLabel('Recent activity')).toContainText('Call: Intro call')
    await page.getByRole('tab', { name: 'Timeline' }).click()
    await expect(page.getByRole('row', { name: /Created/ })).toBeVisible()
  })

  await test.step('S20. Clients show owner and open requirements, filterable', async () => {
    await page.goto('/s/clients')
    await expect(page.getByRole('list', { name: 'Clients' })).toContainText('1 open requirements')
    await page.getByLabel('With open requirements').check()
    await expect(page.getByRole('list', { name: 'Clients' }).getByRole('button')).toHaveCount(1)
  })

  await test.step('Phone: actions sit in a bottom bar', async () => {
    await page.setViewportSize({ width: 360, height: 740 })
    await page.goto(`/records/candidate/${skilled.id}`)
    await expect(page.getByRole('navigation', { name: 'Record actions' })).toBeVisible()
  })
})
