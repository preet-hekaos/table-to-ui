import { expect, test } from '@playwright/test'
import { featuresSaved, run, signUpWithPack } from './helpers'
import { freshSession, publishLive } from './live-effect'

const SHOTS = '../../docs/screens/studio-table/s8'

test('The Table-wide bar replaces the Features tab: Import and Reorder switches, option menus, custom cards, live after publish', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1500, height: 900 })
  await signUpWithPack(page, `Wide Bar ${run}`, `wb-${run}@studio.test`)
  await page.goto('/studio?tab=data&table=candidate')
  const bar = page.getByRole('group', { name: 'Table-wide switches for Candidate' })

  await test.step('There is no Features tab; the bar has nine switches and Apply to all tables', async () => {
    await expect(page.getByRole('tab', { name: 'Features' })).toHaveCount(0)
    await expect(bar.getByRole('switch')).toHaveCount(9)
    for (const n of ['Import data', 'Reorder rows', 'Export data', 'Select rows', 'Summary']) await expect(bar.getByRole('switch', { name: new RegExp(`^${n}`) })).toBeChecked()
    await expect(page.getByRole('button', { name: 'Apply to all tables' })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/table-wide-bar.png`, clip: { x: 250, y: 190, width: 1250, height: 150 } })
  })

  await test.step('Each ▾ menu opens its own choices and saves at once', async () => {
    await bar.getByRole('button', { name: 'Export options' }).click()
    await featuresSaved(page, () => page.getByRole('checkbox', { name: 'Excel' }).uncheck())
    await page.screenshot({ path: `${SHOTS}/table-wide-export-menu.png`, clip: { x: 250, y: 190, width: 1250, height: 150 } })
    await page.keyboard.press('Escape')
    await bar.getByRole('button', { name: 'Summary options' }).click()
    const pop = page.getByRole('dialog', { name: 'Summary options' })
    await featuresSaved(page, () => pop.getByRole('checkbox', { name: 'Choose the summary cards myself' }).check())
    await featuresSaved(page, () => pop.getByLabel('Card 1 shows').selectOption('count'))
    await featuresSaved(page, async () => { await pop.getByLabel('Card 1 name').fill('Everyone'); await pop.getByLabel('Card 1 name').press('Enter') })
    await page.screenshot({ path: `${SHOTS}/table-wide-numbers-menu.png`, clip: { x: 250, y: 190, width: 1250, height: 520 } })
    await page.keyboard.press('Escape')
  })

  await test.step('Import and Reorder are switched off in the bar and are off for the real app once published', async () => {
    await featuresSaved(page, () => bar.getByRole('switch', { name: /^Import data/ }).click())
    await featuresSaved(page, () => bar.getByRole('switch', { name: /^Reorder rows/ }).click())
    await publishLive(page)
    const rec = await freshSession(browser, page)
    const made = await rec.evaluate(async () => (await fetch('/v1/records/candidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
      body: JSON.stringify({ data: { full_name: 'Bar Person', email: 'bar@example.in', phone: '+91 98450 12345', status: 'Active' } }),
    })).status)
    expect(made).toBe(201)
    await rec.goto('/s/candidates')
    await expect(rec.getByTestId('stats-strip')).toContainText('Everyone')
    await expect(rec.getByRole('button', { name: 'Import data' })).toHaveCount(0)
  })
})
