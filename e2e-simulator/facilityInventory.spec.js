import {test,expect} from '@playwright/test'
// Isolated inventory fixture, NOT a live assertion about Event 900001 or Sports Hall.
test('active unbooked Sports Hall renders as a ranked tentative replacement in the real simulator',async({page})=>{
 await page.route('https://**',route=>route.abort())
 await page.route('**/src/services/simulationDataService.js*',route=>route.fulfill({contentType:'application/javascript',body:
  "import {campusConnectFixture} from '/e2e-simulator/fixtures/campusConnect.js';export async function loadSimulationData(){const d=campusConnectFixture();d.facilities[0].facility_type='Auditorium';d.facilities[1]={...d.facilities[1],name:'Sports Hall',facility_type:'Sports',equipment:['Sound']};d.facility_bookings=d.facility_bookings.slice(0,1);d.facility_slots=d.facility_slots.slice(0,1);return d}"}))
 await page.goto('/e2e-simulator/harness.html')
 await page.getByLabel('Disruption type',{exact:true}).selectOption('FACILITY_UNAVAILABLE')
 await page.getByLabel('Unavailable from (Singapore)',{exact:true}).fill('2026-11-02T10:00')
 await page.getByLabel('Unavailable until (Singapore)',{exact:true}).fill('2026-11-02T10:30')
 await page.getByRole('button',{name:'Run combined simulation (1)',exact:true}).click()
 const card=page.getByTestId('facility-alternative')
 await expect(card).toHaveCount(1)
 await expect(card).toContainText('Sports Hall')
 await expect(card).toContainText('booking approval required')
 await expect(card).toContainText('club eligibility')
 await expect(card.getByRole('link',{name:'View / Request this facility',exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Apply selected recovery',exact:true})).toBeDisabled()
})
