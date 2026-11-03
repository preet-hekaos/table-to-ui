import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { expectReadable, featuresSaved, run, signUpWithPack } from './helpers'

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

test('Features: whole-table switches in the bar over the Fields grid and a Features cell on each row', async ({ page }) => {
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

  await test.step('The Table-wide bar holds every switch; there is no Features tab and no Save bar', async () => {
    await expect(page.getByRole('tab', { name: 'Features' })).toHaveCount(0)
    await expect(panel.getByRole('switch')).toHaveCount(9)
    await expect(panel.getByRole('button', { name: 'Apply to all tables' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save features' })).toHaveCount(0)
    await shot(page, 'r7-features-on')
  })

  await test.step('A table-wide switch greys that tick on every field and says why', async () => {
    await page.goto('/studio?tab=data&table=candidate')
    const bar = page.getByRole('group', { name: 'Table-wide switches for Candidate' })
    const group = bar.getByRole('switch', { name: /^Group rows/ })
    await expect(group).toBeChecked()
    await group.click()
    await expect(group).not.toBeChecked()
    await page.getByRole('button', { name: /Features of Email$/ }).click()
    const tick = page.getByRole('checkbox', { name: /^Groupable/ })
    await expect(tick).toBeDisabled()
    await expect(page.getByText('Turn on Group rows in the bar above first.')).toBeVisible()
    await expectReadable(page, tick) // greyed ticks stay legible
    await page.keyboard.press('Escape')
    await bar.getByRole('switch', { name: /^Filtering/ }).click()
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
    await page.goto('/studio?tab=data&table=candidate')
    await page.getByRole('button', { name: /Features of Email$/ }).click()
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} ${n.any[0]?.message ?? ''}`).join(' | ')}`)).toEqual([])
  })
})

test('Every change in the bar saves at once, and flipping something off and on again leaves it as it was', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUpWithPack(page, `Count Co ${run}`, `count-${run}@count.test`)
  await page.goto('/studio?tab=data&table=candidate')
  const panel = page.getByTestId('features-panel')
  const read = () => page.evaluate(async () => {
    const r = await fetch('/v1/studio/tables/candidate', { headers: { Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` } })
    return JSON.stringify(((await r.json()) as { features?: unknown }).features ?? null)
  })
  const start = await read()

  const flips: [string, () => ReturnType<typeof panel.getByRole>, string?][] = [
    ['a switch', () => panel.getByRole('switch', { name: /^Select rows/ })],
    ['a bulk action chip', () => page.getByRole('checkbox', { name: 'Delete (with Undo)' }), 'Bulk action options'],
    ['an export format chip', () => page.getByRole('checkbox', { name: 'CSV' }), 'Export options'],
  ]
  for (const [what, el, opener] of flips) {
    await test.step(`Flipping ${what} saves, and flipping it back restores it`, async () => {
      const open = async () => { if (opener) await page.getByRole('button', { name: opener }).click() }
      const close = async () => { if (opener) await page.keyboard.press('Escape') }
      await open()
      await featuresSaved(page, () => el().click())
      await expect.poll(read, what).not.toBe(start)
      await featuresSaved(page, () => el().click())
      await close()
      await expect.poll(read, `${what} back`).toBe(start)
    })
  }
})
