import { expect, test } from '@playwright/test'
import { run, signUpWithPack } from './helpers'
import { freshSession, publishLive } from './live-effect'

const row = (page: import('@playwright/test').Page, key: string) =>
  page.getByRole('row', { name: new RegExp(`^(?:Move [^.]*\\. Drag, or use the up and down arrow keys\\. )?${key} `) })

test('S3.3 the fx popover: library, own pattern, order, switch, Cancel versus Done, and the live form obeys it', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1400, height: 1000 })
  await signUpWithPack(page, `S3 Fx ${run}`, `s3a-${run}@studio.test`)
  await page.goto('/studio')
  const fx = (text: string) => page.getByRole('button', { name: new RegExp(`^${text}\\. Validation of Current title`) })
  const pop = page.getByRole('dialog', { name: 'Validation for Current title' })

  await test.step('Other types show a dash; a text field shows Add', async () => {
    await expect(row(page, 'notice_period_days').getByLabel('Notice period (days) has no validation rules')).toBeVisible()
    await expect(fx('Add')).toBeVisible()
  })

  await test.step('Cancel throws the changes away', async () => {
    await fx('Add').click()
    await pop.getByRole('button', { name: 'PAN', exact: true }).click()
    await expect(pop.getByRole('list', { name: 'Rules' }).getByRole('listitem')).toHaveCount(1)
    await pop.getByRole('button', { name: 'Cancel' }).click()
    await expect(pop).toHaveCount(0)
    await expect(fx('Add')).toBeVisible()
    await expect(page.getByTestId('draft-banner')).toHaveCount(0)
  })

  await test.step('An invalid and a runaway pattern are refused with the reason', async () => {
    await fx('Add').click()
    await pop.getByRole('button', { name: '+ Write my own pattern' }).click()
    const pattern = pop.getByLabel('Pattern of My pattern')
    await pattern.fill('[')
    await pattern.blur()
    await expect(pop.getByRole('alert')).toContainText('not valid')
    await pattern.fill('(a+)+$')
    await pattern.blur()
    await expect(pop.getByRole('alert')).toContainText('run away')
    await pop.getByRole('button', { name: 'Delete My pattern' }).click()
  })

  await test.step('PAN from the library, then a length rule: order changes, a message is edited, Done saves', async () => {
    await pop.getByRole('button', { name: 'PAN', exact: true }).click()
    await pop.getByRole('button', { name: '+ Write my own pattern' }).click()
    const own = pop.getByLabel('Pattern of My pattern')
    await own.fill('^.{10}$')
    await pop.getByLabel('Name of rule 2').fill('Ten characters')
    await pop.getByLabel('Message of Ten characters').fill('Exactly 10 characters.')
    await pop.getByRole('button', { name: 'Move Ten characters up' }).click()
    await expect(pop.getByLabel('Name of rule 1')).toHaveValue('Ten characters')
    await pop.getByRole('button', { name: 'Move Ten characters down' }).click()
    await expect(pop.getByLabel('Name of rule 2')).toHaveValue('Ten characters')
    await pop.getByLabel('Message of PAN').fill('Enter a PAN like ABCDE1234F.')
    await page.screenshot({ path: '../../docs/screens/studio-table/s3/after-popover.png' })
    await pop.getByRole('button', { name: 'Done' }).click()
    await expect(pop).toHaveCount(0)
    await expect(fx('2 rules')).toBeVisible()
    await expect(page.getByTestId('draft-banner')).toContainText('unpublished change')
  })

  await test.step('After publishing, the live form refuses a bad PAN with the message and takes a good one', async () => {
    await publishLive(page)
    const live = await freshSession(browser, page)
    await live.goto('/records/candidate/new')
    await live.getByLabel(/^Full name/).fill('Rule Check')
    await live.getByLabel(/^Email/).fill(`s3a-${run}@rule.test`)
    await live.getByLabel(/^Phone/).fill('+91 98450 55555')
    await live.getByLabel(/^Current title/).fill('abcde1234f')
    await live.getByRole('button', { name: 'Save candidate' }).click()
    await expect(live.getByText('Enter a PAN like ABCDE1234F.')).toBeVisible()
    await live.getByLabel(/^Current title/).fill('ABCDE1234F')
    await live.getByRole('button', { name: 'Save candidate' }).click()
    await expect(live.getByText('ABCDE1234F').first()).toBeVisible()
    await live.context().close()
  })

  await test.step('Switching the rule off lets the same bad value in after publishing', async () => {
    await page.goto('/studio')
    await fx('2 rules').click()
    await pop.getByRole('switch', { name: 'PAN is on' }).click()
    await pop.getByRole('switch', { name: 'Ten characters is on' }).click()
    await pop.getByRole('button', { name: 'Done' }).click()
    await publishLive(page)
    const live = await freshSession(browser, page)
    await live.goto('/records/candidate/new')
    await live.getByLabel(/^Full name/).fill('Rule Off')
    await live.getByLabel(/^Email/).fill(`s3b-${run}@rule.test`)
    await live.getByLabel(/^Phone/).fill('+91 98450 66666')
    await live.getByLabel(/^Current title/).fill('abcde1234f')
    await live.getByRole('button', { name: 'Save candidate' }).click()
    await expect(live.getByText('abcde1234f').first()).toBeVisible()
    await live.context().close()
  })
})

test('S3.4 existing records: the popover counts them, publish warns with the count and still goes through', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1400, height: 1000 })
  await signUpWithPack(page, `S3 Ex ${run}`, `s3c-${run}@studio.test`)
  const make = async (name: string, phone: string, title: string) => {
    await page.goto('/records/candidate/new')
    await page.getByLabel(/^Full name/).fill(name)
    await page.getByLabel(/^Email/).fill(`${name.toLowerCase().replace(' ', '')}-${run}@ex.test`)
    await page.getByLabel(/^Phone/).fill(phone)
    await page.getByLabel(/^Current title/).fill(title)
    await page.getByRole('button', { name: 'Save candidate' }).click()
    await expect(page.getByText(title).first()).toBeVisible()
  }
  await make('Good Pan', '+91 98450 11111', 'ABCDE1234F')
  await make('Bad Pan', '+91 98450 22222', 'not a pan')

  await page.goto('/studio')
  await page.getByRole('button', { name: /^Add\. Validation of Current title/ }).click()
  const pop = page.getByRole('dialog', { name: 'Validation for Current title' })
  await pop.getByRole('button', { name: 'PAN', exact: true }).click()

  await test.step('The popover counts the records that already break the rules and changes nothing', async () => {
    await pop.getByRole('button', { name: 'Check existing records' }).click()
    await expect(pop.getByRole('status')).toContainText('1 of 2 records with a value break these rules')
    await expect(page.getByTestId('draft-banner')).toHaveCount(0)
  })

  await test.step('After Done the Draft banner warns with the count and explains the records stay as they are', async () => {
    await pop.getByRole('button', { name: 'Done' }).click()
    const warn = page.getByTestId('rule-warnings')
    await expect(warn).toContainText('1 existing record')
    await expect(warn).toContainText('Current title')
    await expect(warn).toContainText('They stay as they are')
    await page.screenshot({ path: '../../docs/screens/studio-table/s3/after-publish-warning.png' })
  })

  await test.step('Publishing is not blocked, the old record is untouched, and the warning goes away', async () => {
    await publishLive(page)
    await page.goto('/studio')
    await expect(page.getByTestId('rule-warnings')).toHaveCount(0)
    const live = await freshSession(browser, page)
    await live.goto('/records/candidate')
    await expect(live.getByText('not a pan').first()).toBeVisible()
    await live.context().close()
  })
})

test('S3.5 describe it in words: disabled with AI off, a checked suggestion with AI on, added only by Use as rule', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1400, height: 1100 })
  await signUpWithPack(page, `S3 Ai ${run}`, `s3d-${run}@studio.test`)
  await page.goto('/studio')
  const fx = () => page.getByRole('button', { name: /^(Add|\d+ rules?)\. Validation of Current title/ })
  const pop = page.getByRole('dialog', { name: 'Validation for Current title' })

  await test.step('With AI off the panel is disabled with the reason, and the library still saves a rule', async () => {
    await fx().click()
    await expect(pop.getByLabel('Describe the allowed values')).toBeDisabled()
    await expect(pop.getByRole('button', { name: 'Make a pattern' })).toBeDisabled()
    await expect(pop.getByText('AI is off for this workspace, so this panel is disabled')).toBeVisible()
    await pop.getByRole('button', { name: 'Web link' }).click()
    await expect(pop.getByRole('list', { name: 'Rules' }).getByRole('listitem')).toHaveCount(1)
    await pop.getByRole('button', { name: 'Cancel' }).click()
  })

  await test.step('An admin turns AI on in Settings', async () => {
    const status = await page.evaluate(async () => {
      const r = await fetch('/v1/ai/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` }, body: JSON.stringify({ enabled: true, tables: [] }) })
      return r.status
    })
    expect(status).toBe(200)
    await page.goto('/studio')
  })

  await test.step('A description makes a checked suggestion; nothing is added until Use as rule', async () => {
    await fx().click()
    await pop.getByLabel('Describe the allowed values').fill('5 capital letters, then 4 digits, then 1 capital letter')
    await pop.getByRole('button', { name: 'Make a pattern' }).click()
    const proposal = pop.getByTestId('proposal')
    await expect(proposal).toContainText('^[A-Z]{5}[0-9]{4}[A-Z]{1}$')
    await expect(proposal.getByText('Allowed').first()).toBeVisible()
    await expect(proposal.getByText('Not allowed').first()).toBeVisible()
    await expect(pop.getByRole('list', { name: 'Rules' }).getByRole('listitem')).toHaveCount(0)
    await proposal.getByLabel('Try your own value').fill('ZZZZZ9999Z')
    await expect(proposal.getByRole('status')).toContainText('Allowed')
    await proposal.getByLabel('Try your own value').fill('zzzzz9999z')
    await expect(proposal.getByRole('status')).toContainText('Not allowed')
    await page.screenshot({ path: '../../docs/screens/studio-table/s3/after-describe.png' })
    await proposal.getByRole('button', { name: 'Use as rule' }).click()
    await expect(pop.getByRole('list', { name: 'Rules' }).getByRole('listitem')).toHaveCount(1)
    await expect(page.getByTestId('draft-banner')).toHaveCount(0) // still nothing saved
  })

  await test.step('Done saves it, and after publishing the live form follows the described rule', async () => {
    await pop.getByLabel(/^Message of /).fill('Use the format ABCDE1234F.')
    await pop.getByRole('button', { name: 'Done' }).click()
    await publishLive(page)
    const live = await freshSession(browser, page)
    await live.goto('/records/candidate/new')
    await live.getByLabel(/^Full name/).fill('Ai Check')
    await live.getByLabel(/^Email/).fill(`s3d-${run}@ai.test`)
    await live.getByLabel(/^Phone/).fill('+91 98450 77777')
    await live.getByLabel(/^Current title/).fill('abcde1234f')
    await live.getByRole('button', { name: 'Save candidate' }).click()
    await expect(live.getByText('Use the format ABCDE1234F.')).toBeVisible()
    await live.context().close()
  })
})

test('S3.6 form behaviour: the rule message shows when you leave the field, Save explains itself, and fixing the value clears it', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await signUpWithPack(page, `S3 Fm ${run}`, `s3e-${run}@studio.test`)
  await page.goto('/studio')
  await page.getByRole('button', { name: /^Add\. Validation of Current title/ }).click()
  const pop = page.getByRole('dialog', { name: 'Validation for Current title' })
  await pop.getByRole('button', { name: 'PAN', exact: true }).click()
  await pop.getByLabel('Message of PAN').fill('Enter a PAN like ABCDE1234F.')
  await pop.getByRole('button', { name: 'Done' }).click()
  await publishLive(page)

  const live = await freshSession(browser, page)
  await live.goto('/records/candidate/new')
  await live.getByLabel(/^Full name/).fill('Form Check')
  await live.getByLabel(/^Email/).fill(`s3e-${run}@form.test`)
  await live.getByLabel(/^Phone/).fill('+91 98450 88888')
  const title = live.getByLabel(/^Current title/)
  const save = live.getByRole('button', { name: 'Save candidate' })

  await test.step('Leaving the field shows the message under it, before any Save', async () => {
    await title.fill('abcde1234f')
    await expect(live.getByText('Enter a PAN like ABCDE1234F.')).toHaveCount(0) // still typing
    await live.getByLabel(/^Current employer/).focus() // leave the field
    await expect(live.getByText('Enter a PAN like ABCDE1234F.')).toBeVisible()
    await expect(title).toHaveAttribute('aria-invalid', 'true')
  })

  await test.step('Save cannot proceed and says why', async () => {
    await expect(save).toBeDisabled()
    await expect(live.getByText('Cannot save yet: fix Current title.')).toBeVisible()
    await live.setViewportSize({ width: 1280, height: 1500 })
    await live.screenshot({ path: '../../docs/screens/studio-table/s3/after-form-message.png' })
    await live.setViewportSize({ width: 1280, height: 720 })
  })

  await test.step('Fixing the value clears the message and Save works', async () => {
    await title.fill('ABCDE1234F')
    await expect(live.getByText('Enter a PAN like ABCDE1234F.')).toHaveCount(0)
    await expect(save).toBeEnabled()
    await live.getByLabel(/^Current employer/).focus()
    await expect(live.getByText('Cannot save yet')).toHaveCount(0)
    await save.click()
    await expect(live.getByText('ABCDE1234F').first()).toBeVisible()
  })
  await live.context().close()
})
