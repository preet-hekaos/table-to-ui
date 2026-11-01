import { expect, test } from '@playwright/test'
import { run, signUpWithPack } from './helpers'
import { freshSession, publishLive } from './live-effect'

/** S1 of the Studio table redesign: the inline-editable Fields grid (mockup board 1). */

test('S1.2 inline label: Enter saves, Esc cancels, leaving the cell saves, bad labels are refused', async ({ page }) => {
  await signUpWithPack(page, `S1 Co ${run}`, `s1a-${run}@studio.test`)
  await page.goto('/studio')
  const row = (key: string) => page.getByRole('row', { name: new RegExp(`^${key} `) })
  const rename = (key: string, label: string) => row(key).getByRole('button', { name: label, exact: true })

  await test.step('Enter saves the new label to the Draft', async () => {
    await rename('full_name', 'Full name').click()
    const input = page.getByLabel('Label of full_name')
    await input.fill('Candidate name')
    await input.press('Enter')
    await expect(row('full_name')).toContainText('Candidate name')
    await expect(page.getByTestId('draft-banner')).toContainText('unpublished change')
  })

  await test.step('Esc cancels and keeps the old label', async () => {
    await rename('email', 'Email').click()
    const input = page.getByLabel('Label of email')
    await input.fill('Mail address')
    await input.press('Escape')
    await expect(row('email')).toContainText('Email')
    await expect(row('email')).not.toContainText('Mail address')
  })

  await test.step('Leaving the cell saves', async () => {
    await rename('email', 'Email').click()
    await page.getByLabel('Label of email').fill('E-mail')
    await page.locator('body').click({ position: { x: 3, y: 3 } })
    await expect(row('email')).toContainText('E-mail')
  })

  await test.step('An empty label is refused and nothing is saved', async () => {
    await rename('email', 'E-mail').click()
    const input = page.getByLabel('Label of email')
    await input.fill('   ')
    await input.press('Enter')
    await expect(page.getByRole('alert').filter({ hasText: 'A label is required.' })).toBeVisible()
    await input.press('Escape')
    await expect(row('email')).toContainText('E-mail')
  })

  await test.step('A label another field already uses is refused', async () => {
    await rename('email', 'E-mail').click()
    const input = page.getByLabel('Label of email')
    await input.fill('candidate name')
    await input.press('Enter')
    await expect(page.getByRole('alert').filter({ hasText: 'already called' })).toBeVisible()
    await input.press('Escape')
    await expect(row('email')).toContainText('E-mail')
  })
})

test('S1 live effect: a label renamed in Studio shows on the live form and list', async ({ page, browser }) => {
  await signUpWithPack(page, `S1 Live ${run}`, `s1b-${run}@studio.test`)
  await page.goto('/studio')
  await page.getByRole('row', { name: /^full_name / }).getByRole('button', { name: 'Full name', exact: true }).click()
  await page.getByLabel('Label of full_name').fill('Candidate name')
  await page.getByLabel('Label of full_name').press('Enter')
  await expect(page.getByRole('row', { name: /^full_name / })).toContainText('Candidate name')
  await publishLive(page)

  const live = await freshSession(browser, page)
  await live.goto('/records/candidate/new')
  await expect(live.getByLabel(/^Candidate name/)).toBeVisible()
  await live.getByLabel(/^Candidate name/).fill('Live Rename Check')
  await live.getByLabel(/^Email/).fill(`live-${run}@rename.test`)
  await live.getByLabel(/^Phone/).fill('+91 98450 77777')
  await live.getByRole('button', { name: 'Save candidate' }).click()
  await expect(live.getByRole('heading', { name: 'Live Rename Check' }).first()).toBeVisible()
  await live.goto('/records/candidate')
  await expect(live.getByRole('columnheader', { name: /Candidate name/ })).toBeVisible()
  await live.context().close()
})

test('S1.3 required switch: one click saves to the Draft, and the live form then requires the value', async ({ page, browser }) => {
  await signUpWithPack(page, `S1 Req ${run}`, `s1c-${run}@studio.test`)
  await page.goto('/studio')
  const sw = page.getByRole('switch', { name: 'Current employer is required' })

  await test.step('The switch starts off, turns on with one click and survives a reload', async () => {
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('draft-banner')).toContainText('unpublished change')
    await page.reload()
    await expect(page.getByRole('switch', { name: 'Current employer is required' })).toHaveAttribute('aria-checked', 'true')
  })

  await test.step('It works from the keyboard and turns off again', async () => {
    const again = page.getByRole('switch', { name: 'Current employer is required' })
    await again.focus()
    await page.keyboard.press('Space')
    await expect(again).toHaveAttribute('aria-checked', 'false')
    await again.press('Space')
    await expect(again).toHaveAttribute('aria-checked', 'true')
  })

  await test.step('After publishing, a separate session cannot save the form without it', async () => {
    await publishLive(page)
    const live = await freshSession(browser, page)
    await live.goto('/records/candidate/new')
    await live.getByLabel(/Full name/).fill('Needs Employer')
    await live.getByLabel(/^Email/).fill(`req-${run}@x.test`)
    await live.getByLabel(/^Phone/).fill('+91 98450 66666')
    await live.getByRole('button', { name: 'Save candidate' }).click()
    await expect(live.getByText('Current employer is required')).toBeVisible()
    await live.context().close()
  })
})
