import { expect, test } from '@playwright/test'
import { run, signUpWithPack } from './helpers'

const SHOTS = '../../docs/screens/studio-table/s8'

test('Sidebar collapse and hide buttons sit at the top beside the app name, in full and in rail', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await signUpWithPack(page, `Top Ctl ${run}`, `tc-${run}@rail.test`)
  const side = page.locator('[data-sidebar]')
  const controls = page.getByTestId('sidebar-controls')
  const navTop = async () => (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!.y

  await test.step('Full: both buttons are above the menu, on the name row', async () => {
    const c = (await controls.boundingBox())!
    expect(c.y + c.height).toBeLessThanOrEqual(await navTop())
    expect(c.y).toBeLessThan(60)
    await page.screenshot({ path: `${SHOTS}/sidebar-full-top.png`, clip: { x: 0, y: 0, width: 250, height: 330 } })
  })

  await test.step('Rail: the buttons stack under the logo, still above the menu, and work', async () => {
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(side).toHaveAttribute('data-sidebar', 'collapsed')
    await expect.poll(async () => (await side.boundingBox())!.width).toBeLessThan(80)
    const c = (await controls.boundingBox())!
    expect(c.y + c.height).toBeLessThanOrEqual(await navTop())
    expect(c.x + c.width).toBeLessThanOrEqual(64)
    await page.screenshot({ path: `${SHOTS}/sidebar-rail-top.png`, clip: { x: 0, y: 0, width: 80, height: 330 } })
    await page.getByRole('button', { name: 'Expand sidebar' }).click()
    await expect(side).toHaveAttribute('data-sidebar', 'expanded')
  })

  await test.step('Nothing is left at the bottom, and Hide sidebar still works', async () => {
    const box = (await page.getByRole('button', { name: 'Hide sidebar' }).boundingBox())!
    expect(box.y).toBeLessThan(80)
    await page.getByRole('button', { name: 'Hide sidebar' }).click()
    await expect(page.locator('aside')).toBeHidden()
  })
})
