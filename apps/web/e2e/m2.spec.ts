/* eslint-disable @typescript-eslint/no-explicit-any -- test helper returns untyped API JSON */
import { expect, test, type Browser, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { PASSWORD, run, signUpWithPack } from './helpers'
import { totp } from './totp'

const shot = async (page: Page, name: string) => {
  if (process.env.SCREENSHOTS) await page.screenshot({ path: `../../docs/screens/m2/${name}.png`, fullPage: true })
}

/** Call the API as the signed-in user of this page (same origin, so the dev proxy applies). */
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

async function enrolMfa(page: Page): Promise<string> {
  await page.goto('/security')
  await page.getByRole('button', { name: 'Start setup' }).click()
  const secret = (await page.getByTestId('mfa-secret').textContent())!.trim()
  await page.getByLabel('6-digit code').fill(totp(secret))
  await page.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByText('Two-step sign-in is on for your account.')).toBeVisible()
  return secret
}

async function signInWithMfa(page: Page, email: string, secret: string) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('6-digit code').fill(totp(secret))
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  return ctx.newPage()
}

const moveTo = async (page: Page, who: string, stage: string) => {
  await page.getByLabel(`Move ${who} to`).selectOption(stage)
}

/** The M2 demo script: a candidate goes through the pipeline; rules block, a manager approves, duplicates merge. */
test('M2 demo: pipeline, guard rules, approvals, duplicates', async ({ browser }) => {
  const agency = `Northstar M2 ${run}`
  const ananya = await newPage(browser)
  const priya = await newPage(browser)
  const priyaEmail = `priya-m2-${run}@northstar.test`
  let priyaSecret = ''
  const ids: Record<string, string> = {}

  await test.step('1. Ananya signs up with Recruitment and sets up a client, a requirement and a candidate', async () => {
    await signUpWithPack(ananya, agency, `m2-${run}@northstar.test`)
    const c = await api(ananya, 'POST', '/v1/records/client', { data: { name: 'Aurora Fintech', status: 'Active', fee_percent: 8.33, min_fee: 300000 } })
    ids.client = c.id
    const r = await api(ananya, 'POST', '/v1/records/requirement', {
      data: { title: 'Senior Backend Engineer', client: c.id, status: 'Open', positions: 1, budget_max: 3000000 },
    })
    ids.requirement = r.id
    const k = await api(ananya, 'POST', '/v1/records/candidate', {
      data: { full_name: 'Arjun Menon', email: `arjun-${run}@gmail.com`, phone: `+91 98${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, status: 'Active' },
    })
    ids.candidate = k.id
  })

  await test.step('2. Ananya adds Arjun to the requirement; he starts at Sourced on the pipeline', async () => {
    await ananya.goto('/records/submission/new')
    await ananya.getByLabel(/^Summary/).fill('Arjun for Senior Backend Engineer')
    await ananya.getByLabel(/^Candidate/).selectOption({ label: 'Arjun Menon' })
    await ananya.getByLabel(/^Requirement/).selectOption({ label: 'Senior Backend Engineer' })
    await ananya.getByRole('button', { name: 'Save submission' }).click()
    await expect(ananya.getByRole('heading', { name: 'Arjun for Senior Backend Engineer' })).toBeVisible()
    await ananya.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pipeline' }).click()
    const sourced = ananya.getByRole('listitem', { name: /^Sourced, 1 card/ })
    await expect(sourced.getByRole('link', { name: 'Arjun for Senior Backend Engineer' })).toBeVisible()
    await shot(ananya, '01-pipeline-board')
  })

  await test.step('3. Moving a card follows the allowed steps; skipping a step is refused', async () => {
    await expect(ananya.getByLabel('Move Arjun for Senior Backend Engineer to').locator('option')).toHaveText(['Move to…', 'Screened', 'Rejected', 'Withdrawn', 'On hold'])
    await moveTo(ananya, 'Arjun for Senior Backend Engineer', 'Screened')
    await expect(ananya.getByRole('listitem', { name: /^Screened, 1 card/ })).toBeVisible()
  })

  await test.step('4. Submitting without consent is blocked by R-02 and says why', async () => {
    await moveTo(ananya, 'Arjun for Senior Backend Engineer', 'Submitted')
    const ask = ananya.getByRole('dialog', { name: 'Move to Submitted' })
    await ask.getByRole('button', { name: 'Move to Submitted' }).click()
    const blocked = ananya.getByRole('dialog', { name: 'Cannot move to Submitted' })
    await expect(blocked).toContainText('R-02')
    await expect(blocked.getByLabel(/Override with a reason/)).toHaveCount(0) // consent can never be overridden
    await shot(ananya, '02-blocked-by-rule')
    await ananya.keyboard.press('Escape')
  })

  await test.step('5. With consent recorded the move goes through, asking for the client contact', async () => {
    await api(ananya, 'POST', '/v1/records/consent_record', { data: { candidate: ids.candidate, purpose: 'Share with clients', status: 'Given' } })
    await moveTo(ananya, 'Arjun for Senior Backend Engineer', 'Submitted')
    await ananya.getByRole('dialog', { name: 'Move to Submitted' }).getByRole('button', { name: 'Move to Submitted' }).click()
    await expect(ananya.getByRole('listitem', { name: /^Submitted, 1 card/ })).toBeVisible()
    await moveTo(ananya, 'Arjun for Senior Backend Engineer', 'Client shortlisted')
    await ananya.getByRole('dialog', { name: 'Move to Client shortlisted' }).getByRole('button', { name: 'Move to Client shortlisted' }).click()
    await moveTo(ananya, 'Arjun for Senior Backend Engineer', 'Interview')
    await expect(ananya.getByRole('listitem', { name: /^Interview, 1 card/ })).toBeVisible()
  })

  await test.step('6. An offer needs a passed interview; an admin overrides with a reason that is audited', async () => {
    await moveTo(ananya, 'Arjun for Senior Backend Engineer', 'Offer')
    const blocked = ananya.getByRole('dialog', { name: 'Cannot move to Offer' })
    await expect(blocked).toContainText('R-06')
    await blocked.getByLabel(/Override with a reason/).fill('Client interviewed him on the phone')
    await shot(ananya, '03-override-with-reason')
    await blocked.getByRole('button', { name: 'Move anyway' }).click()
    await expect(ananya.getByRole('listitem', { name: /^Offer, 1 card/ })).toBeVisible()
  })

  await test.step('7. An offer above the budget is held; Ananya requests approval from a manager', async () => {
    await ananya.goto('/records/offer/new')
    await ananya.getByLabel(/^Summary/).fill('Offer for Arjun')
    await ananya.getByLabel(/^Submission/).selectOption({ label: 'Arjun for Senior Backend Engineer' })
    await ananya.getByLabel(/^Annual CTC/).fill('35 LPA')
    await ananya.getByRole('button', { name: 'Save offer' }).click()
    await expect(ananya.getByRole('alert').filter({ hasText: "needs a manager's approval" })).toBeVisible()
    await shot(ananya, '04-needs-approval')
    await ananya.getByRole('button', { name: 'Request approval' }).first().click()
    await ananya.getByLabel(/Note for the approver/).fill('Strong profile; client agreed verbally')
    await ananya.getByRole('dialog').getByRole('button', { name: 'Request approval' }).click()
    await expect(ananya.getByRole('heading', { name: 'Approvals', exact: true })).toBeVisible()
    await expect(ananya.getByRole('heading', { name: 'Offer for Arjun' })).toBeVisible()
    await expect(ananya.getByText('Another manager has to decide this one.')).toBeVisible()
  })

  await test.step('8. Priya, a manager, approves it from her inbox; the offer then exists', async () => {
    await ananya.goto('/team')
    await ananya.getByLabel(/Email/).fill(priyaEmail)
    await ananya.getByLabel('Role').selectOption('manager')
    await ananya.getByRole('button', { name: 'Send invitation' }).click()
    const link = (await ananya.getByTestId('dev-accept-link').locator('a').textContent())!
    const u = new URL(link)
    await priya.goto(u.pathname + u.search)
    await priya.getByLabel(/Your name/).fill('Priya Shah')
    await priya.getByLabel(/Choose a password/).fill(PASSWORD)
    await priya.getByRole('button', { name: 'Join workspace' }).click()
    await expect(priya.getByTestId('app-name')).toHaveText(agency)
    priyaSecret = await enrolMfa(priya)
    await priya.getByRole('button', { name: 'Sign out' }).click()
    await signInWithMfa(priya, priyaEmail, priyaSecret)
    await priya.getByRole('link', { name: /^Approvals/ }).click()
    await expect(priya.getByRole('heading', { name: 'Offer for Arjun' })).toBeVisible()
    await shot(priya, '05-approver-inbox')
    await priya.getByRole('button', { name: 'Approve' }).click()
    await expect(priya.getByText('Approved and applied.', { exact: true })).toBeVisible()
    await priya.goto('/records/offer')
    await expect(priya.getByRole('link', { name: 'Offer for Arjun' })).toBeVisible()
  })

  await test.step('9. The offer is accepted and the placement fills the requirement', async () => {
    const offers = await api(ananya, 'GET', '/v1/records/offer')
    const o = offers.items[0]
    await api(ananya, 'PATCH', `/v1/records/offer/${o.id}`, { version: o.version, data: { status: 'Accepted' } })
    const sub = (await api(ananya, 'GET', '/v1/records/submission')).items[0]
    // A fee below the client's minimum needs approval, so ask for a proper one.
    await api(ananya, 'POST', '/v1/records/placement', {
      data: { summary: 'Arjun at Aurora', candidate: ids.candidate, client: ids.client, requirement: ids.requirement, submission: sub.id, annual_ctc: 3500000, fee: 360000, status: 'Joined' },
    })
    await ananya.goto('/s/pipeline')
    await expect(ananya.getByRole('listitem', { name: /^Placed, 1 card/ })).toBeVisible()
    await ananya.goto(`/records/requirement/${ids.requirement}`)
    await expect(ananya.getByText('Filled', { exact: true }).first()).toBeVisible()
    await shot(ananya, '06-placed')
  })

  await test.step('10. Two records of the same person show up for review; Priya merges them and can undo', async () => {
    const a = await api(ananya, 'POST', '/v1/records/candidate', {
      data: { full_name: 'Priya Nair', email: `p1-${run}@gmail.com`, phone: `+91 97${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, current_employer: 'Infosys', current_title: 'Engineer' },
    })
    await api(ananya, 'POST', '/v1/records/candidate', {
      data: { full_name: 'Priya  Nair', email: `p2-${run}@gmail.com`, phone: `+91 96${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, current_employer: 'Infosys', total_experience: 60 },
    })
    expect(a.id).toBeTruthy()
    await priya.goto('/')
    await priya.getByRole('link', { name: 'Duplicate candidates' }).click()
    await expect(priya.getByRole('list', { name: 'Suspected duplicates' }).getByRole('listitem')).toHaveCount(1)
    await shot(priya, '07-duplicates')
    await priya.getByRole('button', { name: 'Compare' }).click()
    const dlg = priya.getByRole('dialog', { name: 'Compare records' })
    await expect(dlg.getByRole('table', { name: 'Differences' })).toBeVisible()
    await shot(priya, '08-compare')
    await dlg.getByRole('button', { name: 'Merge into the kept record' }).click()
    await expect(priya.getByText(/^Merged\. 0 linked records were moved/)).toBeVisible()
    await expect(priya.getByText('No suspected duplicates')).toBeVisible()
    await priya.getByRole('button', { name: 'Undo merge' }).click()
    await expect(priya.getByText('Merge undone. Both records are back.', { exact: true })).toBeVisible()
    await expect(priya.getByRole('list', { name: 'Suspected duplicates' }).getByRole('listitem')).toHaveCount(1)
  })

  await test.step('11. The new screens pass WCAG 2.2 AA and fit a 360 px phone without sideways scrolling', async () => {
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
    for (const path of ['/s/pipeline', '/approvals']) {
      await ananya.goto(path)
      await ananya.waitForLoadState('networkidle')
      const r = await new AxeBuilder({ page: ananya }).withTags(tags).analyze()
      expect(r.violations, `${path}: ${r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')}`).toEqual([])
    }
    await priya.goto('/s/duplicate_candidates')
    await priya.waitForLoadState('networkidle')
    const d = await new AxeBuilder({ page: priya }).withTags(tags).analyze()
    expect(d.violations, d.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
    await ananya.setViewportSize({ width: 360, height: 740 })
    for (const path of ['/s/pipeline', '/approvals']) {
      await ananya.goto(path)
      await ananya.waitForLoadState('networkidle')
      const overflow = await ananya.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${path} scrolls sideways at 360px`).toBeLessThanOrEqual(0)
    }
    await shot(ananya, '09-pipeline-phone')
    await ananya.setViewportSize({ width: 1280, height: 900 })
  })

  await test.step('12. The Studio shows the pack version with its new rules', async () => {
    await ananya.goto('/studio')
    await ananya.getByRole('tab', { name: 'Versions' }).click()
    await expect(ananya.getByTestId('release-v1')).toBeVisible()
  })

  await test.step('13. The owner renames a stage and relaxes a policy in the Studio, saved to Draft', async () => {
    await ananya.goto('/studio?tab=flow')
    const stage = ananya.getByLabel('Label for stage Interview')
    await stage.fill('Client interview')
    await ananya.getByRole('button', { name: 'Save names' }).first().click()
    await expect(ananya.getByText('Stages saved in Draft')).toBeVisible()
    const policy = ananya.getByLabel(/How strict: The candidate's notice period/)
    await policy.selectOption('block')
    await expect(ananya.getByText('Policy saved in Draft')).toBeVisible()
    await shot(ananya, '10-studio-stages-and-rules')
  })
})
