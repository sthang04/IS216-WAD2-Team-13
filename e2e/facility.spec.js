import { test, expect } from '@playwright/test';

test('Facility page loads with 6 slots', async ({ page }) => {
  await page.goto('/');

  // Ensure clean session state
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();

  // The app opens on the login page, so explore as a guest (view only)
  const guestBtn = page.getByRole('button', { name: /explore live facility calendar as guest/i });
  await expect(guestBtn).toBeVisible({ timeout: 10000 });
  await guestBtn.click();

  // Check that the facility page loads
  await expect(
    page.getByRole('heading', {
      name: 'Pulse - Master Facility Calendar'
    })
  ).toBeVisible({ timeout: 15000 });

  // Check that exactly 6 facility slots are displayed
  await expect(
    page.locator('.row > .col-md-6.mb-3')
  ).toHaveCount(6, { timeout: 15000 });
});
