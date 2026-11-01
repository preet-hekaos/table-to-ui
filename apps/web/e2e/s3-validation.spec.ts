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
