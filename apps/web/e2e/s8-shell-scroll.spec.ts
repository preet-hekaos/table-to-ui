import { expect, test } from '@playwright/test'
import { run, signUpWithPack } from './helpers'

const SHOTS = '../../docs/screens/studio-table/s8'

test('Scrolling a long page scrolls only the content: the window never moves and the sidebar and header stay put', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 770 })
  await signUpWithPack(page, `Shell Scroll ${run}`, `ss-${run}@studio.test`)

  await test.step('Hidden screen-reader text deep in a long page does not make the window scrollable', async () => {
    await page.evaluate(() => {
      const main = document.getElementById('main')!
      const tall = document.createElement('div')
      tall.style.height = '2000px'
      const hid = document.createElement('span')
      hid.className = 'sr-only'
      hid.textContent = 'hidden'
      main.append(tall, hid)
    })
    const sizes = await page.evaluate(() => ({ doc: document.scrollingElement!.scrollHeight, view: innerHeight }))
    expect(sizes.doc).toBe(sizes.view)
  })

  await test.step('A mouse-wheel scroll moves the content, not the window', async () => {
    await page.mouse.move(800, 400)
    await page.mouse.wheel(0, 3000)
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    expect(await page.evaluate(() => document.getElementById('main')!.scrollTop)).toBeGreaterThan(100)
    await expect(page.getByRole('banner')).toBeInViewport()
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeInViewport()
    await page.screenshot({ path: `${SHOTS}/home-scrolled.png` })
  })
})
