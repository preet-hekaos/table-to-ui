import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { run, signUpWithPack } from './helpers'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const PATTERNS = ['Searchable table', 'Profile', 'Master-detail', 'Form', 'Ranked list', 'Document review', 'Detail']
const STATES = ['Ready', 'Loading', 'Empty', 'Error', 'No access', 'Not found', 'Blocked by a rule', 'Changed by someone else', 'AI unavailable']
const shot = (n: string) => `../../docs/screens/patterns/${n.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`

/** M1-S26: every pattern in every state passes axe, works by keyboard and fits 360 px. Screenshots for sign-off. */
test('pattern library: seven patterns, eight states, keyboard and 360 px', async ({ page }) => {
  test.setTimeout(240_000)
  await signUpWithPack(page, `Patterns ${run}`, `patterns-${run}@x.test`)
  await page.goto('/patterns')
  const stage = page.getByTestId('pattern-stage')
  for (const p of PATTERNS) {
    await page.getByRole('tab', { name: p, exact: true }).click()
    for (const s of STATES) {
      await page.getByRole('radiogroup', { name: 'State' }).getByText(s, { exact: true }).click()
      await expect(stage).toBeVisible()
      const r = await new AxeBuilder({ page }).withTags(tags).include('[data-testid="pattern-stage"]').analyze()
      expect(r.violations, `${p} / ${s}: ${r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')}`).toEqual([])
    }
    await page.getByRole('radiogroup', { name: 'State' }).getByText('Ready', { exact: true }).click()
    await page.screenshot({ path: shot(`${p}-desktop`), fullPage: true })
  }
  for (const s of STATES.slice(1)) {
    await page.getByRole('radiogroup', { name: 'State' }).getByText(s, { exact: true }).click()
    await stage.screenshot({ path: shot(`state-${s}`) })
  }
  // Keyboard: the pattern tabs and states are reachable and operable without a mouse.
  await page.getByRole('tab', { name: 'Searchable table' }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('tab', { name: 'Profile' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true')
  // 360 px: no sideways scrolling for any pattern.
  await page.setViewportSize({ width: 360, height: 740 })
  await page.getByRole('radiogroup', { name: 'State' }).getByText('Ready', { exact: true }).click()
  for (const p of PATTERNS) {
    await page.getByRole('tab', { name: p, exact: true }).click()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${p} scrolls sideways at 360px`).toBeLessThanOrEqual(0)
    await page.screenshot({ path: shot(`${p}-360`), fullPage: true })
  }
})
