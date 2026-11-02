import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, signUpWithPack, setFieldFeature, setTableWide } from './helpers'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test('Numbers above the table follow the search; chosen in Studio; switch off', async ({ page }) => {
  await signUpWithPack(page, `Stats Co ${run}`, `stats-${run}@stats.test`)
  const made = await page.evaluate(async () => {
    const out: number[] = []
    for (const [i, [name, status, months, ctc]] of [['Asha Rao', 'Active', 24, 900000], ['Bimal Das', 'Placed', 60, 1500000], ['Chitra Iyer', 'Active', 36, 1200000]].entries()) {
      const res = await fetch('/v1/records/candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
        body: JSON.stringify({ data: { full_name: name, email: `s${i}@example.in`, phone: `+91 98450 1234${i}`, status, total_experience: months, expected_ctc: ctc } }),
      })
      out.push(res.status)
    }
    return out
  })
  expect(made).toEqual([201, 201, 201])
  await page.goto('/s/candidates')
  const strip = page.getByTestId('stats-strip')

  await test.step('Matching count and number fields appear', async () => {
    await expect(strip).toContainText('Matching')
    await expect(strip.locator('div').first()).toContainText('3')
    await expect(strip).toContainText('Average')
    const r = await new AxeBuilder({ page }).withTags(tags).analyze()
    expect(r.violations, r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
  })

  await test.step('A filter changes the numbers', async () => {
    await page.getByRole('button', { name: /Filter Status/i }).click()
    const menu = page.getByRole('dialog', { name: /^Filter / })
    await menu.getByRole('checkbox', { name: /^Select all/ }).uncheck() // everything starts ticked; clear, then pick the one
    await menu.getByRole('checkbox', { name: /^Placed/ }).check()
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(strip.locator('div').first()).toContainText('1')
  })

  await test.step('Choose the fields in Studio', async () => {
    await page.goto('/studio?tab=data&table=candidate')
    for (const f of ['Notice period \\(days\\)', 'Total experience', 'Current CTC']) await setFieldFeature(page, f, 'In the summary numbers', false)
    await setFieldFeature(page, 'Expected CTC', 'In the summary numbers', true)
  })

  await test.step('Switching it off removes the strip from the preview data', async () => {
    await setTableWide(page, 'Numbers above the table', false)
  })
})
