// SUPPORT FILE PURPOSE: simulatorIntegrationJourneys.js supplies shared setup or controlled data for the browser workflows.
// Keep this support code: the Playwright tests depend on consistent setup and isolated state.
// Shared browser journeys registered by the desktop and mobile entry files.
import {test,expect} from './app.js'
import {eventSelect,runDelay,chooseDisruptionTime} from './journeys.js'

async function boot(page,app,options={}){
 await app.open('/events',{authenticated:true,simulation:true,...options})
 await expect(eventSelect(page).locator('option')).toHaveCount(2)
}
async function absence(page){
 await chooseDisruptionTime(page,'Unavailable from (Singapore)','2026-11-02T10:00')
 await chooseDisruptionTime(page,'Unavailable until (Singapore)','2026-11-02T10:30')
 await page.getByRole('button',{name:'Run simulation (1)',exact:true}).click()
 await expect(page.getByText('Simulation complete',{exact:true})).toBeVisible()
}

// Register per entry file; importing the module alone would cache away mobile tests.
export function registerSimulatorIntegrationJourneys(){
test('member and facility disruptions drive the actual graph and heatmap',async({page,app})=>{
 await boot(page,app)
 await page.getByRole('button',{name:'Add disruption',exact:true}).click()
 await page.getByLabel('Disruption type',{exact:true}).nth(1).selectOption('FACILITY_UNAVAILABLE')
 for(const field of ['Unavailable from (Singapore)','Unavailable until (Singapore)']){
  const value=field.startsWith('Unavailable from')?'2026-11-02T10:00':'2026-11-02T10:30'
  // Both disruption rows (member absence and facility closure) get the same interval.
  await chooseDisruptionTime(page,field,value,0)
  await chooseDisruptionTime(page,field,value,1)
 }
 await page.getByRole('button',{name:'Run simulation (2)',exact:true}).click()
 const graph=page.getByRole('region',{name:'Scrollable Event Village',exact:true})
 await expect(graph.locator('.sim-graph-node')).toHaveCount(8)
 await graph.getByRole('button',{name:'Fixture activity 1: Direct impact',exact:true}).click()
 await expect(page.getByRole('region',{name:'Event impact workspace',exact:true}).locator('.sim-inspection').filter({hasText:'Fixture activity 1'})).toContainText('Fixture activity 1')
 await page.locator('#impact-facilities > summary').click()
 await page.getByRole('button',{name:/Fixture Original Room:.*Simulated outage/}).first().click()
 await expect(page.locator('#impact-facilities .sim-inspection')).toContainText('Simulated outage')
})

test('timeline modes and playback inspect the same selected event',async({page,app})=>{
 await boot(page,app);await runDelay(page)
 await page.locator('#impact-timeline > summary').click()
 const timeline=page.locator('#impact-timeline')
 await timeline.getByRole('button',{name:'original',exact:true}).click()
 await expect(timeline.locator('.sim-time-bar.original')).toHaveCount(8)
 await expect(timeline.locator('.sim-time-bar.simulated')).toHaveCount(0)
 await timeline.getByRole('button',{name:'overlay',exact:true}).click()
 await expect(timeline.locator('.sim-time-bar')).toHaveCount(16)
 const slider=timeline.getByRole('slider',{name:'Timeline playback time',exact:true})
 await slider.fill('15')
 await timeline.getByRole('button',{name:'Play timeline',exact:true}).click()
 await expect.poll(async()=>Number(await slider.inputValue())).toBeGreaterThan(15)
 await timeline.getByRole('button',{name:'Pause timeline',exact:true}).click()
 await expect(timeline.getByRole('button',{name:'Play timeline',exact:true})).toBeVisible()
})

test('candidate selection and ranked switching synchronize comparison and workflow',async({page,app})=>{
 await boot(page,app);await absence(page)
 const candidate=page.locator('[data-candidate-id]').first()
 await candidate.click()
 await page.getByRole('button',{name:'Use this alternative',exact:true}).click()
 const panel=page.getByRole('region',{name:'Persisted recovery workflow',exact:true})
 await expect(panel).toHaveAttribute('data-selected-recovery','combined-selected')
 await expect(page.locator('#simulator-comparison')).toContainText('Custom combined recovery preview')
 const cards=page.locator('.recovery-choice')
 expect(await cards.count()).toBeGreaterThan(1)
 for(const card of [cards.nth(0),cards.nth(1)]){
  const id=await card.getAttribute('data-plan-id')
  await card.getByRole('button',{name:/Select this plan|Selected plan/}).click()
  await expect(panel).toHaveAttribute('data-selected-recovery',id)
  await expect(page.locator('#simulator-comparison')).toContainText((await card.getAttribute('data-plan-title')).trim())
 }
})

test('facility recommendation navigates to the real calendar with focus but no claim',async({page,app})=>{
 await boot(page,app)
 await page.getByLabel('Disruption type',{exact:true}).selectOption('FACILITY_UNAVAILABLE')
 await absence(page)
 await page.locator('.facility-verification > summary').click()
 const link=page.getByTestId('facility-alternative').getByRole('link',{name:'View / Request facility',exact:true}).first()
 page.once('dialog',dialog=>dialog.accept())
 await link.click()
 await expect(page).toHaveURL(/\/facilities\?/)
 await expect(page.getByTestId('simulator-calendar-focus')).toContainText('Fixture Alternative Room')
 await expect(page.getByRole('heading',{name:'Fixture Alternative Room',exact:true})).toBeVisible()
 expect(await page.evaluate(()=>window.__foundation.calls.filter(c=>c.name==='rpc_claim_booking'))).toEqual([])
})

test('reset clears hypothetical work but leaves saved history and production gates intact',async({page,app})=>{
 await boot(page,app,{savedHistory:true})
 if(!(await page.locator('#simulator-saved-recoveries').evaluate(e=>e.open)))await page.locator('#simulator-saved-recoveries > summary').click()
 await expect(page.getByRole('region',{name:'Saved Recoveries',exact:true})).toContainText('Fixture saved recovery 990001')
 await runDelay(page)
 await page.getByRole('button',{name:'Reset Simulation',exact:true}).click()
 await expect(page.getByRole('region',{name:'Start a simulation',exact:true})).toBeVisible()
 await expect(page.getByRole('region',{name:'Saved Recoveries',exact:true})).toContainText('Fixture saved recovery 990001')
 await expect(page.getByRole('button',{name:'Prepare recovery requests',exact:true})).toHaveCount(0)
 for(const name of ['Apply selected recovery','Undo Recovery Plan'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0)
 expect(await page.evaluate(()=>window.__foundation.calls.filter(c=>/rpc_simulator_(start|apply|undo|respond)/.test(c.name)))).toEqual([])
})

test('cancelling navigation preserves results; confirmed departure clears them on return',async({page,app})=>{
 await boot(page,app);await runDelay(page)
 page.once('dialog',dialog=>dialog.dismiss())
 await app.navigate('operations','Day-of Operations')
 await expect(page).toHaveURL(/\/events$/)
 await expect(page.getByText('Simulation complete',{exact:true})).toBeVisible()
 page.once('dialog',dialog=>dialog.accept())
 await app.navigate('operations','Day-of Operations')
 await expect(page).toHaveURL(/\/operations$/)
 await app.navigate('risk','Event Risk Planning')
 await expect(page.getByRole('region',{name:'Start a simulation',exact:true})).toBeVisible()
})

}
