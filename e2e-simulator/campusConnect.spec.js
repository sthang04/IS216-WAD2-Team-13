import {test,expect} from '@playwright/test'
// Every scenario uses synthetic data with ID 990001, never live Event 900001.
// No production fallback/test mode is added. External requests are blocked.
for(const scenario of ['verified','manual','none','no-facility','facility-manual','delay','unlinked','blocked']){
 test('isolated eight-activity demonstration: '+scenario,async({page})=>{
  const mode=['delay','facility-manual'].includes(scenario)?'manual':scenario
  await page.route('**/src/services/simulationDataService.js*',route=>route.fulfill({
   contentType:'application/javascript',body:"import {campusConnectFixture} from '/e2e-simulator/fixtures/campusConnect.js'; export async function loadSimulationData(){return campusConnectFixture('"+mode+"')}"}))
  await page.route('https://**',route=>route.abort())
  await page.goto('/e2e-simulator/harness.html')
  await expect(page.getByLabel('Event',{exact:true})).toHaveValue('990001')
  await expect(page.getByLabel('Event',{exact:true}).locator('option:checked')).toContainText('ISOLATED')
  if(scenario==='delay'){
   await page.getByLabel('Disruption type',{exact:true}).selectOption('SCHEDULE_DELAY')
   await expect(page.getByLabel('Delayed activity',{exact:true}).locator('option')).toHaveCount(8)
   await page.getByLabel('Delay (minutes)',{exact:true}).fill('30')
  }else{
   if(['no-facility','facility-manual','unlinked','blocked'].includes(scenario))await page.getByLabel('Disruption type',{exact:true}).selectOption('FACILITY_UNAVAILABLE')
   await page.getByLabel('Unavailable from (Singapore)',{exact:true}).fill('2026-11-02T10:00')
   await page.getByLabel('Unavailable until (Singapore)',{exact:true}).fill('2026-11-02T10:30')
  }
  await page.getByRole('button',{name:'Run combined simulation (1)',exact:true}).click()
  if(scenario==='unlinked'){
   await page.getByText('Facility Setup / Booking Readiness',{exact:true}).click()
   await expect(page.getByText(/No accessible linked facility bookings/)).toBeVisible()
   await expect(page.getByRole('link',{name:'Open Facility Calendar for selected activity',exact:true})).toHaveAttribute('href','/facilities?week=2026-11-02')
   await expect(page.getByLabel('Activity for calendar',{exact:true}).locator('option')).toHaveCount(8)
   await expect(page.getByText(/Original booking linking is unavailable/)).toBeVisible()
   await expect(page.getByLabel('Unavailable facility',{exact:true}).locator('option')).toHaveCount(0)
   await expect(page.getByRole('alert').first()).toContainText('Select a facility linked to this event')
   return
  }
  await expect(page.getByText('Simulation calculated.',{exact:true})).toBeVisible()
  if(scenario==='verified')await expect(page.getByText('Exact-role matches',{exact:true})).toBeVisible()
  if(scenario==='manual'){await expect(page.getByText('Needs Manual Review',{exact:true})).toBeVisible();await expect(page.getByText(/Club roster loaded. Timetable coverage is incomplete/)).toBeVisible()}
  if(scenario==='none')await expect(page.getByText(/No eligible replacement was found among/)).toBeVisible()
  if(['facility-manual','no-facility','blocked'].includes(scenario))await expect(page.getByText(/Club roster loaded. Timetable coverage is incomplete/)).toHaveCount(0)
  if(scenario==='facility-manual'){
   await page.getByText('Facility Setup / Booking Readiness',{exact:true}).click()
   await expect(page.getByText('Requires owner approval / booking verification',{exact:true})).toBeVisible()
   await page.getByText('Inspect linked records for Fixture activity 1 (1)',{exact:true}).click()
   await expect(page.getByText(/Recorded ownership, approval, time and minimum-capacity checks passed/)).toBeVisible()
  }
  if(scenario==='blocked'){
   await expect(page.getByTestId('facility-alternative')).toHaveCount(0)
   await expect(page.getByText(/No eligible alternative facility in accessible records/)).toBeVisible()
   await page.getByText('Alternatives excluded by existing checks (1)',{exact:true}).click()
   await expect(page.getByText(/Fixture Alternative Room: .*confirmed reservation/)).toBeVisible()
  }
  if(scenario==='no-facility')await expect(page.getByText(/No confirmed alternative in accessible records/)).toBeVisible()
  await expect(page.getByRole('button',{name:'Prepare recovery requests',exact:true})).toBeDisabled()
  await expect(page.getByRole('button',{name:'Apply selected recovery',exact:true})).toBeDisabled()
  await expect(page.locator('.pip-container')).toHaveCount(1)
 })
}

test('facility recommendations follow two selected events and actual linked booking IDs',async({page})=>{
 await page.route('**/src/services/simulationDataService.js*',route=>route.fulfill({contentType:'application/javascript',
  body:"import {campusConnectMultiEventFixture} from '/e2e-simulator/fixtures/campusConnect.js'; export async function loadSimulationData(){return campusConnectMultiEventFixture()}"}))
 await page.route('https://**',route=>route.abort())
 await page.goto('/e2e-simulator/harness.html')
 for(const [eventId,bookingId,date,title] of [['990001','1','2026-11-02','Fixture activity 1'],['990003','4','2026-11-03','Fixture activity 1']]){
  await page.getByLabel('Event',{exact:true}).selectOption(eventId)
  await page.getByLabel('Disruption type',{exact:true}).selectOption('FACILITY_UNAVAILABLE')
  await expect(page.getByLabel('Unavailable facility',{exact:true})).toHaveValue(bookingId)
  await expect(page.getByLabel('Unavailable facility',{exact:true}).locator('option:checked')).toContainText('Booking '+bookingId)
  await page.getByLabel('Unavailable from (Singapore)',{exact:true}).fill(date+'T10:00')
  await page.getByLabel('Unavailable until (Singapore)',{exact:true}).fill(date+'T10:30')
  await page.getByRole('button',{name:'Run combined simulation (1)',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Ranked facility and schedule recommendations',exact:true})).toBeVisible()
  const card=page.getByTestId('facility-alternative')
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('#1 Alternative facility:')
  await expect(card).toContainText('Fixture Alternative Room')
  await expect(card).toContainText('Existing recovery score:')
  await expect(card).toContainText('Capacity: 50')
  await expect(card).toContainText('Booking verification required')
  const href=await card.getByRole('link',{name:'View / Request this facility',exact:true}).getAttribute('href')
  const request=new URL(href,'http://localhost')
  expect(request.searchParams.get('simFacilityId')).toBe('2')
  expect(request.searchParams.get('simStart')).toBe(new Date(date+'T10:00:00+08:00').toISOString())
  expect(request.searchParams.get('simEnd')).toBe(new Date(date+'T10:30:00+08:00').toISOString())
  await expect(page.getByTestId('facility-recovery').getByRole('heading',{name:title,exact:true})).toBeVisible()
  await expect(page.locator('.pip-container')).toHaveCount(1)
  await expect(page.getByRole('button',{name:'Apply selected recovery',exact:true})).toBeDisabled()
 }
})
