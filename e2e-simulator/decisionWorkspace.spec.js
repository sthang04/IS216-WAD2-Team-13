// BROWSER TEST PURPOSE: decision Workspace user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
// Purpose: fixture-backed decision Workspace browser regressions for simulator controls and state.
// Use Setup -> Actions -> Assert; real Vue/engine code runs, but these tests do not prove live Supabase integration.
import {test,expect} from '../e2e/helpers/browserUi.js'
async function boot(page){
 await page.route('https://**',r=>r.abort())
 await page.route('**/src/services/simulationDataService.js*',r=>r.fulfill({contentType:'application/javascript',body:"import {campusConnectFixture} from '/e2e-simulator/fixtures/campusConnect.js';export async function loadSimulationData(){const d=campusConnectFixture();d.facilities.push({id:3,name:'Fixture third room',is_active:true,capacity:60});d.facility_slots.push({...d.facility_slots[1],id:3,venue_name:'Fixture third room'});d.facility_bookings.push({...d.facility_bookings[1],id:3,facility_id:3});return d}"}))
 await page.goto('/e2e-simulator/harness.html')
 await page.getByLabel('Unavailable from (Singapore)',{exact:true}).selectOption('2026-11-02T10:00')
 await page.getByLabel('Unavailable until (Singapore)',{exact:true}).selectOption('2026-11-02T10:30')
 await page.getByRole('button',{name:'Run simulation (1)',exact:true}).click()
}
test('candidate inspection is separate from explicit preview selection and works on mobile',async({page})=>{
 await boot(page)
 await expect(page.getByText('Simulation complete',{exact:true})).toHaveCount(1)
 await expect(page.getByText('Simulation calculated.',{exact:true})).toHaveCount(0)
 await expect(page.locator('.simulator-metrics dd')).toHaveCount(4)
 const list=page.locator('[data-candidate-id]'),details=page.getByRole('region',{name:'Candidate details',exact:true})
 await list.nth(1).click()
 const name=await list.nth(1).locator('strong').first().textContent()
 await expect(details).toContainText(name)
 const workspace=page.getByRole('region',{name:'Persisted recovery workflow',exact:true})
 await expect(workspace).toHaveAttribute('data-selected-recovery','')
 await details.getByRole('button',{name:'Use this alternative',exact:true}).click()
 await expect(workspace).toHaveAttribute('data-selected-recovery','combined-selected')
 await expect(page.locator('#simulator-comparison')).toContainText(name)
 await expect(details).toContainText('No invitation sent')
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true)
 await details.scrollIntoViewIfNeeded();
})
test('facility choices replace incompatible venues and prepare the exact selected room',async({page})=>{
 await boot(page)
 await page.getByLabel('Disruption type',{exact:true}).selectOption('FACILITY_UNAVAILABLE')
 await page.getByRole('button',{name:'Run simulation (1)',exact:true}).click()
 const cards=page.locator('[data-facility-option]')
 await expect(page.locator('.facility-shortlist-option')).toHaveCount(2)
 const firstId=await cards.first().getAttribute('data-facility-option')
 await cards.first().getByRole('button',{name:'Use this alternative',exact:true}).click()
 await expect(page.locator('.facility-choice.chosen')).toHaveCount(1)
 await page.locator('.facility-shortlist-option').nth(1).click()
 const next=page.locator('[data-facility-option]').first()
 const nextId=await next.getAttribute('data-facility-option')
 const name=await next.getByRole('heading',{level:3}).textContent()
 await next.getByRole('button',{name:'Use this alternative',exact:true}).click()
 await expect(page.locator('.facility-choice.chosen')).toHaveCount(1)
 await page.locator('.facility-shortlist-option').first().click()
 await expect(page.locator('[data-facility-option="'+firstId+'"]').getByRole('button',{name:'Use this alternative',exact:true})).toHaveAttribute('aria-pressed','false')
 await page.locator('.facility-shortlist-option').nth(1).click()
 await expect(page.locator('#simulator-comparison')).toContainText(name)
 await expect(page.getByRole('region',{name:'Persisted recovery workflow',exact:true})).toContainText(name)
 await expect(page.locator('#combined-facility-option')).toHaveCount(0)
 await expect(page.locator('[data-facility-option="'+nextId+'"]')).not.toContainText('Other recovery issue:')
})

// Replaces the source-view regression: verify the visible choice survives a
// subsequent room edit, not just that clicking a ranked card changes its border.
test('ranked replacement remains selected when a different facility is combined',async({page})=>{
 await boot(page)
 await page.getByRole('button',{name:'Add disruption',exact:true}).click()
 await page.getByLabel('Disruption type',{exact:true}).nth(1).selectOption('FACILITY_UNAVAILABLE')
 await page.getByLabel('Unavailable from (Singapore)',{exact:true}).nth(1).selectOption('2026-11-02T10:00')
 await page.getByLabel('Unavailable until (Singapore)',{exact:true}).nth(1).selectOption('2026-11-02T10:30')
 await page.getByRole('button',{name:'Run simulation (2)',exact:true}).click()
 await page.locator('[data-candidate-id="2"]').click()
 await page.getByRole('region',{name:'Candidate details',exact:true}).getByRole('button',{name:'Use this alternative',exact:true}).click()
 await page.getByLabel('Number of ranked plans').selectOption('all')
 const ranked=page.locator('.recovery-choice[data-plan-id^="overall-"]').filter({hasText:'Fixture affected member \u2192 Fixture review standby'}).first()
 await ranked.getByRole('button',{name:'Select this plan',exact:true}).click()
 await expect(page.getByRole('region',{name:'Candidate details',exact:true})).toContainText('Fixture review standby')
 const other=page.locator('.facility-shortlist-option').filter({hasNotText:'Selected alternative'}).first()
 await other.click()
 await page.locator('[data-facility-option]').getByRole('button',{name:'Use this alternative',exact:true}).click()
 await expect(page.locator('.recovery-choice[data-plan-id="combined-selected"]')).toContainText('Fixture review standby')
 await expect(page.locator('#simulator-comparison')).toContainText('Fixture review standby')
 await expect(page.getByRole('region',{name:'Persisted recovery workflow',exact:true})).toHaveAttribute('data-selected-recovery','combined-selected')
})
