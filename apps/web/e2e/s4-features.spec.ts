import { expect, test, type Page } from '@playwright/test'
import { run, signUpWithPack } from './helpers'

const SHOTS = '../../docs/screens/studio-table/s4'
const cell = (page: Page, label: string) => page.getByRole('button', { name: new RegExp(`Features of ${label}$`) })

test('S4.1 the Features cell: chips, +N, the dropdown with its eleven ticks, keyboard, and the table-wide bar', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1100 })
  await signUpWithPack(page, `S4 Cell ${run}`, `s4a-${run}@studio.test`)
  await page.goto('/studio')
  await expect(page.getByRole('table', { name: 'Candidate fields' })).toBeVisible()

  await test.step('Each row shows up to three chips, +N and a caret', async () => {
    const phone = cell(page, 'Phone')
    await expect(phone).toContainText('Sort')
    await expect(phone).not.toContainText('Filter') // the pack does not make phone numbers filterable
    await expect(phone).toContainText('Edit')
    await expect(phone).toContainText('+')
    await expect(cell(page, 'Full name')).toContainText('Shown')
  })

  await test.step('The table-wide bar is above the grid with seven switches', async () => {
    const bar = page.getByRole('group', { name: 'Table-wide switches for Candidate' })
    await expect(bar.getByRole('switch')).toHaveCount(7)
    for (const n of ['Sorting', 'Filtering', 'Edit in the list', 'Group rows', 'Export data', 'Select rows', 'Numbers above the table'])
      await expect(bar.getByRole('switch', { name: new RegExp(`^${n}`) })).toBeChecked()
  })

  await test.step('The dropdown lists the eleven ticks with their one-line meaning', async () => {
    await cell(page, 'Phone').click()
    const pop = page.getByRole('dialog', { name: 'Features of Phone' })
    await expect(pop.getByRole('checkbox')).toHaveCount(11)
    for (const n of ['Shown in the list', 'Sortable', 'Filterable', 'Editable in the list', 'Groupable', 'Exportable', 'Bulk edit', 'In the summary numbers', 'Chart axis', 'Unique', 'Searchable'])
      await expect(pop.getByRole('checkbox', { name: new RegExp(`^${n}`) })).toBeVisible()
    await expect(pop.getByRole('checkbox', { name: /^In the summary numbers/ })).toBeDisabled()
    await expect(pop.getByText('Only number fields can be summarised.')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/after-dropdown.png` })
  })

  await test.step('A tick saves at once and the chips follow; Esc closes and returns focus', async () => {
    const pop = page.getByRole('dialog', { name: 'Features of Phone' })
    await pop.getByRole('checkbox', { name: /^Sortable/ }).uncheck()
    await expect(pop.getByRole('checkbox', { name: /^Sortable/ })).not.toBeChecked()
    await expect(page.getByTestId('draft-banner')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await expect(cell(page, 'Phone')).toBeFocused()
    await expect(cell(page, 'Phone')).not.toContainText('Sort')
  })

  await test.step('Keyboard only: Enter opens, Space ticks', async () => {
    await cell(page, 'Email').focus()
    await page.keyboard.press('Enter')
    const pop = page.getByRole('dialog', { name: 'Features of Email' })
    await expect(pop).toBeVisible()
    const edit = pop.getByRole('checkbox', { name: /^Editable in the list/ })
    await edit.focus()
    await page.keyboard.press('Space')
    await expect(edit).not.toBeChecked()
    await page.keyboard.press('Escape')
  })

  await test.step('A table-wide switch greys the tick on every field and the same flag shows on the Features tab', async () => {
    const bar = page.getByRole('group', { name: 'Table-wide switches for Candidate' })
    await bar.getByRole('switch', { name: /^Export data/ }).click()
    await cell(page, 'Email').click()
    const pop = page.getByRole('dialog', { name: 'Features of Email' })
    await expect(pop.getByRole('checkbox', { name: /^Exportable/ })).toBeDisabled()
    await expect(pop.getByText('Turn on Export data in the bar above first.')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: 'Features' }).click()
    await expect(page.getByTestId('features-panel').getByRole('switch', { name: /Export data/ })).not.toBeChecked()
    await expect(page.getByTestId('field-grid')).toHaveCount(0)
    await page.getByRole('tab', { name: 'Fields' }).click()
    await bar.getByRole('switch', { name: /^Export data/ }).click()
    await expect(bar.getByRole('switch', { name: /^Export data/ })).toBeChecked()
    await page.screenshot({ path: `${SHOTS}/after-fields-tab.png`, fullPage: true })
  })
})
