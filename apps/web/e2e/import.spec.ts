import { expect, test } from '@playwright/test'
import { run, signUpWithPack } from './helpers'

const csv = [
  'Name,E-mail,Mobile,Company,Experience,Expected Salary,Joined',
  `Asha Rao,asha.${run}@gmail.com,098450 61111,Infosys,5 yrs 3 mo,12.5 LPA,19/10/2026`,
  `Bad Row,not-an-email,9845061112,Wipro,3 yrs,10 LPA,`,
  `Asha Twin,twin.${run}@gmail.com,+91 98450 61111,Infosys,5 yrs,12 LPA,`,
  `Ravi Kumar,ravi.${run}@gmail.com,9845061114,Zoho,4 yrs,9 LPA,`,
].join('\n')

/** M1-S08 to S10: upload, match, check, resolve, load with progress, reconcile, undo. */
test('Import a spreadsheet of candidates and undo it', async ({ page }) => {
  await signUpWithPack(page, `Import Co ${run}`, `import-${run}@import.test`)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Import' }).click()

  await test.step('S08. Upload: each column is profiled and matched with a confidence mark', async () => {
    await page.getByLabel('Import into').selectOption({ label: 'Candidates' })
    await page.getByLabel('Spreadsheet').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await expect(page.getByRole('table', { name: 'Columns' })).toBeVisible()
    await expect(page.getByLabel('Field for E-mail', { exact: true })).toHaveValue('email')
    await expect(page.getByLabel('Field for Mobile', { exact: true })).toHaveValue('phone')
    await expect(page.getByRole('row', { name: /^E-mail/ })).toContainText('high')
    await expect(page.getByLabel('Field for Joined', { exact: true })).toHaveValue('')
    await page.getByRole('button', { name: 'Check the data' }).click()
  })

  await test.step('S09. Problems are counted by reason; duplicates are listed with choices', async () => {
    const rep = page.getByTestId('validation-report')
    await expect(rep).toContainText('Ready3')
    await expect(rep).toContainText('With problems1')
    await expect(page.getByRole('table', { name: 'Possible duplicates' })).toContainText('R-01.phone')
    await page.getByLabel('What to do with row 4').selectOption('create')
    await page.getByLabel('Reason for row 4').fill('Twins share one phone')
    await page.getByRole('button', { name: /^Load/ }).click()
  })

  await test.step('S10. It loads in the background and the counts add up', async () => {
    const rec = page.getByTestId('reconciliation')
    await expect(rec).toContainText('Import finished', { timeout: 30_000 })
    await expect(rec).toContainText('Rows add up')
    await expect(rec).toContainText('Added3')
    await page.goto('/records/candidate')
    await expect(page.getByRole('link', { name: 'Asha Rao' })).toBeVisible()
  })

  await test.step('S10. Undo removes exactly what it added', async () => {
    await page.goto('/import')
    await page.getByRole('table', { name: 'Import history' }).getByRole('button', { name: 'Open' }).first().click()
    await page.getByRole('button', { name: 'Undo this import' }).click()
    await expect(page.getByTestId('reconciliation')).toContainText('Import undone')
    await page.goto('/records/candidate')
    await expect(page.getByText('No candidates yet')).toBeVisible()
  })
})
