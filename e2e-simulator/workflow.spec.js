import {test,expect} from '@playwright/test'

// Real Chromium UI, mocked loader. No production data or live workflow calls.
test.beforeEach(async({page})=>{
 await page.route('**/src/services/simulationDataService.js*',route=>route.fulfill({contentType:'application/javascript',body:
  "import {getSimulationTestData} from '/src/data/simulationTestData.js'; export async function loadSimulationData(){window.__simLoads=(window.__simLoads||0)+1;return getSimulationTestData()}"}))
 await page.route('https://**',route=>route.abort())
 await page.goto('/e2e-simulator/harness.html')
 await expect(page.getByRole('heading',{name:'Choose Disruption Scenarios'})).toBeVisible()
})
test('combined cards, one Pip and real workflow safety gates',async({page})=>{
 await page.getByRole('button',{name:'Add disruption',exact:true}).click()
 await page.getByRole('button',{name:'Add disruption',exact:true}).click()
 await page.getByLabel('Disruption type',{exact:true}).nth(1).selectOption('FACILITY_UNAVAILABLE')
 await page.getByLabel('Disruption type',{exact:true}).nth(2).selectOption('SCHEDULE_DELAY')
 await page.getByRole('button',{name:'Run combined simulation (3)',exact:true}).click()
 await expect(page.getByText('Simulation calculated.',{exact:true})).toBeVisible()
 await expect(page.locator('.pip-container')).toHaveCount(1)
 await expect(page.getByRole('button',{name:'Prepare recovery requests',exact:true})).toBeDisabled()
 await expect(page.getByRole('button',{name:'Cancel Recovery Plan',exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Apply selected recovery',exact:true})).toBeDisabled()
 await expect(page.getByRole('button',{name:'Undo Recovery Plan',exact:true})).toHaveCount(0)
 await expect(page.getByText('Live updates are unavailable in this environment.',{exact:false})).toBeVisible()
 await expect(page.getByRole('link',{name:'Master Facility Calendar',exact:true})).toBeVisible()
})
test('invalid input clears results and reset reloads only the mock source',async({page})=>{
 await page.getByLabel('Disruption type',{exact:true}).selectOption('SCHEDULE_DELAY')
 await page.getByLabel('Delay (minutes)',{exact:true}).fill('0')
 await page.getByRole('button',{name:'Run combined simulation (1)',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('whole delay')
 await expect(page.getByText('Simulation calculated.',{exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Reset scenario',exact:true}).click()
 await page.getByRole('button',{name:'Refresh event data',exact:true}).click()
 await expect(page.getByLabel('Disruption type',{exact:true})).toHaveValue('MEMBER_UNAVAILABLE')
 await expect.poll(()=>page.evaluate(()=>window.__simLoads)).toBe(2)
 await expect(page.locator('.pip-container')).toHaveCount(1)
})
