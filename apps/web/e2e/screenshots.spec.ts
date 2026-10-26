import { expect, test, type Page } from '@playwright/test'
import { run, signUpWithPack } from './helpers'

/** Documentation captures for the PR, named by the mockup screen they correspond to.
 *  Run on demand: SCREENSHOTS=1 pnpm exec playwright test screenshots */
const out = (n: string) => `../../docs/screens/m1/${n}.png`
const CV = new URL('./fixtures/cv.pdf', import.meta.url)

async function api(page: Page, path: string, data: unknown) {
  const token = await page.evaluate(() => sessionStorage.getItem('tableui.token'))
  const r = await page.request.post(path, { data, headers: { Authorization: `Bearer ${token}` } })
  expect(r.ok(), await r.text()).toBeTruthy()
  return r.json()
}

test('capture M1 screens', async ({ page }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1366, height: 860 })
  await page.goto('/signup')
  await page.getByLabel(/Workspace name/).fill(`Northstar Talent ${run}`)
  await page.getByLabel(/Your name/).fill('Ananya Rao')
  await page.getByLabel(/Work email/).fill(`shots-${run}@northstar.test`)
  await page.getByLabel(/^Password/).fill('correct-horse-battery')
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByRole('heading', { name: /^Set up / })).toBeVisible()
  await page.screenshot({ path: out('1.4-choose-pack') })
  await page.evaluate(() => sessionStorage.clear())
  await signUpWithPack(page, `Northstar Talent Partners ${run}`, `shots2-${run}@northstar.test`)

  // Sample data
  const people = [
    ['Arjun Menon', ['Java', 'Kafka', 'SQL'], 'Pune', 72, 2800000, 30],
    ['Priya Nair', ['Python', 'SQL'], 'Bengaluru', 48, 1800000, 60],
    ['Rohan Shah', ['Java', 'Spring Boot'], 'Pune', 36, 1500000, 15],
    ['Kavya Iyer', ['React', 'TypeScript'], 'Hyderabad', 60, 2200000, 30],
    ['Vikram Rao', ['Java', 'AWS', 'Kafka'], 'Mumbai', 120, 4200000, 90],
  ] as const
  const ids: string[] = []
  for (const [i, [name, skills, city, exp, pay, notice]] of people.entries()) {
    const c = await api(page, '/v1/records/candidate', {
      data: { full_name: name, email: `${name.split(' ')[0]!.toLowerCase()}.${run}@gmail.com`, phone: `+91 98450 1${i}${i}${i}${i}`, skills, location: city, total_experience: exp, expected_ctc: pay, notice_period_days: notice, current_title: 'Software Engineer', current_employer: 'Infosys', status: 'Active' },
    })
    ids.push(c.id)
  }
  await api(page, '/v1/records/consent_record', { data: { candidate: ids[0], purpose: 'Store profile', status: 'Given' } })
  await api(page, '/v1/records/interaction', { data: { candidate: ids[0], summary: 'Intro call about the Pune role', kind: 'Call', occurred_on: '2026-10-18' } })
  const client = await api(page, '/v1/records/client', { data: { name: 'Aurora Fintech', status: 'Active', industry: 'Fintech' } })
  await api(page, '/v1/records/contact', { data: { name: 'Meera Iyer', client: client.id, designation: 'Talent lead' } })
  const req = await api(page, '/v1/records/requirement', {
    data: { title: 'Senior Backend Engineer', client: client.id, skills: ['Java', 'Kafka', 'SQL'], location: 'Pune', min_experience: 48, max_experience: 96, budget_max: 3000000, max_notice_days: 60, positions: 2, target_date: '2026-12-15', brief: 'Payments platform team.' },
  })

  await page.goto('/')
  await page.screenshot({ path: out('1.5-home') })
  await page.goto('/studio')
  await page.screenshot({ path: out('2.4-studio-data') })
  await page.goto('/studio?tab=map')
  await page.screenshot({ path: out('2.5-relationship-map'), fullPage: true })
  await page.goto('/studio?tab=data&table=candidate&part=screens')
  await page.getByRole('button', { name: 'New screen from a pattern' }).click()
  await page.screenshot({ path: out('2.7-pattern-gallery'), fullPage: true })
  await page.getByRole('button', { name: 'New screen from a pattern' }).click()
  await page.getByLabel('Screen to configure').selectOption({ label: 'Candidates' })
  await page.screenshot({ path: out('2.8-screen-configurator'), fullPage: true })
  await page.goto('/studio?tab=menu')
  await page.screenshot({ path: out('2.6-menu'), fullPage: true })
  await page.goto('/studio?tab=preview')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: out('2.15-preview') })
  await page.goto('/studio?tab=versions')
  await page.screenshot({ path: out('2.16-versions'), fullPage: true })

  await page.goto('/s/candidates')
  await expect(page.getByTestId('facets')).toBeVisible()
  await page.screenshot({ path: out('3.4-candidate-search') })
  await page.goto(`/records/candidate/${ids[0]}`)
  await expect(page.getByTestId('profile-summary')).toBeVisible()
  await page.screenshot({ path: out('3.5-candidate-profile'), fullPage: true })
  await page.goto('/records/candidate/new')
  await page.screenshot({ path: out('3.6-candidate-form'), fullPage: true })
  await page.goto('/s/cv_intake')
  await page.getByLabel('Document to read').setInputFiles(CV.pathname)
  await expect(page.getByTestId('parse-summary')).toBeVisible()
  await page.waitForTimeout(800)
  await page.screenshot({ path: out('3.7-cv-review') })
  await page.goto('/s/clients')
  await expect(page.getByRole('heading', { name: 'Aurora Fintech' })).toBeVisible()
  await page.screenshot({ path: out('3.10-3.11-clients-master-detail') })
  await page.goto('/s/requirements')
  await page.screenshot({ path: out('3.13-requirements') })
  await page.goto(`/records/requirement/${req.id}`)
  await page.screenshot({ path: out('3.15-requirement-detail'), fullPage: true })
  await page.goto(`/match/requirement_matches/${req.id}`)
  await expect(page.getByTestId('match').first()).toBeVisible()
  await page.screenshot({ path: out('3.16-ranked-matches'), fullPage: true })
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Search records and screens' }).fill('aur')
  await expect(page.getByRole('option').first()).toBeVisible()
  await page.screenshot({ path: out('3.3-command-bar') })
  await page.keyboard.press('Escape')

  const csv = ['Name,E-mail,Mobile,Company,Experience,Expected Salary,Joined', `Neel Shah,neel.${run}@gmail.com,098450 61111,Infosys,5 yrs 3 mo,12.5 LPA,19/10/2026`, 'Bad Row,not-an-email,9845061112,Wipro,3 yrs,10 LPA,', `Rohan Twin,rohan.twin.${run}@gmail.com,+91 98450 12222,Infosys,5 yrs,12 LPA,`].join('\n')
  await page.goto('/import')
  await page.getByLabel('Import into').selectOption({ label: 'Candidates' })
  await page.getByLabel('Spreadsheet').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByRole('table', { name: 'Columns' })).toBeVisible()
  await page.screenshot({ path: out('2.2-import-mapping'), fullPage: true })
  await page.getByRole('button', { name: 'Check the data' }).click()
  await expect(page.getByTestId('validation-report')).toBeVisible()
  await page.screenshot({ path: out('2.2-import-check'), fullPage: true })
  await page.getByRole('button', { name: /^Load/ }).click()
  await expect(page.getByTestId('reconciliation')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: out('2.3-import-reconciliation') })

  await page.goto('/settings?tab=branding')
  await page.screenshot({ path: out('1.9-branding') })
  await page.goto('/settings?tab=roles')
  await page.screenshot({ path: out('1.8-roles-grid') })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/s/candidates')
  await page.screenshot({ path: out('mobile-3.4-candidates') })
  await page.goto(`/records/candidate/${ids[0]}`)
  await expect(page.getByRole('navigation', { name: 'Record actions' })).toBeVisible()
  await page.screenshot({ path: out('mobile-3.5-profile') })
})
