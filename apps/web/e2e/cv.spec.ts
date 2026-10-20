import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { run, signUpWithPack } from './helpers'

const CV = new URL('./fixtures/cv.pdf', import.meta.url)
const truth = JSON.parse(readFileSync(new URL('./fixtures/cv.json', import.meta.url), 'utf8')) as Record<string, string>

/** M1-S11: upload a CV, see it beside the fields read from it, confirm into a candidate. */
test('CV upload, virus scan, review and confirm', async ({ page }) => {
  await signUpWithPack(page, `CV Co ${run}`, `cv-${run}@cv.test`)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Add from CV' }).click()

  await test.step('An infected file is refused before anything reads it', async () => {
    const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
    await page.getByLabel('Document to read').setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n${eicar}`) })
    await expect(page.getByRole('alert')).toContainText('did not pass the virus scan')
  })

  await test.step('A clean CV is read; the details sit beside the document', async () => {
    await page.getByLabel('Document to read').setInputFiles(CV.pathname)
    await expect(page.getByTestId('parse-summary')).toContainText('Read')
    await expect(page.getByText('Virus scan passed')).toBeVisible()
    await expect(page.getByLabel(/^Full name/)).toHaveValue(truth.name!)
    await expect(page.getByLabel(/^Email/)).toHaveValue(truth.email!)
    await expect(page.getByLabel(/^Current employer/)).toHaveValue(truth.employer!)
  })

  await test.step('Confirming creates the candidate with the CV filed under it', async () => {
    await page.getByRole('button', { name: 'Save candidate' }).click()
    await expect(page.getByRole('heading', { name: truth.name! })).toBeVisible()
    await page.getByRole('tab', { name: 'Candidate documents' }).click()
    await expect(page.getByText('cv.pdf')).toBeVisible()
  })

  await test.step('The same CV again is caught by R-01 and can be attached instead', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Add from CV' }).click()
    await page.getByLabel('Document to read').setInputFiles(CV.pathname)
    await expect(page.getByLabel(/^Email/)).toHaveValue(truth.email!)
    await page.getByRole('button', { name: 'Save candidate' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'R-01' })).toBeVisible()
    await page.getByRole('button', { name: /Attach this document to/ }).click()
    await expect(page.getByRole('heading', { name: truth.name! })).toBeVisible()
  })
})
