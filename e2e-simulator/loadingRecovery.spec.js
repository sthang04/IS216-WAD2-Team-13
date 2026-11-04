import { test, expect } from '@playwright/test'

// Browser E2E through the real Vue view and engine. All records are synthetic;
// replacing the loader and client prevents any live Supabase/Telegram effects.
for (const initial of ['error', 'empty']) {
  test('should recover from ' + initial + ' event data after an explicit refresh', async ({ page }) => {
    // Setup: fail the first read; hold the retry until loading controls are checked.
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('https://**', route => route.abort())
    await page.route('**/src/supabase.js*', route => route.fulfill({
      contentType: 'application/javascript',
      body: "export const isSupabaseConfigured=()=>true; export const supabase={auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}},async rpc(name){return {data:name==='rpc_simulator_workflow_capabilities'?{contract_version:4,application_enabled:false,invitations_enabled:false}:{plans:[],invitations:[],audit:[]}}}}"
    }))
    await page.route('**/src/services/simulationDataService.js*', route => route.fulfill({
      contentType: 'application/javascript',
      body: "import {campusConnectFixture} from '/e2e-simulator/fixtures/campusConnect.js';let calls=0;export async function loadSimulationData(){if(++calls===1){" + (initial === 'error' ? "throw Error('Isolated event read failed')" : "return {events:[]}") + ";}await new Promise(resolve=>window.__releaseEventRead=resolve);return campusConnectFixture()}"
    }))
    await page.goto('/e2e-simulator/harness.html')
    await expect(page.getByRole('alert')).toContainText(initial === 'error' ? 'Isolated event read failed' : 'No accessible events found in Supabase.')
    await expect(page.getByText('Simulation complete', { exact: true })).toHaveCount(0)

    // Actions: retry using the normal UI, then release the controlled read.
    const refresh = page.getByRole('button', { name: 'Refresh event data', exact: true })
    await refresh.click()
    await expect(refresh).toBeDisabled()
    await expect.poll(() => page.evaluate(() => typeof window.__releaseEventRead)).toBe('function')
    await page.evaluate(() => window.__releaseEventRead())
    await expect(page.getByLabel('Event', { exact: true })).toHaveValue('990001')
    await page.getByLabel('Unavailable from (Singapore)', { exact: true }).selectOption('2026-11-02T10:00')
    await page.getByLabel('Unavailable until (Singapore)', { exact: true }).selectOption('2026-11-02T10:30')
    await page.getByRole('button', { name: 'Run simulation (1)', exact: true }).click()

    // Assert: successful retry produces calculated impacts and clears the read error.
    await expect(page.getByTestId('impact-total')).toHaveText('8')
    await expect(page.getByTestId('impact-direct')).toHaveText('1')
    await expect(refresh).toBeEnabled()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(errors).toEqual([])
  })
}
