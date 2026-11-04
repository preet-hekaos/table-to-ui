import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { expectReadable, featuresSaved, run, signUpWithPack } from './helpers'

const token = (page: Page) => page.evaluate(() => sessionStorage.getItem('tableui.token'))

/** Publish the Draft and make it Live, the way the Versions screen does. */
async function goLive(page: Page) {
  const t = await token(page)
  const rel = await page.evaluate(async (tk) => {
    const r = await fetch('/v1/apps/current/releases', { method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' } })
    return (await r.json()) as { version: number }
  }, t)
  const ok = await page.evaluate(async ([tk, v]) => (await fetch(`/v1/apps/current/releases/${v}/promote`, { method: 'POST', headers: { Authorization: `Bearer ${tk}` } })).status, [t, rel.version] as [string | null, number])
  expect(ok).toBeLessThan(300)
}

/** Set SHOTS_DIR to also save the screenshots as files. */
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png` })
}

test('Summary strip: cards chosen in Studio, and a whole-table switch', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUpWithPack(page, `Cards Co ${run}`, `cards-${run}@cards.test`)
  const made = await page.evaluate(async () => {
    const rows = [['Asha Rao', 'Active', 24], ['Bala Nair', 'Active', 60], ['Chitra Iyer', 'Archived', 12], ['Dev Patel', 'Active', 36]] as const
    const out: number[] = []
    for (const [i, [full_name, status, total_experience]] of rows.entries()) {
      const res = await fetch('/v1/records/candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
        body: JSON.stringify({ data: { full_name, status, total_experience, email: `k${i}@example.in`, phone: `+91 98450 3234${i}` } }),
      })
      out.push(res.status)
    }
    return out
  })
  expect(made).toEqual([201, 201, 201, 201])
  const cards = page.getByTestId('stat-card')

  await test.step('Choose three cards in Studio', async () => {
    await page.goto('/studio?tab=data&table=candidate&part=features')
    await page.getByRole('button', { name: 'Summary options' }).click()
    const panel = page.getByRole('dialog', { name: 'Summary options' })
    await featuresSaved(page, () => panel.getByRole('checkbox', { name: 'Choose the summary cards myself' }).check())
    await expect(panel.getByRole('group', { name: 'Card 1' })).toBeVisible()
    await featuresSaved(page, () => panel.getByRole('button', { name: 'Add a card' }).click())
    await featuresSaved(page, () => panel.getByLabel('Card 2 shows').selectOption('number'))
    await featuresSaved(page, () => panel.getByLabel('Card 2 measure').selectOption('max'))
    await featuresSaved(page, () => panel.getByLabel('Card 2 field').selectOption({ label: 'Total experience' }))
    await featuresSaved(page, () => panel.getByRole('button', { name: 'Add a card' }).click())
    await featuresSaved(page, () => panel.getByLabel('Card 3 shows').selectOption('value'))
    await featuresSaved(page, () => panel.getByLabel('Card 3 field').selectOption({ label: 'Status' }))
    await featuresSaved(page, () => panel.getByLabel('Card 3 value').selectOption('Active'))
    await featuresSaved(page, async () => { await panel.getByLabel('Card 3 name').fill('Active now'); await panel.getByLabel('Card 3 name').press('Enter') })
    await shot(page, 'r4-studio-cards')
    await testInfo.attach('studio-cards', { body: await page.screenshot(), contentType: 'image/png' })
    await goLive(page)
  })

  await test.step('The strip shows the chosen cards and follows the search', async () => {
    await page.goto('/s/candidates')
    await expect(cards).toHaveCount(3)
    await expect(cards.nth(0)).toContainText('Matching')
    await expect(cards.nth(0)).toContainText('4')
    await expect(cards.nth(1)).toContainText('Highest Total experience')
    await expect(cards.nth(1)).toContainText('5 yrs')
    await expect(cards.nth(2)).toContainText('Active now')
    await expect(cards.nth(2)).toContainText('3')
    await expectReadable(page, cards.nth(0).locator('p').first())
    await expectReadable(page, cards.nth(0).locator('p').nth(1))
    await shot(page, 'r4-strip')
    await testInfo.attach('strip', { body: await page.screenshot(), contentType: 'image/png' })
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
    await page.locator('#list-q').fill('Chitra')
    await expect(cards.nth(0)).toContainText('1')
    await expect(cards.nth(2)).toContainText('0')
  })

  await test.step('Whole table: the person switches the numbers off the search', async () => {
    await page.goto('/s/candidates')
    await page.getByRole('checkbox', { name: 'Whole table' }).check()
    await page.locator('#list-q').fill('Chitra')
    await expect(page.getByRole('row')).toHaveCount(2)
    await expect(cards.nth(0)).toContainText('Total')
    await expect(cards.nth(0)).toContainText('4')
    await expect(cards.nth(2)).toContainText('3')
    await expect(page.getByTestId('stats-strip')).toContainText('Whole table')
    await shot(page, 'r4-whole-table')
    await page.reload() // remembered for this person
    await expect(page.getByRole('checkbox', { name: 'Whole table' })).toBeChecked()
  })

  await test.step('Back to the matching rows, and to automatic cards', async () => {
    await page.goto('/s/candidates')
    await page.getByRole('checkbox', { name: 'Whole table' }).uncheck()
    await page.goto('/studio?tab=data&table=candidate&part=features')
    await page.getByRole('button', { name: 'Summary options' }).click()
    await featuresSaved(page, () => page.getByRole('dialog', { name: 'Summary options' }).getByRole('checkbox', { name: 'Choose the summary cards myself' }).uncheck())
    await page.keyboard.press('Escape')
    await goLive(page)
    await page.goto('/s/candidates')
    await expect(page.getByTestId('stats-strip')).toContainText('Matching')
    await expect(page.getByTestId('stat-card')).toHaveCount(0)
  })
})
