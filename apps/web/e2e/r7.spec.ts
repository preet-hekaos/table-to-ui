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
