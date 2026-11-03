import { expect, test } from '@playwright/test'
import { run, signUpWithPack } from './helpers'

const SHOTS = '../../docs/screens/studio-table/s8'

test('Explain this field: opens only on request, read only, facts from the settings, AI question when AI is on', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 })
  await signUpWithPack(page, `Explain ${run}`, `ex-${run}@studio.test`)
  await page.goto('/studio')
  const token = () => page.evaluate(() => sessionStorage.getItem('tableui.token'))

  await test.step('Nothing is open until asked', async () => {
    await expect(page.getByTestId('explain-panel')).toHaveCount(0)
  })

  await test.step('The row button opens the panel with facts; AI off disables the question box and says why', async () => {
    const row = page.getByRole('row', { name: /^.*\bphone\b/ }).first()
    await row.hover()
    await row.getByRole('button', { name: /^Explain / }).click()
    const panel = page.getByTestId('explain-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('explain-summary')).toContainText('is a')
    await expect(panel.getByTestId('explain-in')).toContainText('saved as')
    await expect(panel.getByTestId('explain-data')).toContainText(/record|No records/)
    await expect(panel.getByLabel('Ask a question about this field')).toBeDisabled()
    await expect(panel).toContainText('AI is off for this workspace, so questions are off')
    await panel.screenshot({ path: `${SHOTS}/panel-ai-off.png` })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('explain-panel')).toHaveCount(0)
  })

  await test.step('It changes nothing: the Draft is the same after', async () => {
    const before = await page.evaluate(async (t) => (await (await fetch('/v1/studio/tables/candidate', { headers: { Authorization: `Bearer ${t}` } })).text()), await token())
    const row = page.getByRole('row', { name: /^.*\bphone\b/ }).first()
    await row.getByRole('button', { name: /^More actions for / }).click()
    await page.getByRole('menuitem', { name: 'Explain this field' }).click()
    await expect(page.getByTestId('explain-panel')).toBeVisible()
    await page.keyboard.press('Escape')
    const after = await page.evaluate(async (t) => (await (await fetch('/v1/studio/tables/candidate', { headers: { Authorization: `Bearer ${t}` } })).text()), await token())
    expect(after).toBe(before)
  })

  await page.evaluate(async (t) => {
    await fetch('/v1/ai/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ enabled: true, tables: [] }) })
  }, await token())
  await page.goto('/studio')

  await test.step('With AI on a question gets an answer, still read only', async () => {
    const row = page.getByRole('row', { name: /^.*\bphone\b/ }).first()
    await row.getByRole('button', { name: /^More actions for / }).click()
    await page.getByRole('menuitem', { name: 'Explain this field' }).click()
    const panel = page.getByTestId('explain-panel')
    await panel.getByRole('button', { name: 'What if it is blank?' }).click()
    await expect(panel.getByTestId('explain-answer')).toContainText('Nothing was changed')
    await panel.screenshot({ path: `${SHOTS}/panel-ai-answer.png` })
    await page.keyboard.press('Escape')
  })

  await test.step('The Edit dialog has the same button', async () => {
    const row = page.getByRole('row', { name: /^.*\bphone\b/ }).first()
    await row.getByRole('button', { name: /^Edit / }).click()
    const d = page.getByRole('dialog')
    await d.getByRole('button', { name: 'Explain this field' }).click()
    await expect(page.getByTestId('explain-panel')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('explain-panel')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})
