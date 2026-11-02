import { expect, test } from '@playwright/test'
import { run, signUpWithPack } from './helpers'
import { freshSession, publishLive } from './live-effect'

const SHOTS = '../../docs/screens/studio-table/s4'

test('Describe a new field in words: disabled with AI off, a checked suggestion, added only by Add field, live after publish', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1500, height: 1100 })
  await signUpWithPack(page, `Words Field ${run}`, `wf-${run}@studio.test`)
  await page.goto('/studio')

  await test.step('With AI off the panel is disabled and says why', async () => {
    await page.getByRole('button', { name: 'Add field' }).click()
    const d = page.getByRole('dialog')
    await expect(d.getByText('AI is off for this workspace, so this is disabled')).toBeVisible()
    await expect(d.getByLabel('Describe the field')).toBeDisabled()
    await d.getByRole('button', { name: 'Cancel' }).click()
  })

  await page.evaluate(async () => {
    await fetch('/v1/ai/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` }, body: JSON.stringify({ enabled: true, tables: [] }) })
  })
  await page.goto('/studio')

  await test.step('A description fills the form only after Use these settings', async () => {
    await page.getByRole('button', { name: 'Add field' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Describe the field').fill('PAN number, required')
    await d.getByRole('button', { name: 'Suggest a field' }).click()
    const prop = d.getByTestId('field-proposal')
    await expect(prop).toContainText('PAN (India)')
    await expect(prop).toContainText('required')
    await expect(d.getByLabel(/^Label/)).toHaveValue('')
    await d.screenshot({ path: `${SHOTS}/after-describe-field.png` })
    await prop.getByRole('button', { name: 'Use these settings' }).click()
    await expect(d.getByLabel(/^Label/)).toHaveValue('PAN number')
    await expect(d.getByRole('checkbox', { name: /Required/ })).toBeChecked()
    await d.getByRole('button', { name: /^Add field/ }).last().click()
  })

  await test.step('The field exists in the Draft and is live after publish', async () => {
    await expect(page.getByRole('row', { name: /pan_number / })).toContainText('PAN')
    await publishLive(page)
    const rec = await freshSession(browser, page)
    await rec.goto('/records/candidate/new')
    await expect(rec.getByLabel(/^PAN number/)).toBeVisible()
  })
})
