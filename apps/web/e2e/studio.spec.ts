import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, signUpWithPack } from './helpers'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function publishAndMakeLive(page: Page) {
  await page.getByTestId('draft-banner').getByRole('button', { name: 'Publish Draft to Test' }).click()
  await expect(page.getByText(/is in Test/).first()).toBeVisible()
  await page.goto('/studio?tab=versions')
  await page.getByRole('button', { name: 'Make Live' }).first().click()
  await expect(page.getByText(/is now Live/).first()).toBeVisible()
}

/** M1-S12 to S17: the builder changes the app from the Studio, with no code. */
test('Studio: fields, tables, map, screens, menu, preview and versions', async ({ page }) => {
  await signUpWithPack(page, `Studio Co ${run}`, `studio-${run}@studio.test`)

  await test.step('S12. Add an agency field to Candidate; it stays in Draft until published', async () => {
    await page.goto('/studio')
    await page.getByRole('button', { name: 'Add field' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Label/).fill('Preferred shift')
    await dialog.getByLabel('Type').selectOption('select')
    await dialog.getByLabel(/^Choices/).fill('Day, Night')
    await dialog.getByRole('button', { name: 'Add field' }).click()
    await expect(page.getByRole('row', { name: /^Preferred shift Choice from a list No Workspace/ })).toBeVisible()
    await expect(page.getByTestId('draft-banner')).toContainText('1 unpublished change')
    await page.goto('/records/candidate/new')
    await expect(page.getByLabel(/^Preferred shift/)).toHaveCount(0)
  })

  await test.step('S12. A pack field can be renamed but not deleted', async () => {
    await page.goto('/studio')
    await page.getByRole('button', { name: 'Edit Current employer' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('cannot be deleted')
    await expect(dialog.getByRole('button', { name: 'Delete field' })).toHaveCount(0)
    await dialog.getByLabel(/^Label/).fill('Employer')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('row', { name: /^Employer Short text/ })).toBeVisible()
  })

  await test.step('S12. Create a new table; it gets a screen and a menu entry', async () => {
    await page.getByRole('button', { name: 'New table' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Name of one record/).fill('Referral partner')
    await dialog.getByRole('button', { name: 'Create table' }).click()
    await expect(page.getByRole('heading', { name: 'Referral partner', exact: true })).toBeVisible()
  })

  await test.step('S13. The canvas draws every table; opening one goes to Data', async () => {
    await page.getByRole('tab', { name: 'Canvas' }).click()
    const canvas = page.getByTestId('canvas')
    await expect(canvas.locator('.react-flow__node')).toHaveCount(14) // 13 pack tables + the new one
    await canvas.getByRole('button', { name: 'Open Client fields' }).click()
    await expect(page.getByRole('tab', { name: 'Data' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: 'Client', exact: true })).toBeVisible()
  })

  await test.step('S15. Configure the candidates screen; the preview follows at once', async () => {
    await page.getByRole('tab', { name: 'Screens' }).click()
    await page.getByLabel('Screen to configure').selectOption({ label: 'Candidates' })
    const preview = page.getByTestId('screen-preview')
    await page.getByLabel('Empty-state text').fill('Nobody here yet, add a candidate')
    await expect(preview).toContainText('Nobody here yet, add a candidate', { timeout: 1000 })
    await page.getByRole('group', { name: 'Actions' }).getByLabel('Export CSV').check()
    await page.getByRole('button', { name: 'Save screen' }).click()
    await expect(page.getByText('Saved Candidates in Draft').first()).toBeVisible()
  })

  await test.step('S15. The gallery shows each pattern drawn with the workspace data', async () => {
    await page.getByRole('button', { name: 'New screen from a pattern' }).click()
    await expect(page.getByRole('list', { name: 'Patterns' }).getByRole('listitem')).toHaveCount(7)
  })

  await test.step('S14. Rename a menu entry; Live keeps the old one until publish', async () => {
    await page.getByRole('tab', { name: 'Menu' }).click()
    await page.getByLabel('Label for Candidates').fill('Talent')
    await page.getByRole('button', { name: 'Save menu' }).click()
    await expect(page.getByText('Menu saved in Draft').first()).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Candidates', exact: true })).toBeVisible()
  })

  await test.step('S17. Compare the Draft with Live, then publish and make it Live', async () => {
    await page.getByRole('tab', { name: 'Versions' }).click()
    const diff = page.getByTestId('diff')
    await expect(diff).toContainText('candidate')
    await expect(diff).toContainText('Preferred shift: added')
    await expect(diff).toContainText('referral_partner')
    await expect(diff).toContainText('candidates')
    await publishAndMakeLive(page)
    await page.reload()
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Talent', exact: true })).toBeVisible()
    await page.goto('/records/candidate/new')
    await expect(page.getByLabel(/^Preferred shift/)).toBeVisible()
    await page.goto('/s/candidates')
    await expect(page.getByText('Nobody here yet, add a candidate')).toBeVisible()
  })

  await test.step('S16. Preview as Sourcer: pay is hidden, fixtures pass on Test', async () => {
    await page.goto('/studio?tab=preview')
    await page.getByLabel('See it as').selectOption('sourcer')
    const frame = page.frameLocator('iframe')
    await expect(frame.getByTestId('preview-banner')).toContainText('sourcer')
    await page.getByRole('button', { name: /Run pack fixtures/ }).click()
    await expect(page.getByTestId('fixture-results')).toContainText('24 of 24 passed')
  })

  await test.step('Studio screens pass axe', async () => {
    for (const tab of ['data', 'map', 'screens', 'menu', 'versions']) {
      await page.goto(`/studio?tab=${tab}`)
      await page.waitForLoadState('networkidle')
      const r = await new AxeBuilder({ page }).withTags(tags).exclude('iframe').analyze()
      expect(r.violations, `${tab}: ${r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')}`).toEqual([])
    }
  })
})
