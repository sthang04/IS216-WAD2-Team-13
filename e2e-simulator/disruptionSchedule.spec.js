// BROWSER TEST PURPOSE: disruption Schedule user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
// Purpose: fixture-backed disruption Schedule browser regressions for simulator controls and state.
// Use Setup -> Actions -> Assert; real Vue/engine code runs, but these tests do not prove live Supabase integration.
import {setRawInterval} from './fixtures/disruptionInputs.js'
import {test,expect} from '../e2e/helpers/browserUi.js'
import {campusConnectMultiEventFixture} from './fixtures/campusConnect.js'
import {prepareDisruptionCards} from '../src/services/combinedSimulationService.js'
import {runCompleteSimulation} from '../src/services/simulationService.js'
import {eventDates} from '../src/services/disruptionScheduleService.js'

// Exercise Singapore inputs from a browser in a different timezone.
test.use({timezoneId:'America/Los_Angeles'})

const member=(start,end,id='m')=>({id,type:'MEMBER_UNAVAILABLE',memberId:1,start,end})
const first='2026-11-02T10:00', last='2026-11-02T14:00'
async function boot(page,change=()=>{}) {
 const data=campusConnectMultiEventFixture();change(data)
 // All network traffic is local; no auth, production reads or mutations.
 await page.route('https://**',r=>r.abort())
 await page.route('**/src/services/simulationDataService.js*',r=>r.fulfill({contentType:'application/javascript',body:'export async function loadSimulationData(){return '+JSON.stringify(data)+'}'}))
 await page.goto('/e2e-simulator/harness.html')
 return data
}
const start=page=>page.getByLabel('Unavailable from (Singapore)',{exact:true})
const end=page=>page.getByLabel('Unavailable until (Singapore)',{exact:true})
const run=page=>page.getByRole('button',{name:/Run simulation/})

test('single day initializes exact bounds, includes earliest/latest and fits viewport',async({page})=>{
 await boot(page)
 await expect(start(page)).toHaveValue(first);await expect(end(page)).toHaveValue(last)
 await expect(start(page).locator('option').filter({hasText:'10:00 AM'})).toHaveCount(1)
 await expect(end(page).locator('option:checked')).toHaveText('2:00 PM')
 await expect(start(page).locator('option[value="2026-11-02T14:00"]')).toBeDisabled()
 await expect(end(page).locator('option[value="2026-11-02T10:00"]')).toBeDisabled()
 await expect(start(page).locator('option[value="2026-11-02T09:59"]')).toHaveCount(0)
 await expect(page.getByLabel('Start date for disruption 1')).toContainText('02 Nov 2026')
 await expect(page.getByTestId('event-schedule')).toContainText('2026')
 await expect(run(page)).toBeEnabled()
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
})
for(const [name,a,b] of [
 ['before event','2026-11-01T10:00',last],['after event',first,'2026-11-03T14:00'],
 ['early hours','2026-11-02T09:59',last],['late hours',first,'2026-11-02T14:01'],
 ['reversed',last,first],['equal',first,first]
]) test('rejects '+name+' in restored/programmatic state',async({page})=>{
 await boot(page);await setRawInterval(page,{start:a,end:b})
 await expect(run(page)).toBeDisabled()
 await expect(page.getByRole('status').filter({hasText:/within the selected event|end must be after/})).toBeVisible()
})
for(const [name,finish,dates] of [
 ['cross midnight','2026-11-03T02:00:00+08:00',2],
 ['multi day','2026-11-05T18:00:00+08:00',4]
]) test(name+' offers only event dates and requests a valid time when needed',async({page})=>{
 await boot(page,d=>{d.events[0].ends_at=finish})
 const picker=page.getByLabel('Start date for disruption 1')
 await expect(picker.locator('option:not([value=""])')).toHaveCount(dates)
 await picker.selectOption(finish.slice(0,10))
 await expect(start(page)).toHaveValue(name==='cross midnight'?'':finish.slice(0,10)+'T10:00')
 if(name==='cross midnight') await expect(page.getByRole('status').filter({hasText:'Date changed.'})).toBeVisible()
 if(name==='cross midnight') await expect(run(page)).toBeDisabled() // Equal endpoints are never an interval.
 else await expect(run(page)).toBeEnabled()
 await start(page).selectOption(finish.slice(0,10)+'T00:00')
 await expect(run(page)).toBeEnabled()
})
test('switching events resets all cards and invalidates results',async({page})=>{
 await boot(page);await run(page).click()
 await page.getByRole('button',{name:'Add disruption',exact:true}).click()
 page.once('dialog',d=>d.accept());await page.locator('#simulation-event').selectOption('990003')
 await expect(start(page)).toHaveCount(1);await expect(start(page)).toHaveValue('2026-11-03T10:00')
 await expect(page.getByRole('region',{name:'Event impact workspace',exact:true})).toHaveCount(0)
})
test('every card validates; facility whole-event outage preserves combined scenarios',async({page})=>{
 await boot(page);await page.getByRole('button',{name:'Add disruption',exact:true}).click()
 await page.locator('#D2-type').selectOption('FACILITY_UNAVAILABLE')
 await page.getByText('More controls',{exact:true}).click()
 await page.locator('#D2-window').selectOption('event')
 await expect(page.locator('#D2-start')).toHaveValue(first)
 await expect(page.locator('#D2-end')).toHaveValue(last)
 await expect(run(page)).toBeEnabled();await run(page).click()
 await expect(page.getByRole('region',{name:'Event impact workspace',exact:true})).toBeVisible()
 await page.locator('#D2-window').selectOption('custom');await setRawInterval(page,{end:'2026-11-03T14:00'},1)
 await expect(run(page)).toBeDisabled()
})
for(const invalid of [null,'bad','2026-11-02T09:00:00+08:00']) test('missing/invalid schedule '+invalid,async({page})=>{
 await boot(page,d=>{d.events[0].ends_at=invalid})
 await expect(run(page)).toBeDisabled();await expect(start(page)).toBeDisabled()
 await expect(page.getByText('This event has a missing or invalid schedule. Verify its start and end before simulating.',{exact:true}).first()).toBeVisible()
})
test('activity delay uses original segment; delayed finish may exceed event',async({page})=>{
 const data=await boot(page)
 await page.getByLabel('Disruption type',{exact:true}).selectOption('SCHEDULE_DELAY')
 await page.getByLabel('Delayed activity',{exact:true}).selectOption('8')
 await page.getByLabel('Delay (minutes)',{exact:true}).fill('120')
 await expect(run(page)).toBeEnabled();await run(page).click()
 const cards=[{id:'d',type:'SCHEDULE_DELAY',segmentId:8,delayMinutes:120}]
 const result=runCompleteSimulation(data,990001,prepareDisruptionCards(data,990001,cards))
 expect(Date.parse(result.simulatedSegments.find(s=>s.id===8).ends_at)).toBeGreaterThan(Date.parse(data.events[0].ends_at))
})
// Retain this focused function check, but exclude it from browser E2E selection.
test('central validation rejects restored/programmatic ranges, stale events and invalid activities [non-browser]',()=>{
 const data=campusConnectMultiEventFixture()
 const prepare=cards=>prepareDisruptionCards(data,990001,cards)
 expect(prepare([member(first,last)])[0].start).toBe('2026-11-02T02:00:00.000Z')
 expect(()=>prepare([member('2026-11-02T09:59',last)])).toThrow(/within/)
 expect(()=>prepare([member(first,'2026-11-02T14:01')])).toThrow(/within/)
 expect(()=>prepare([member(first,last),member(first,'2026-11-03T14:00','m2')])).toThrow(/within/)
 expect(()=>prepare([member('2026-02-30T10:00',last)])).toThrow(/calendar/)
 expect(()=>prepareDisruptionCards(data,990003,[member(first,last)])).toThrow(/within/)
 for(const bounds of [[null,null],['bad',last],[last,first]]){
  data.event_segments[0].starts_at=bounds[0];data.event_segments[0].ends_at=bounds[1]
  expect(()=>prepare([{id:'d',type:'SCHEDULE_DELAY',segmentId:1,delayMinutes:15}])).toThrow(/activity/)
 }
 const event={starts_at:'2026-11-02T23:00:00+08:00',ends_at:'2026-11-04T01:00:00+08:00'}
 expect(eventDates(event)).toEqual(['2026-11-02','2026-11-03','2026-11-04'])
})

test('sub-minute schedule defaults retain exact event boundaries',async({page})=>{
 const data=await boot(page,d=>{d.events[0].starts_at='2026-11-02T10:00:30.123+08:00';d.events[0].ends_at='2026-11-02T14:00:45+08:00'})
 await expect(start(page)).toHaveValue('2026-11-02T10:00:30.123')
 await expect(end(page)).toHaveValue('2026-11-02T14:00:45')
 await expect(run(page)).toBeEnabled()
 const normalized=prepareDisruptionCards(data,990001,[member('2026-11-02T10:00:30.123','2026-11-02T14:00:45')])
 expect(normalized[0].start).toBe('2026-11-02T02:00:30.123Z')
})

test('From/Until have calendar date and AM/PM time side by side',async({page})=>{
 await boot(page)
 const picker=page.locator('.disruption-interval')
 await expect(picker.locator('legend')).toHaveText(['From','Until'])
 await expect(picker.locator('.calendar-control svg')).toHaveCount(2)
 for(const section of await picker.locator('fieldset').all()){
  const selects=section.locator('select')
  const date=await selects.nth(0).boundingBox(), time=await selects.nth(1).boundingBox()
  expect(Math.abs(date.y-time.y)).toBeLessThan(2)
  expect(time.x).toBeGreaterThanOrEqual(date.x+date.width)
  expect(date.height).toBeGreaterThanOrEqual(44)
 }
 await expect(picker.locator('input[type="datetime-local"]')).toHaveCount(0)
})
test('keyboard selects times and disabled Until choices cannot reverse the interval',async({page})=>{
 await boot(page)
 const date=page.getByLabel('Start date for disruption 1')
 await date.focus();await page.keyboard.press('Tab');await expect(start(page)).toBeFocused()
 await page.keyboard.press('ArrowDown');await expect(start(page)).toHaveValue('2026-11-02T10:01')
 await expect(end(page).locator('option[value="2026-11-02T10:01"]')).toBeDisabled()
 await expect(run(page)).toBeEnabled()
})
test('valid precise times survive a date change without rounding',async({page})=>{
 await boot(page,d=>{d.events[0].starts_at='2026-11-02T10:00:30.123+08:00';d.events[0].ends_at='2026-11-04T14:00:45+08:00'})
 await page.getByLabel('Start date for disruption 1').selectOption('2026-11-03')
 await expect(start(page)).toHaveValue('2026-11-03T10:00:30.123')
 await expect(start(page).locator('option:checked')).toHaveText('10:00:30.123 AM')
 await expect(run(page)).toBeEnabled()
})
test('touch can reach both date and time dropdowns',async({page},testInfo)=>{
 test.skip(!testInfo.project.use.hasTouch,'Touch project only')
 await boot(page)
 await page.getByLabel('Start date for disruption 1').tap()
 await page.keyboard.press('Escape')
 await start(page).tap()
 await page.keyboard.press('Escape')
 await start(page).selectOption('2026-11-02T10:15')
 await end(page).tap();await page.keyboard.press('Escape')
 await end(page).selectOption('2026-11-02T10:30')
 await expect(run(page)).toBeEnabled()
 await run(page).tap()
 await expect(page.getByRole('region',{name:'Event impact workspace',exact:true})).toBeVisible()
})
