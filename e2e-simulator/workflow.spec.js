// Purpose: fixture-backed workflow browser regressions for simulator controls and state.
// Use Setup -> Actions -> Assert; real Vue/engine code runs, but these tests do not prove live Supabase integration.
import {test,expect} from '@playwright/test'

// Real Chromium UI, mocked loader. No production data or live workflow calls.
test.beforeEach(async({page})=>{
 await page.route('**/src/services/simulationDataService.js*',route=>route.fulfill({contentType:'application/javascript',body:
  "import {getSimulationTestData} from '/e2e-simulator/fixtures/simulationTestData.js'; export async function loadSimulationData(){window.__simLoads=(window.__simLoads||0)+1;return getSimulationTestData()}"}))
 await page.route('https://**',route=>route.abort())
 await page.goto('/e2e-simulator/harness.html')
 await expect(page.getByRole('heading',{name:'Scenario Builder',exact:true})).toBeVisible()
})
test('combined cards, one Pip and real workflow safety gates',async({page})=>{
 await page.getByRole('button',{name:'Add disruption',exact:true}).click()
 await page.getByRole('button',{name:'Add disruption',exact:true}).click()
 await page.getByLabel('Disruption type',{exact:true}).nth(1).selectOption('FACILITY_UNAVAILABLE')
 await page.getByLabel('Disruption type',{exact:true}).nth(2).selectOption('SCHEDULE_DELAY')
 await page.getByLabel('Unavailable from (Singapore)',{exact:true}).first().selectOption('2027-10-16T18:00')
 await page.getByLabel('Unavailable until (Singapore)',{exact:true}).first().selectOption('2027-10-16T18:30')
 await page.getByRole('button',{name:'Run simulation (3)',exact:true}).click()
 await expect(page.getByText('Simulation complete',{exact:true})).toBeVisible()
 await expect(page.locator('.pip-container')).toHaveCount(1)
 // Actions: selecting a proposal reveals preparation, but cannot enable live writes.
 await page.getByRole('article',{name:'Recovery plan 1',exact:true}).getByRole('button',{name:'Select this plan',exact:true}).click()
 // Assert: every preparation action remains gated off.
 const prepare=page.getByRole('button',{name:'Prepare recovery requests',exact:true});
 expect(await prepare.count()).toBeGreaterThan(0)
 for(const button of await prepare.all())await expect(button).toBeDisabled()
 await expect(page.getByRole('button',{name:'Cancel Recovery Plan',exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Apply selected recovery',exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Undo Recovery Plan',exact:true})).toHaveCount(0)
 await expect(page.locator('.workflow-availability')).toBeVisible()
 await expect(page.locator('.workflow-availability')).toHaveCount(1)
 await expect(page.getByRole('button',{name:'Manage bookings',exact:true})).toBeVisible()
})
test('invalid input disables simulation and reset does not reload records',async({page})=>{
 await page.getByLabel('Disruption type',{exact:true}).selectOption('SCHEDULE_DELAY')
 await page.getByLabel('Delay (minutes)',{exact:true}).fill('0')
 await expect(page.getByRole('button',{name:'Run simulation (1)',exact:true})).toBeDisabled()
 await expect(page.getByRole('region',{name:'Start a simulation',exact:true})).toContainText('whole delay')
 await expect(page.getByText('Simulation complete',{exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Reset Simulation',exact:true}).click()
 expect(await page.evaluate(()=>window.__simLoads)).toBe(1)
 await page.getByRole('button',{name:'Refresh event data',exact:true}).click()
 await expect(page.getByLabel('Disruption type',{exact:true})).toHaveValue('MEMBER_UNAVAILABLE')
 await expect.poll(()=>page.evaluate(()=>window.__simLoads)).toBe(2)
 await expect(page.locator('.pip-container')).toHaveCount(0)
})
