import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openTables, run, signUpWithPack } from './helpers'

const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png` })
}

test('Quiet scrollbars, and lists fade where there is more', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await signUpWithPack(page, `Scroll Co ${run}`, `scroll-${run}@scroll.test`)
  await page.goto('/studio?tab=data&table=candidate')

  await test.step('The scrollbar is slim, with no arrows', async () => {
    const look = await page.evaluate(() => {
      const bar = getComputedStyle(document.documentElement, '::-webkit-scrollbar')
      const btn = getComputedStyle(document.documentElement, '::-webkit-scrollbar-button')
      return { width: bar.width, button: btn.display }
    })
    expect(look.width).toBe('10px')
    expect(look.button).toBe('none')
  })

  await test.step('The table list is tall, scrolls quietly and fades at the edge with more', async () => {
    const list = await openTables(page)
    const box = list.locator('[data-fade="y"]')
    await expect(box).toBeVisible()
    const first = await box.evaluate((el) => ({ more: el.scrollHeight > el.clientHeight, fading: el.hasAttribute('data-fading'), height: el.clientHeight }))
    expect(first.height, 'taller than the old 288 px cap').toBeGreaterThan(300)
    if (first.more) {
      expect(first.fading).toBe(true)
      await box.evaluate((el) => el.scrollTo(0, el.scrollHeight))
      await expect(async () => {
        const f = await box.evaluate((el) => getComputedStyle(el).getPropertyValue('--fade-b').trim())
        expect(f).toBe('0px') // at the bottom there is nothing more below
      }).toPass()
    }
    await shot(page, 'r9-picker')
    await page.keyboard.press('Escape')
  })

  await test.step('A wide table fades at the right edge; nothing breaks for axe', async () => {
    await page.getByRole('tab', { name: 'Features' }).click()
    const grid = page.getByTestId('field-grid').locator('[data-fade="x"]')
    await page.setViewportSize({ width: 900, height: 800 })
    await expect(grid).toHaveAttribute('data-fading', '')
    await shot(page, 'r9-grid')
    const r = await new AxeBuilder({ page }).analyze()
    expect(r.violations).toEqual([])
  })
})
