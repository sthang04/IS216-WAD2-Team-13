import { test, expect } from './fixtures/app.js'

// setup, actions, assertions; real UI and automatic waiting.
// Browser coverage only. Server scheduling and Telegram delivery require the
// deployed migration, Edge Function, minute cron, and a linked test crew chat.
test('crew can create an event and see the automatic reminder policy', async ({ page, app }) => {
  // Setup
  await app.open('/operations', { authenticated: true, opsSample: true })
  await expect(page.getByRole('heading', { name: 'Day-of Operations', exact: true })).toBeVisible()

  // Actions
  await page.getByRole('button', { name: '+ New event', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/^Event name/).fill('Crew reminder rehearsal')
  await dialog.getByLabel(/^Date/).fill('2026-11-20')
  await dialog.getByLabel(/^Starts/).fill('15:00')
  await dialog.getByLabel(/^Ends/).fill('16:00')
  await dialog.getByRole('button', { name: 'Select all', exact: true }).click()
  await dialog.getByRole('button', { name: 'Create event', exact: true }).click()

  // Assertions
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Event', exact: true })).toContainText('Crew reminder rehearsal')
  await expect(page.getByText('Saved events and tasks automatically remind assigned crew on Telegram 15 minutes before they start. Sample plans do not send reminders.', { exact: true })).toBeVisible()
})
