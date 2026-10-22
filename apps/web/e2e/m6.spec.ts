import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { PASSWORD, run } from './helpers'
import { totp } from './totp'

const shot = async (page: Page, name: string) => {
  if (process.env.SCREENSHOTS) await page.screenshot({ path: `../../docs/screens/m6/${name}.png`, fullPage: true })
}

/** The M6 demo script: the service owner creates a client workspace, suspends it, exports it, deletes it. */
test('M6 demo: operator creates, limits, suspends, exports and deletes a client workspace', async ({ browser }) => {
  test.skip(!process.env.OPS_EMAIL, 'OPS_EMAIL / OPS_PASSWORD / OPS_TOTP_SECRET not set')
  const name = `Client M6 ${run}`
  const email = `owner-${run}@m6.test`
  const op = await (await browser.newContext()).newPage()
  const owner = await (await browser.newContext()).newPage()
  const row = () => op.getByRole('row').filter({ hasText: name })

  await test.step('1. The operator signs in and sees the workspace list', async () => {
    await op.goto('/ops/sign-in')
    await op.getByLabel(/Staff email/).fill(process.env.OPS_EMAIL!)
    await op.getByLabel(/^Password/).fill(process.env.OPS_PASSWORD!)
    await op.getByRole('button', { name: 'Continue' }).click()
    await op.getByLabel(/Authenticator code/).fill(totp(process.env.OPS_TOTP_SECRET!))
    await op.getByRole('button', { name: 'Sign in' }).click()
    await expect(op.getByRole('heading', { name: 'Workspaces' })).toBeVisible()
    await expect(op.getByRole('table', { name: 'Workspaces' })).toBeVisible()
  })

  let link = ''
  await test.step('2. Create a workspace for a client; the owner is invited', async () => {
    await op.getByRole('button', { name: 'New workspace' }).click()
    await op.getByLabel(/Workspace name/).fill(name)
    await op.getByLabel(/Owner email/).fill(email)
    await op.getByRole('button', { name: 'Create workspace' }).click()
    link = (await op.getByTestId('owner-invite-link').textContent())!.replace('Local development only:', '').trim()
    await op.getByRole('button', { name: 'Done' }).click()
    await expect(row()).toContainText('Active')
    await expect(row()).toContainText(email)
    await shot(op, 'workspaces')
    expect((await new AxeBuilder({ page: op }).analyze()).violations).toEqual([])
  })

  await test.step('3. The owner accepts and is in their workspace', async () => {
    const u = new URL(link)
    await owner.goto(u.pathname + u.search)
    await owner.getByLabel(/Your name/).fill('Meera Shah')
    await owner.getByLabel(/Choose a password/).fill(PASSWORD)
    await owner.getByRole('button', { name: 'Join workspace' }).click()
    await expect(owner.getByTestId('app-name')).toHaveText(name)
  })

  await test.step('4. Set a limit on people', async () => {
    await op.getByRole('button', { name: `Limits for ${name}` }).click()
    await op.getByLabel('People').fill('3')
    await shot(op, 'limits')
    await op.getByRole('button', { name: 'Save limits' }).click()
    await expect(row()).toContainText('/ 3')
  })

  await test.step('5. Suspend needs a reason; the owner is locked out at once', async () => {
    await op.getByRole('button', { name: `Suspend ${name}` }).click()
    await op.getByRole('button', { name: 'Suspend workspace' }).click()
    await expect(op.getByRole('alert')).toBeVisible()
    await op.getByLabel('Reason').fill('Unpaid invoice')
    await shot(op, 'suspend')
    await op.getByRole('button', { name: 'Suspend workspace' }).click()
    await expect(row()).toContainText('Suspended')
    await owner.goto('/')
    await expect(owner.getByTestId('app-name')).toHaveCount(0)
  })

  await test.step('6. Resume brings it back', async () => {
    await op.getByRole('button', { name: `Resume ${name}` }).click()
    await expect(row()).toContainText('Active')
    await owner.goto('/')
    await expect(owner.getByTestId('app-name')).toHaveText(name)
  })

  await test.step('7. Export sends a link to the owner', async () => {
    await op.getByRole('button', { name: `Export ${name}` }).click()
    await op.getByLabel('Reason').fill('Client asked for a copy')
    await op.getByRole('button', { name: 'Send export' }).click()
    const exportLink = (await op.getByTestId('export-link').textContent())!.replace('Local development only:', '').trim()
    await op.getByRole('button', { name: 'Done' }).click()
    const u = new URL(exportLink)
    const r = await op.request.get(u.pathname)
    expect(r.status()).toBe(200)
    expect(r.headers()['content-type']).toContain('zip')
  })

  await test.step('8. Delete is two steps, needs the exact name, and can be canceled', async () => {
    await expect(op.getByRole('button', { name: `Delete ${name}` })).toHaveCount(0)
    await op.getByRole('button', { name: `Suspend ${name}` }).click()
    await op.getByLabel('Reason').fill('Contract ended')
    await op.getByRole('button', { name: 'Suspend workspace' }).click()
    await op.getByRole('button', { name: `Delete ${name}` }).click()
    await op.getByLabel(/Type/).fill('wrong name')
    await op.getByLabel('Reason').fill('Contract ended')
    await op.getByRole('button', { name: 'Schedule deletion' }).click()
    await expect(op.getByRole('alert').first()).toBeVisible()
    await op.getByLabel(/Type/).fill(name)
    await shot(op, 'delete')
    await op.getByRole('button', { name: 'Schedule deletion' }).click()
    await expect(row()).toContainText('Scheduled for deletion')
    await op.getByRole('button', { name: `Cancel deletion of ${name}` }).click()
    await expect(row()).toContainText('Suspended')
  })
})

test('M6: an owner removes a person and the person loses access', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel(/Workspace name/).fill(`Remove M6 ${run}`)
  await page.getByLabel(/Your name/).fill('Ananya Rao')
  await page.getByLabel(/Work email/).fill(`rm-${run}@m6.test`)
  await page.getByLabel(/^Password/).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByRole('heading', { name: /^Set up / })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/Start blank/).check()
  await page.getByRole('button', { name: 'Set up workspace' }).click()
  await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible()

  await page.goto('/team')
  await page.getByLabel(/Email/).fill(`temp-${run}@m6.test`)
  await page.getByLabel('Role').selectOption('admin')
  await page.getByRole('button', { name: 'Send invitation' }).click()
  const link = (await page.getByTestId('dev-accept-link').locator('a').textContent())!
  const other = await (await page.context().browser()!.newContext()).newPage()
  const u = new URL(link)
  await other.goto(u.pathname + u.search)
  await other.getByLabel(/Your name/).fill('Temp Person')
  await other.getByLabel(/Choose a password/).fill(PASSWORD)
  await other.getByRole('button', { name: 'Join workspace' }).click()
  await expect(other.getByTestId('app-name')).toBeVisible()

  await page.goto('/settings?tab=people')
  await page.getByRole('button', { name: 'Remove Temp Person' }).click()
  await shot(page, 'remove-person')
  await page.getByRole('button', { name: 'Remove Temp Person' }).last().click()
  await expect(page.getByRole('row', { name: /Temp Person/ })).toHaveCount(0)
  await other.goto('/')
  await expect(other.getByTestId('app-name')).toHaveCount(0)
})
