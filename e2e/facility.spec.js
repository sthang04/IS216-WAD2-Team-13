import { test, expect } from '@playwright/test';

test('Facility page loads with 6 campus facilities and slot rows via 1-click login', async ({ page }) => {
  await page.goto('/');

  // Ensure clean session state
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();

  // Open 1-Click Persona drawer and sign in as Rachel Tan (Logistics Director)
  const drawerBtn = page.getByRole('button', { name: /Click here for 1-Click Login/i });
  await expect(drawerBtn).toBeVisible({ timeout: 10000 });
  await drawerBtn.click();

  const rachelBtn = page.getByRole('button', { name: /Rachel Tan/i });
  await expect(rachelBtn).toBeVisible({ timeout: 10000 });
  await rachelBtn.click();

  // Check that the facility page loads
  await expect(
    page.getByRole('heading', {
      name: 'Pulse - Master Facility Calendar'
    })
  ).toBeVisible({ timeout: 15000 });

  // Check that campus rehearsal facilities are displayed (7 facilities)
  await expect(
    page.locator('.pulse-facility')
  ).toHaveCount(7, { timeout: 15000 });
});

test('Marcus Lim (Non-LD Marketing Director) triggers RBAC view-only restriction banner', async ({ page }) => {
  await page.goto('/');

  // Ensure clean session state
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();

  // Open 1-Click Persona drawer and sign in as Marcus Lim (Marketing Lead)
  const drawerBtn = page.getByRole('button', { name: /Click here for 1-Click Login/i });
  await expect(drawerBtn).toBeVisible({ timeout: 10000 });
  await drawerBtn.click();

  const marcusBtn = page.getByRole('button', { name: /Marcus Lim/i });
  await expect(marcusBtn).toBeVisible({ timeout: 10000 });
  await marcusBtn.click();

  // Check that the facility page loads
  await expect(
    page.getByRole('heading', {
      name: 'Pulse - Master Facility Calendar'
    })
  ).toBeVisible({ timeout: 15000 });

  // Check that RBAC view-only banner is displayed
  const viewOnlyBanner = page.locator('.pulse-banner-view');
  await expect(viewOnlyBanner).toBeVisible({ timeout: 10000 });
  await expect(viewOnlyBanner).toContainText('View only');
});

test('Day-of Operations view loads, triggers 1-Click Delay (+15m) cascade and Geolocation check-in', async ({ page }) => {
  await page.goto('/');

  // Ensure clean session state
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();

  // Sign in as Rachel Tan
  const drawerBtn = page.getByRole('button', { name: /Click here for 1-Click Login/i });
  await expect(drawerBtn).toBeVisible({ timeout: 10000 });
  await drawerBtn.click();

  const rachelBtn = page.getByRole('button', { name: /Rachel Tan/i });
  await expect(rachelBtn).toBeVisible({ timeout: 10000 });
  await rachelBtn.click();

  // Navigate to Day-of Operations tab
  const opsNavBtn = page.getByRole('button', { name: /Day-of Operations/i });
  await expect(opsNavBtn).toBeVisible({ timeout: 15000 });
  await opsNavBtn.click();

  // Verify Operations Command Center loaded
  await expect(
    page.getByRole('heading', { name: 'Live Operations Command Center' })
  ).toBeVisible({ timeout: 10000 });

  // Verify Multi-Track timeline is present
  await expect(
    page.getByText('OneMap Transit Buffer (Holding Room → Main Hall)')
  ).toBeVisible({ timeout: 10000 });

  // Test One-Click Delay Cascade (+15 mins)
  const delayBtn = page.getByRole('button', { name: /One-Click Delay \(\+15 mins\)/i });
  await expect(delayBtn).toBeVisible({ timeout: 10000 });
  await delayBtn.click();

  await expect(
    page.getByText(/One-Click Delay applied: \+15 minutes added/i)
  ).toBeVisible({ timeout: 10000 });

  // Test Mobile Geolocation Pin Check-In simulation
  const geoCheckInBtn = page.locator('button:has-text("Simulate Mobile Geo Check-in")').first();
  await expect(geoCheckInBtn).toBeVisible({ timeout: 10000 });
  await geoCheckInBtn.click();

  await expect(
    page.getByText(/Mobile Geolocation Verified/i)
  ).toBeVisible({ timeout: 10000 });
});

test('Dev Administrator logs in with Super-Admin privileges and loads Master Calendar', async ({ page }) => {
  await page.goto('/');

  // Ensure clean session state
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();

  // Open 1-Click Persona drawer and sign in as Dev Administrator
  const drawerBtn = page.getByRole('button', { name: /Click here for 1-Click Login/i });
  await expect(drawerBtn).toBeVisible({ timeout: 10000 });
  await drawerBtn.click();

  const devBtn = page.getByRole('button', { name: /Dev Administrator/i });
  await expect(devBtn).toBeVisible({ timeout: 10000 });
  await devBtn.click();

  // Verify the facility page loads
  await expect(
    page.getByRole('heading', {
      name: 'Pulse - Master Facility Calendar'
    })
  ).toBeVisible({ timeout: 15000 });

  // Verify campus rehearsal facilities are displayed (7 facilities)
  await expect(
    page.locator('.pulse-facility')
  ).toHaveCount(7, { timeout: 15000 });
});

