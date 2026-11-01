import { openSection } from './helpers'
import { expect, test, type Browser, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { totp } from './totp'

/**
 * The M0 demo script (PRD section 1), step for step. Runs against a fresh environment:
 * the API on :8000 (ENVIRONMENT=local, MAIL_BACKEND=log), the web app on :5173.
 * Step 11 needs an operator account: OPS_EMAIL, OPS_PASSWORD, OPS_TOTP_SECRET.
 */
const run = Date.now().toString(36)
const PASSWORD = 'correct-horse-battery'
const northstar = { agency: `Northstar Talent Partners ${run}`, name: 'Ananya Rao', email: `ananya-${run}@northstar.test` }
const crestline = { agency: `Crestline HR ${run}`, name: 'Rohan Shah', email: `rohan-${run}@crestline.test` }
const priya = { name: 'Priya Nair', email: `priya-${run}@northstar.test` }
const arjun = { full_name: 'Arjun Menon', email: `arjun.menon.${run}@gmail.com`, phone: '98450 12345' }

async function signUp(page: Page, who: { agency: string; name: string; email: string }) {
  await page.goto('/signup')
  await page.getByLabel(/Workspace name/).fill(who.agency)
  await page.getByLabel(/Your name/).fill(who.name)
  await page.getByLabel(/Work email/).fill(who.email)
  await page.getByLabel(/^Password/).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByRole('heading', { name: /^Set up / })).toBeVisible()
  await page.getByLabel(/Recruitment agency/).check()
  await page.getByRole('button', { name: 'Set up workspace' }).click()
  await expect(page.getByTestId('app-name')).toHaveText(who.agency)
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

async function newUserPage(browser: Browser) {
  const ctx = await browser.newContext()
  return { ctx, page: await ctx.newPage() }
}

test('M0 demo script', async ({ browser }) => {
  const a = await newUserPage(browser) // Ananya
  const c = await newUserPage(browser) // Crestline owner
  const p = await newUserPage(browser) // Priya
  let priyaSecret = ''
  let arjunUrl = ''

  await test.step('1. Ananya signs up as Northstar and lands in the workspace', async () => {
    await signUp(a.page, northstar)
    await expect(a.page.getByRole('heading', { name: /Good (morning|afternoon|evening), Ananya/ })).toBeVisible()
  })

  await test.step('2. A second agency, Crestline HR, signs up the same way', async () => {
    await signUp(c.page, crestline)
  })

  await test.step('3. Ananya invites Priya; Priya accepts and signs in with MFA', async () => {
    await a.page.goto('/team')
    await a.page.getByLabel(/Email/).fill(priya.email)
    await a.page.getByRole('button', { name: 'Send invitation' }).click()
    const link = (await a.page.getByTestId('dev-accept-link').locator('a').textContent())!
    const u = new URL(link)
    await p.page.goto(u.pathname + u.search) // stay on the same origin as the rest of the run (localhost vs 127.0.0.1)
    await p.page.getByLabel(/Your name/).fill(priya.name)
    await p.page.getByLabel(/Choose a password/).fill(PASSWORD)
    await p.page.getByRole('button', { name: 'Join workspace' }).click()
    await expect(p.page.getByTestId('app-name')).toHaveText(northstar.agency)
    priyaSecret = await enrolMfa(p.page)
    await p.page.getByRole('button', { name: 'Sign out' }).click()
    await signInWithMfa(p.page, priya.email, priyaSecret)
  })

  await test.step('4. Ananya opens the Studio and sees the Candidate table and its fields', async () => {
    await a.page.goto('/studio')
    await expect(a.page.getByRole('heading', { name: 'Candidate', exact: true })).toBeVisible()
    const row = a.page.getByRole('row', { name: /^(?:Move [^.]*\. Drag, or use the up and down arrow keys\. )?email Email Email address/ })
    await expect(row).toContainText('Email address')
    await expect(row.getByRole('switch', { name: 'Email is required' })).toHaveAttribute('aria-checked', 'true')
    await expect(a.page.getByRole('group', { name: 'Environments' })).toContainText('Live v1')
  })

  await test.step('5. Choosing the pack already published v1 Live; the version list shows its manifest', async () => {
    await openSection(a.page, 'Versions')
    const v1 = a.page.getByTestId('release-v1')
    await expect(v1).toContainText('Live')
    await v1.getByText('Manifest', { exact: true }).click()
    await expect(v1).toContainText('recruitment')
    await expect(v1).toContainText('candidate v1')
    await expect(v1).toContainText('R-01')
  })

  await test.step('6. Priya adds Arjun Menon and sees him in the list and on his detail page', async () => {
    await p.page.goto('/')
    await p.page.getByRole('link', { name: 'Candidates', exact: true }).click()
    await expect(p.page.getByText('No candidates yet')).toBeVisible()
    await p.page.getByRole('button', { name: 'Add candidate' }).first().click()
    await p.page.getByLabel(/Full name/).fill(arjun.full_name)
    await p.page.getByLabel(/^Email/).fill(arjun.email)
    await p.page.getByLabel(/^Phone/).fill(arjun.phone)
    await p.page.getByLabel(/Current employer/).fill('Infosys')
    await p.page.getByRole('button', { name: 'Save candidate' }).click()
    await expect(p.page.getByRole('heading', { name: arjun.full_name })).toBeVisible()
    arjunUrl = new URL(p.page.url()).pathname
    await p.page.getByRole('link', { name: 'Candidates' }).first().click()
    await expect(p.page.getByRole('link', { name: arjun.full_name })).toBeVisible()
  })

  await test.step('7. A second candidate with Arjun\'s email in a different case is blocked by R-01', async () => {
    await p.page.goto('/records/candidate/new')
    await p.page.getByLabel(/Full name/).fill('Someone Else')
    const t0 = Date.now()
    await p.page.getByLabel(/^Email/).fill(arjun.email.toUpperCase())
    await p.page.getByLabel(/^Phone/).focus() // leaving the email field triggers the instant check
    const instant = p.page.getByTestId('instant-check').first()
    await expect(instant).toContainText('already exists')
    expect(Date.now() - t0).toBeLessThan(2000)
    await p.page.getByRole('button', { name: 'Save candidate' }).click()
    const blocked = p.page.getByRole('alert').filter({ hasText: 'Blocked by rule R-01' })
    await expect(blocked).toBeVisible()
    await expect(blocked.getByRole('link', { name: /Arjun Menon/ })).toHaveAttribute('href', arjunUrl)
    await expect(p.page.getByLabel(/Full name/)).toHaveValue('Someone Else') // entered values are kept
  })

  await test.step('8. The detail page shows history; the activity log shows who created him', async () => {
    await p.page.goto(arjunUrl)
    await p.page.getByRole('tab', { name: 'Timeline' }).click()
    await expect(p.page.getByRole('row', { name: /Created/ })).toContainText(priya.name)
    await a.page.goto('/activity')
    await expect(a.page.getByRole('row', { name: /candidate\.create/ })).toContainText(priya.name)
  })

  await test.step('9. The home card shows Active candidates = 1', async () => {
    await a.page.goto('/')
    await expect(a.page.getByTestId('measure-active_candidates')).toContainText('Active candidates')
    await expect(a.page.getByTestId('measure-active_candidates').getByLabel(/Active candidates: 1/)).toBeVisible({ timeout: 30_000 })
  })

  await test.step('10. Logged in as Crestline, nothing from Northstar is visible', async () => {
    // Crestline set up its own workspace; look for Arjun.
    await c.page.goto('/records/candidate')
    await expect(c.page.getByText('No candidates yet')).toBeVisible()
    await c.page.goto(arjunUrl)
    await expect(c.page.getByText('We could not find that record')).toBeVisible()
    await expect(c.page.locator('body')).not.toContainText('Arjun')
    await c.page.goto('/')
    await expect(c.page.getByTestId('measure-active_candidates').getByLabel(/Active candidates: 0/)).toBeVisible()
  })

  await test.step('11. A platform operator sees both agencies in the tenant directory', async () => {
    test.skip(!process.env.OPS_EMAIL, 'OPS_EMAIL / OPS_PASSWORD / OPS_TOTP_SECRET not set')
    const o = await newUserPage(browser)
    await o.page.goto('/ops/sign-in')
    await o.page.getByLabel(/Staff email/).fill(process.env.OPS_EMAIL!)
    await o.page.getByLabel(/^Password/).fill(process.env.OPS_PASSWORD!)
    await o.page.getByRole('button', { name: 'Continue' }).click()
    await o.page.getByLabel(/Authenticator code/).fill(totp(process.env.OPS_TOTP_SECRET!))
    await o.page.getByRole('button', { name: 'Sign in' }).click()
    await o.page.getByRole('navigation', { name: 'Operations' }).getByRole('link', { name: 'Tenants' }).click()
    const table = o.page.getByRole('table', { name: 'Tenants' })
    await expect(table).toContainText(northstar.agency)
    await expect(table).toContainText(crestline.agency)
    await expect(o.page.locator('body')).not.toContainText('Arjun')
    // S27: the pack catalog lists each pack with its fixtures.
    await o.page.getByRole('navigation', { name: 'Operations' }).getByRole('link', { name: 'Packs' }).click()
    await expect(o.page.getByRole('table', { name: 'Packs' })).toContainText('Recruitment agency')
    await o.ctx.close()
  })

  await a.ctx.close()
  await c.ctx.close()
  await p.ctx.close()
})

test.describe('accessibility of the slice screens (WCAG 2.2 AA)', () => {
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
  test('public screens', async ({ page }) => {
    for (const path of ['/signup', '/sign-in', '/ops/sign-in']) {
      await page.goto(path)
      const r = await new AxeBuilder({ page }).withTags(tags).analyze()
      expect(r.violations, `${path}: ${r.violations.map((v) => v.id).join(', ')}`).toEqual([])
    }
  })

  test('signed-in screens, and no sideways scrolling at 360 px', async ({ browser }) => {
    const { ctx, page } = await newUserPage(browser)
    const who = { agency: `A11y Agency ${run}`, name: 'Asha Iyer', email: `asha-${run}@a11y.test` }
    await signUp(page, who)
    for (const path of ['/', '/records/candidate', '/records/candidate/new', '/studio', '/activity', '/security', '/team', '/import', '/settings', '/s/clients', '/s/cv_intake', '/s/candidates', '/s/requirements']) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const r = await new AxeBuilder({ page }).withTags(tags).analyze()
      expect(r.violations, `${path}: ${r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')}`).toEqual([])
    }
    await page.setViewportSize({ width: 360, height: 740 })
    for (const path of ['/', '/records/candidate', '/records/candidate/new']) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${path} scrolls sideways at 360px`).toBeLessThanOrEqual(0)
    }
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
    await ctx.close()
  })
})
