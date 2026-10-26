import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, signUpWithPack } from './helpers'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/** N2: the canvas shows small cards in an ordered layout; details open in a drawer beside it. */
test('Canvas: cards, details drawer, focus, find a table, merged lines', async ({ page }) => {
  await signUpWithPack(page, `Canvas Co ${run}`, `canvas-${run}@canvas.test`)
  const canvas = page.getByTestId('canvas')
  const card = (k: string) => canvas.getByTestId(`box-${k}`)

  await test.step('Every table is one small card that says how many fields and links it has', async () => {
    await page.goto('/studio?tab=map')
    await expect(canvas.locator('.react-flow__node')).toHaveCount(13)
    await expect(card('candidate')).toContainText('13 fields')
    await expect(card('candidate')).toContainText('6 links')
    await expect(card('skill')).toContainText('0 links')
    // Parents sit to the left of the tables that point at them
    const client = (await card('client').boundingBox())!
    const contact = (await card('contact').boundingBox())!
    expect(client.x).toBeLessThan(contact.x)
  })

  await test.step('A click opens the drawer with the table, its links and its fields; Escape closes it', async () => {
    await card('requirement').getByRole('button').click()
    const drawer = page.getByTestId('table-drawer')
    await expect(drawer.getByRole('heading', { name: 'Requirement' })).toBeVisible()
    await expect(drawer.getByRole('region', { name: 'Links out' })).toContainText('Client')
    await expect(drawer.getByRole('region', { name: 'Links in' })).toContainText('Submission')
    await expect(drawer.getByRole('region', { name: 'Fields' })).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Add link' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
  })

  await test.step('Focus shows only the chosen table and its neighbours', async () => {
    await card('client').getByRole('button').click()
    await page.getByTestId('table-drawer').getByLabel('Focus on this table').check()
    await expect(canvas.locator('.react-flow__node')).toHaveCount(5) // Client, Contact, Interaction, Placement, Requirement
    await page.getByTestId('table-drawer').getByLabel('Focus on this table').uncheck()
    await expect(canvas.locator('.react-flow__node')).toHaveCount(13)
    await page.getByRole('button', { name: 'Close details' }).click()
  })

  await test.step('Find a table by name', async () => {
    await page.getByLabel('Find a table').fill('offer')
    await page.getByRole('button', { name: 'Go to table' }).click()
    await expect(page.getByTestId('table-drawer').getByRole('heading', { name: 'Offer' })).toBeVisible()
    await page.getByLabel('Find a table').fill('zzz')
    await page.getByRole('button', { name: 'Go to table' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'No table called' })).toBeVisible()
    await page.getByRole('button', { name: 'Close details' }).click()
  })

  await test.step('Several links between the same two tables are drawn as one line with a count', async () => {
    await canvas.getByRole('button', { name: 'fit view' }).click() // show the whole map again after the search moved it
    await card('interaction').getByRole('button').click()
    await page.getByTestId('table-drawer').getByRole('button', { name: 'Add link' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('…belongs to one').selectOption('client')
    await dialog.getByLabel('Field label').fill('Account owner')
    await dialog.getByRole('button', { name: 'Add link' }).click()
    await expect(canvas.locator('.react-flow__edge-text', { hasText: '2 links' })).toHaveCount(1)
    await expect(card('interaction')).toContainText('3 links')
  })

  await test.step('The graph view shows the same tables as dots, sized by their links, and opens the same drawer', async () => {
    await page.getByRole('radio', { name: 'Graph' }).click()
    await expect(page.getByRole('radio', { name: 'Graph' })).toHaveAttribute('aria-checked', 'true')
    await expect(canvas.locator('.react-flow__node')).toHaveCount(13)
    const big = (await card('candidate').locator('button').boundingBox())!
    const small = (await card('skill').locator('button').boundingBox())!
    expect(big.width).toBeGreaterThan(small.width)
    await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/n2-graph.png` : 'test-results/n2-graph.png' })
    await card('client').getByRole('button').click()
    await expect(page.getByTestId('table-drawer').getByRole('heading', { name: 'Client' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('radio', { name: 'Graph' })).toHaveAttribute('aria-checked', 'true') // the choice is remembered
    await page.getByRole('radio', { name: 'Cards' }).click()
    await expect(canvas.getByTestId('box-candidate')).toContainText('fields')
  })

  await test.step('Auto-arrange keeps every table and the page passes the accessibility check', async () => {
    await page.getByRole('button', { name: 'Auto-arrange' }).click()
    await expect(canvas.locator('.react-flow__node')).toHaveCount(13)
    const results = await new AxeBuilder({ page }).withTags(tags).analyze()
    expect(results.violations, results.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
  })
})
