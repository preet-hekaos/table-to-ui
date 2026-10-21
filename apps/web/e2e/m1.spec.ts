import { expect, test } from '@playwright/test'
import { run, signUpWithPack } from './helpers'

/** The M1 demo script, grown slice by slice. Each step is one line of the PRD's demo. */
test('M1 demo: records, related lists, edit with unsaved-change prompt, roles', async ({ page }) => {
  const name = `Northstar M1 ${run}`
  await test.step('1. Ananya signs up and picks Recruitment', async () => {
    await signUpWithPack(page, name, `m1-${run}@northstar.test`)
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Clients' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Requirements' })).toBeVisible()
  })

  await test.step('8a. A client with its contacts and requirements as tabs of one page', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Clients' }).click()
    await page.getByRole('button', { name: 'Add client' }).first().click()
    await page.getByLabel(/^Name/).fill('Aurora Fintech')
    await page.getByLabel(/^Industry/).fill('Fintech')
    await page.getByRole('button', { name: 'Save client' }).click()
    await expect(page.getByRole('heading', { name: 'Aurora Fintech' })).toBeVisible()
    await page.getByRole('tab', { name: 'Contacts' }).click()
    await page.getByRole('link', { name: 'Add contact' }).click()
    await expect(page.getByLabel(/^Client/)).toHaveValue(/.+/) // pre-filled from the client page
    await page.getByLabel(/^Name/).fill('Meera Iyer')
    await page.getByRole('button', { name: 'Save contact' }).click()
    await expect(page.getByRole('heading', { name: 'Meera Iyer' })).toBeVisible()
    await expect(page.getByText('Aurora Fintech')).toBeVisible() // the link shows a name, not an id
  })

  await test.step('8b. A requirement shows money and experience in readable form', async () => {
    await page.goto('/records/requirement/new')
    await page.getByLabel(/^Title/).fill('Senior Backend Engineer')
    await page.getByLabel(/^Client( \*)?$/).selectOption({ label: 'Aurora Fintech' })
    await page.getByLabel(/^Skills/).fill('Java, Spring')
    await page.getByLabel(/^Budget up to/).fill('30 LPA')
    await page.getByLabel(/^Minimum experience/).fill('5 yrs')
    await page.getByRole('button', { name: 'Save requirement' }).click()
    await expect(page.getByRole('heading', { name: 'Senior Backend Engineer' })).toBeVisible()
    await expect(page.getByText('₹30,00,000')).toBeVisible()
    await expect(page.getByText('5 yrs', { exact: true })).toBeVisible()
    await expect(page.getByText('Spring')).toBeVisible()
  })

  await test.step('Edit asks to keep or discard unsaved changes', async () => {
    await page.getByRole('link', { name: 'Edit' }).click()
    await page.getByLabel(/^Title/).fill('Staff Backend Engineer')
    await page.getByRole('link', { name: 'Requirements', exact: true }).first().click().catch(() => undefined)
    await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible()
    await page.getByRole('button', { name: 'Keep editing' }).click()
    await page.getByRole('button', { name: 'Save requirement' }).click()
    await expect(page.getByRole('heading', { name: 'Staff Backend Engineer' })).toBeVisible()
  })

  await test.step('6. Roles: removing Create from Recruiters applies at once', async () => {
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Roles' }).click()
    await page.getByLabel('Role', { exact: true }).selectOption('recruiter')
    const cell = page.getByLabel('Recruiter can create Candidates')
    await expect(cell).toBeChecked()
    await cell.click()
    await expect(cell).not.toBeChecked()
    await expect(page.getByText('Saved. It applies on the next request.', { exact: true })).toBeVisible()
  })
})
