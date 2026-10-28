import { expect, test } from '@playwright/test'
import { run, signUpWithPack } from './helpers'

/** The glow is the only shadow drawn in the accent colour, so it shows up as a colour-mix value rather than plain rgba. */
const GLOW = /oklab|color\(|lab\(/

test('Canvas: a hovered or chosen table lifts, glows, and its links flow toward the table they point at', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUpWithPack(page, `Canvas Co ${run}`, `canvas-${run}@canvas.test`)
  await page.goto('/studio?tab=map')
  const card = page.getByTestId('box-candidate')
  await expect(card).toBeVisible()
  const flowing = page.locator('.react-flow__edge.map-flow .react-flow__edge-path')
  const style = (el: ReturnType<typeof page.locator>) => el.evaluate((e) => ({ transform: getComputedStyle(e).transform, shadow: getComputedStyle(e).boxShadow }))

  await test.step('At rest nothing moves or glows', async () => {
    await expect(flowing).toHaveCount(0)
    const s = await style(card)
    expect(s.transform).toBe('none')
    expect(s.shadow).not.toMatch(GLOW)
  })

  await test.step('Hovering lifts the card in 3D, makes it glow, and starts the flow on its lines', async () => {
    await card.hover()
    await expect(flowing.first()).toBeAttached()
    await expect.poll(async () => (await style(card)).transform).not.toBe('none')
    await expect.poll(async () => (await style(card)).shadow).toMatch(GLOW)
    const anim = await flowing.first().evaluate((e) => ({ name: getComputedStyle(e).animationName, dash: getComputedStyle(e).strokeDasharray }))
    expect(anim.name).toBe('map-flow')
    expect(anim.dash).not.toBe('none')
    if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/r11-canvas-hover.png` })
  })

  await test.step('Moving away stops it', async () => {
    await page.mouse.move(5, 5)
    await expect(flowing).toHaveCount(0)
    await expect.poll(async () => (await style(card)).transform).toBe('none')
  })

  await test.step('A chosen table keeps the lift, glow and flow until another is chosen', async () => {
    await card.getByRole('button').click()
    await page.mouse.move(5, 5)
    await expect(card).toHaveAttribute('data-lit', 'true')
    await expect(flowing.first()).toBeAttached()
    await expect.poll(async () => (await style(card)).transform).not.toBe('none')
    await expect.poll(async () => (await style(card)).shadow).toMatch(GLOW)
    if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/r11-canvas-selected.png` })
  })

  await test.step('The graph view does the same with dots', async () => {
    await page.getByRole('radio', { name: 'Graph' }).click()
    const dot = page.getByTestId('box-candidate').getByRole('button')
    await expect(dot).toBeVisible()
    await dot.click() // switching views starts afresh, so choose the table again
    await page.mouse.move(5, 5)
    await expect(dot).toHaveAttribute('data-lit', 'true')
    await expect(flowing.first()).toBeAttached()
    await expect.poll(() => dot.evaluate((e) => getComputedStyle(e).transform)).not.toBe('none')
    await expect.poll(() => dot.evaluate((e) => getComputedStyle(e).boxShadow)).toMatch(GLOW)
    if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/r11-graph-selected.png` })
    // Hovering another dot lights it up and moves the flow to its own lines.
    const other = page.getByTestId('box-task').getByRole('button')
    await other.hover()
    await expect.poll(async () => other.evaluate((e) => getComputedStyle(e).transform)).not.toBe('none')
    await expect(flowing.first()).toBeAttached()
    if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/r11-graph-hover.png` })
  })

  await test.step('With reduced motion nothing lifts and lines stay still', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const dot = page.getByTestId('box-candidate').getByRole('button')
    await dot.hover()
    await expect(flowing.first()).toBeAttached()
    expect(await dot.evaluate((e) => getComputedStyle(e).transform)).toBe('none')
    expect(await flowing.first().evaluate((e) => getComputedStyle(e).animationName)).toBe('none')
  })
})
