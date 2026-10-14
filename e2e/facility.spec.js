import { test, expect } from '@playwright/test';

test('Facility page loads with 6 slots', async ({ page }) => {
  await page.goto('http://localhost:5173/');

  // Check that the facility page loads
  await expect(
    page.getByRole('heading', {
      name: 'Pulse - Master Facility Calendar'
    })
  ).toBeVisible();

  // Check that exactly 6 facility slots are displayed
  await expect(
    page.locator('.row > .col-md-6.mb-3')
  ).toHaveCount(6);
});
