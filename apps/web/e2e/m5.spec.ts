/* eslint-disable @typescript-eslint/no-explicit-any -- test helper returns untyped API JSON */
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, signUpWithPack } from './helpers'

const CV = new URL('./fixtures/cv.pdf', import.meta.url)
const shot = async (page: Page, name: string) => {
  if (process.env.SCREENSHOTS) await page.screenshot({ path: `../../docs/screens/m5/${name}.png`, fullPage: true })
}

async function api<T = Record<string, any>>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ([m, p, b]) => {
      const res = await fetch(p as string, {
        method: m as string,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
        body: b === undefined ? undefined : JSON.stringify(b),
      })
      if (res.status === 204) return null
      const json = await res.json()
      if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json)}`)
      return json
    },
    [method, path, body] as const,
  ) as Promise<T>
}

/** The M5 demo script, on the built-in demo provider (no key, no network): AI only suggests. */
test('M5 demo: AI assist that proposes and never decides', async ({ page }) => {
  await signUpWithPack(page, `Northstar M5 ${run}`, `m5-${run}@northstar.test`)
  const cand = await api(page, 'POST', '/v1/records/candidate', {
    data: { full_name: 'Priya Nair', email: `priya-${run}@gmail.com`, phone: '+91 98450 22345', status: 'Active', current_title: 'Java Developer', skills: ['Java', 'SQL'], location: 'Pune' },
  })
  const client = await api(page, 'POST', '/v1/records/client', { data: { name: 'Aurora' } })
  const req = await api(page, 'POST', '/v1/records/requirement', { data: { title: 'Backend', client: client.id, skills: ['Java', 'SQL'], location: 'Pune' } })

  await test.step('1. AI is off by default: no AI buttons anywhere', async () => {
    await page.goto(`/records/candidate/${cand.id}`)
    await expect(page.getByRole('heading', { name: 'Priya Nair' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Summarise' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Draft message' })).toHaveCount(0)
  })

  await test.step('2. An admin turns it on for chosen tables and sets a limit', async () => {
    await page.goto('/settings?tab=ai')
    await expect(page.getByRole('tab', { name: 'AI' })).toHaveAttribute('aria-selected', 'true')
    await page.getByLabel('Turn AI on for this workspace').check()
    await page.getByLabel('candidate', { exact: true }).check()
    await page.getByLabel('requirement', { exact: true }).check()
    await page.getByLabel(/^Monthly limit/).fill('50000')
    await shot(page, 'settings')
    await page.getByRole('button', { name: 'Save AI settings' }).click()
    await expect(page.getByText('AI settings saved', { exact: true })).toBeVisible()
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })

  await test.step('3. A summary appears, labelled as a suggestion', async () => {
    await page.goto(`/records/candidate/${cand.id}`)
    await page.getByRole('button', { name: 'Summarise' }).click()
    const note = page.getByTestId('ai-summary').getByTestId('ai-note')
    await expect(note).toContainText('AI suggestion')
    await expect(note).toContainText('Check it before you use it')
    await expect(note).toContainText('Built from:')
    await expect(note).not.toContainText('gmail.com') // contact details never go to the model
    await shot(page, 'summary')
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })

  await test.step('4. A draft message is only text to edit; nothing is sent', async () => {
    await page.getByRole('button', { name: 'Draft message' }).click()
    const dialog = page.getByRole('dialog', { name: 'Draft a message' })
    await dialog.getByLabel(/^What is the message for/).fill('tell her about a Pune role')
    await dialog.getByRole('button', { name: 'Write a draft' }).click()
    await expect(dialog.getByTestId('ai-draft')).toContainText('AI draft')
    await expect(dialog.getByLabel('Subject')).toHaveValue(/demo draft/)
    await dialog.getByLabel('Message', { exact: true }).fill('Hi Priya, a Pune role. [Your name]')
    await expect(dialog.getByRole('button', { name: 'Copy' })).toBeVisible()
    await shot(page, 'draft')
    await page.keyboard.press('Escape')
  })

  await test.step('5. A match score can be explained; the score does not change', async () => {
    await page.goto(`/match/requirement_matches/${req.id}`)
    const first = page.getByTestId('match').first()
    const score = await first.getByLabel(/^Score /).getAttribute('aria-label')
    await first.getByRole('button', { name: 'Explain this score' }).click()
    await expect(first.getByTestId('ai-note')).toContainText('AI explanation')
    await expect(first.getByLabel(/^Score /)).toHaveAttribute('aria-label', score!)
    await shot(page, 'match')
  })

  await test.step('6. A sentence becomes filters the list already understands', async () => {
    await page.goto('/records/candidate')
    await page.getByRole('button', { name: 'Ask in words' }).click()
    await page.getByLabel(/^Ask in words/).fill('active people')
    await page.getByRole('button', { name: 'Find' }).click()
    await expect(page.getByTestId('ask-in-words')).toContainText('Applied 1 filter')
    await expect(page.getByRole('link', { name: 'Priya Nair' })).toBeVisible()
    await shot(page, 'ask')
  })

  await test.step('7. A number on Insights can be explained from its own figures', async () => {
    await page.goto('/insights')
    const card = page.getByTestId('insight-active_candidates')
    await card.getByRole('button', { name: 'Explain' }).click()
    await expect(card.getByTestId('ai-note')).toContainText('AI explanation')
  })

  await test.step('8. A CV can be searched for missing details; each one needs a click to use', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Add from CV' }).click()
    await page.getByLabel('Document to read').setInputFiles(CV.pathname)
    await expect(page.getByTestId('parse-summary')).toContainText('Read')
    await page.getByRole('button', { name: 'Look for the missing details with AI' }).click()
    const panel = page.getByTestId('ai-suggest').getByTestId('ai-note')
    await expect(panel).toContainText('AI found these in the document')
    const use = panel.getByRole('button', { name: 'Use', exact: true })
    if ((await use.count()) > 0) {
      await use.first().click()
      await expect(panel.getByRole('button', { name: 'Used' }).first()).toBeDisabled()
    }
    await shot(page, 'cv')
  })

  await test.step('9. The log shows every call, and turning AI off hides every button', async () => {
    await page.goto('/settings?tab=ai')
    const log = page.getByRole('table', { name: 'Recent AI use' })
    await expect(log).toContainText('record summary')
    await expect(log).toContainText('draft message')
    await page.getByLabel('Turn AI on for this workspace').uncheck()
    await page.getByRole('button', { name: 'Save AI settings' }).click()
    await expect(page.getByText('AI settings saved', { exact: true })).toBeVisible()
    await page.goto(`/records/candidate/${cand.id}`)
    await expect(page.getByRole('heading', { name: 'Priya Nair' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Summarise' })).toHaveCount(0)
  })
})
