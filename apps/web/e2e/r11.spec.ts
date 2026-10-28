import { expect, test } from '@playwright/test'
import { run, signUpWithPack } from './helpers'

test('Canvas: a hovered table lifts and its links flow toward the table they point at', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUpWithPack(page, `Canvas Co ${run}`, `canvas-${run}@canvas.test`)
  await page.goto('/studio?tab=map')
  const card = page.getByTestId('box-candidate')
  await expect(card).toBeVisible()
  const flowing = page.locator('.react-flow__edge.map-flow .react-flow__edge-path')

  await test.step('At rest nothing moves', async () => {
    await expect(flowing).toHaveCount(0)
    expect(await card.evaluate((e) => getComputedStyle(e).transform)).toBe('none')
  })

  await test.step('Hovering lifts the card in 3D and starts the flow on its lines', async () => {
    await card.hover()
    await expect(flowing.first()).toBeAttached()
    await expect.poll(() => card.evaluate((e) => getComputedStyle(e).transform)).not.toBe('none')
    const anim = await flowing.first().evaluate((e) => ({ name: getComputedStyle(e).animationName, dash: getComputedStyle(e).strokeDasharray }))
    expect(anim.name).toBe('map-flow')
    expect(anim.dash).not.toBe('none')
    if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/r11-canvas-hover.png` })
  })

  await test.step('Moving away stops it', async () => {
    await page.mouse.move(5, 5)
    await expect(flowing).toHaveCount(0)
    await expect.poll(() => card.evaluate((e) => getComputedStyle(e).transform)).toBe('none')
  })

  await test.step('With reduced motion the card does not lift and lines stay still', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await card.hover()
    await expect(flowing.first()).toBeAttached()
    expect(await card.evaluate((e) => getComputedStyle(e).transform)).toBe('none')
    expect(await flowing.first().evaluate((e) => getComputedStyle(e).animationName)).toBe('none')
  })
})
