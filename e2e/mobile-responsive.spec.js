import { test, expect } from '@playwright/test';

// Test across standard mobile viewports (iPhone SE 375px and iPhone 14 390px)
const VIEWPORTS = [
  { name: 'iPhone SE (375px)', width: 375, height: 667 },
  { name: 'iPhone 14 (390px)', width: 390, height: 844 },
];

for (const vp of VIEWPORTS) {
  test.describe(`Mobile Responsiveness - ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('verifies no horizontal overflow on landing and authenticated pages', async ({ page }) => {
      // 1. Landing View
      await page.goto('/');
      await page.waitForTimeout(500);

      const checkNoScroll = async (viewName) => {
        const overflowData = await page.evaluate(() => {
          const docW = document.documentElement.clientWidth;
          const scrollW = document.documentElement.scrollWidth;
          const bodyScrollW = document.body.scrollWidth;
          return {
            docW,
            scrollW,
            bodyScrollW,
            hasOverflow: scrollW > docW || bodyScrollW > docW
          };
        });
        expect(overflowData.hasOverflow, `${viewName} should not scroll horizontally`).toBe(false);
      };

      await checkNoScroll('Landing Page (Initial)');

      // Open 1-Click Drawer
      const drawer = page.locator('button:has-text("1-Click")').first();
      await drawer.click();
      await page.waitForTimeout(300);
      await checkNoScroll('Landing Page (Drawer Open)');

      // Log in as Rachel Tan
      await page.locator('button:has-text("Rachel Tan")').first().click();
      await page.waitForTimeout(1000);

      // Authenticated Routes
      const testRoutes = [
        { path: '/facilities', label: 'Master Facilities' },
        { path: '/facilities/my-club', label: 'My Club' },
        { path: '/facilities/waitlist', label: 'Waitlist' },
        { path: '/personal-schedule', label: 'Personal Schedule' },
        { path: '/availability', label: 'Availability Heatmap' },
        { path: '/operations', label: 'Day-of Operations' },
        { path: '/events', label: 'Event Risk Sandbox' },
      ];

      for (const route of testRoutes) {
        await page.goto(route.path);
        await page.waitForTimeout(600);
        await checkNoScroll(route.label);
      }
    });
  });
}
