import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { expectReadable, run, signUpWithPack } from './helpers'

const token = (page: Page) => page.evaluate(() => sessionStorage.getItem('tableui.token'))

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
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png`, fullPage: true })
}

test('Features tab: whole-table switches, defaults, and field options headed by on/off chips', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUpWithPack(page, `Layout Co ${run}`, `layout-${run}@layout.test`)
  await page.evaluate(async () => {
    await fetch('/v1/records/candidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
      body: JSON.stringify({ data: { full_name: 'Asha Rao', status: 'Active', email: 'a@example.in', phone: '+91 98450 32340' } }),
    })
  })
  await page.goto('/studio?tab=data&table=candidate&part=features')
  const panel = page.getByTestId('features-panel')

  await test.step('Three sections, in this order', async () => {
    await expect(panel.getByRole('heading', { name: 'For the whole table' })).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'Defaults' })).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'Field options' })).toBeVisible()
    await expect(panel.getByText('No unsaved changes')).toBeVisible()
    await shot(page, 'r7-features-on')
    await testInfo.attach('features-on', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  })

  await test.step('A heading chip switches an option off for the whole table and greys its chips', async () => {
    const group = panel.getByRole('switch', { name: 'Group rows' })
    await expect(group).toBeChecked()
    await group.uncheck()
    await expect(panel.getByText('1 unsaved change')).toBeVisible()
    const chip = panel.getByRole('checkbox', { name: 'Group by Email' })
    await expect(chip).toBeDisabled()
    await chip.hover({ force: true })
    await expect(page.getByRole('tooltip').filter({ hasText: 'Turn on Group rows first.' }).first()).toBeVisible()
    await expectReadable(page, chip) // greyed chips stay legible
    await panel.getByRole('switch', { name: 'Filtering' }).uncheck()
    await panel.getByRole('button', { name: 'Save features' }).click()
    await expect(page.getByText('Saved features for Candidate').first()).toBeVisible()
    await shot(page, 'r7-features-off')
    await goLive(page)
  })

  await test.step('The list follows: no filter icons, sorting still there', async () => {
    await page.goto('/s/candidates')
    await expect(page.getByRole('columnheader', { name: /Full name/ })).toBeVisible()
    await expect(page.getByRole('columnheader').getByRole('button', { name: /Filter/ })).toHaveCount(0)
    await expect(page.getByRole('columnheader', { name: /Full name/ }).getByRole('button')).toBeVisible()
  })

  await test.step('Accessibility', async () => {
    await page.goto('/studio?tab=data&table=candidate&part=features')
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} ${n.any[0]?.message ?? ''}`).join(' | ')}`)).toEqual([])
  })
})

test('The unsaved-changes count is honest: turning something off and on again is no change', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUpWithPack(page, `Count Co ${run}`, `count-${run}@count.test`)
  await page.goto('/studio?tab=data&table=candidate&part=features')
  const panel = page.getByTestId('features-panel')
  const clean = panel.getByText('No unsaved changes')
  await expect(clean).toBeVisible()

  const flips: [string, () => ReturnType<typeof panel.getByRole>, string][] = [
    ['a switch', () => panel.getByRole('switch', { name: 'Group rows' }), 'Group rows'],
    ['a Shown chip', () => panel.getByRole('checkbox', { name: 'Show Email by default' }), 'Show Email'],
    ['a Sort chip', () => panel.getByRole('checkbox', { name: 'Sort by Email' }), 'Sort Email'],
    ['a Filter chip', () => panel.getByRole('checkbox', { name: 'Filter by Phone' }), 'Filter Phone'],
    ['a Summary chip', () => panel.getByRole('checkbox', { name: 'Summarise Total experience' }), 'Summary'],
    ['a bulk action chip', () => panel.getByRole('checkbox', { name: 'Delete (with Undo)' }), 'Bulk action'],
    ['an export format chip', () => panel.getByRole('checkbox', { name: 'CSV' }), 'Format'],
    ['a Whole table chip', () => panel.getByRole('checkbox', { name: 'Whole table' }), 'Whole table'],
  ]
  for (const [what, el] of flips) {
    await test.step(`Flipping ${what} counts as one change, and flipping it back as none`, async () => {
      await el().click()
      await expect(panel.getByText('1 unsaved change', { exact: true }), what).toBeVisible()
      await el().click()
      await expect(clean, `${what} back`).toBeVisible()
    })
  }

  await test.step('A select that returns to its value is no change either', async () => {
    await panel.getByLabel('Row density').selectOption('comfortable')
    await expect(panel.getByText('1 unsaved change', { exact: true })).toBeVisible()
    await panel.getByLabel('Row density').selectOption('compact')
    await expect(clean).toBeVisible()
  })

  await test.step('Several chips of one column, undone in a different order, leave nothing behind', async () => {
    const email = panel.getByRole('checkbox', { name: 'Sort by Email' })
    const phone = panel.getByRole('checkbox', { name: 'Sort by Phone' })
    await email.click()
    await phone.click()
    await expect(panel.getByText('1 unsaved change', { exact: true })).toBeVisible() // one setting, two fields
    await email.click()
    await phone.click()
    await expect(clean).toBeVisible()
  })

  await test.step('Saving brings the count back to none', async () => {
    await panel.getByRole('switch', { name: 'Group rows' }).click()
    await panel.getByRole('button', { name: 'Save features' }).click()
    await expect(page.getByText('Saved features for Candidate').first()).toBeVisible()
    await expect(clean).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Save features' })).toBeDisabled()
  })
})
