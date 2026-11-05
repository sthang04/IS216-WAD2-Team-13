// BROWSER TEST PURPOSE: events user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
import {test,expect} from './fixtures/app.js'
import {eventSelect,runDelay,chooseDisruptionTime} from './fixtures/journeys.js'

test('real app navigation loads authorized events and selected event activities',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,simulation:true})
 await app.navigate('risk','Event Risk Planning')
 await expect(page).toHaveURL(/\/events$/)
 await expect(page.getByRole('heading',{name:'Event Control Room',exact:true})).toBeVisible()
 await expect(eventSelect(page).locator('option')).toHaveText(['Fixture Alpha Showcase','Fixture Beta Workshop'])
 await eventSelect(page).selectOption('990003')
 await page.getByLabel('Disruption type',{exact:true}).selectOption('SCHEDULE_DELAY')
 await expect(page.getByLabel('Delayed activity',{exact:true}).locator('option')).toHaveCount(8)
 await expect(page.getByLabel('Delayed activity',{exact:true})).toContainText('Fixture Beta activity 1')
 await expect(page.getByLabel('Delayed activity',{exact:true})).not.toContainText('Fixture activity 1')
})

test('pending event query disables simulation and resolves to actual options',async({page,app})=>{
 await app.open('/events',{authenticated:true,simulation:true,holdTable:'events'})
 // The loading message shows in both the event picker and the page body; either proves the pending state.
 await expect(page.getByText('Loading your events…',{exact:true}).first()).toBeVisible()
 await expect(eventSelect(page)).toBeDisabled()
 await expect(page.getByRole('button',{name:'Refresh event data',exact:true})).toBeDisabled()
 await page.evaluate(()=>{window.__foundation.configure({holdTable:null});window.__foundation.release()})
 await expect(eventSelect(page)).toBeEnabled()
 await expect(eventSelect(page).locator('option')).toHaveCount(2)
 await expect(page.getByText(/Loading Supabase event data/)).toHaveCount(0)
})

for(const [config,message]of [
 [{emptyEvents:true},'No events are accessible to this account'],
  [{tableError:'events'},'Could not load events: Fixture read denied'],
]){
 test('live loader exposes '+Object.keys(config)[0]+' without fake fallback',async({page,app})=>{
  await app.open('/events',{authenticated:true,simulation:true,...config})
  await expect(page.getByRole('alert')).toContainText(message)
  await expect(eventSelect(page).locator('option')).toHaveCount(0)
  await expect(page.getByRole('button',{name:/^Run (combined )?simulation/})).toBeDisabled()
  await page.evaluate(()=>window.__foundation.configure({emptyEvents:false,emptyActivities:false,tableError:null}))
  await page.getByRole('button',{name:'Refresh event data',exact:true}).click()
  await expect(eventSelect(page).locator('option')).toHaveCount(2)
  await expect(page.getByRole('alert')).toHaveCount(0)
 })
}

// Saved events may legitimately have no activities. Preserve their identity while
// proving the UI does not invent a movable activity or enable a delay with no target.
test('an event without activities remains selectable but has no fabricated delay target',async({page,app})=>{
 await app.open('/events',{authenticated:true,simulation:true,emptyActivities:true})
 await expect(eventSelect(page).locator('option')).toHaveCount(2)
 await page.getByLabel('Disruption type',{exact:true}).selectOption('SCHEDULE_DELAY')
 await expect(page.getByLabel('Delayed activity',{exact:true}).locator('option')).toHaveCount(0)
 await expect(page.getByRole('button',{name:/^Run (combined )?simulation/})).toBeDisabled()
})

test('anonymous events URL returns to live simulator after form login',async({page,app})=>{
 await app.open('/events',{simulation:true})
 await expect(page).toHaveURL(/redirect=/)
 await app.login()
 await expect(page).toHaveURL(/\/events$/)
 await expect(eventSelect(page).locator('option')).toHaveCount(2)
})

test('OSL account is redirected away from events',async({page,app})=>{
 await app.open('/events',{authenticated:true,role:'admin',simulation:true})
 await expect(page).toHaveURL(/\/facilities$/)
 await expect(page.getByRole('heading',{name:'Event Control Room',exact:true})).not.toBeVisible()
})

// Guest entry was removed; verify the supported signed-out boundary instead.
test('signed-out access to /events requests login without exposing protected controls',async({page,app})=>{
 await app.open('/events')
 await expect(page).toHaveURL(/redirect=/)
 await expect(page.locator('input[name="smu_user_password"]')).toBeVisible()
 await expect(page.getByRole('button',{name:/explore live facility calendar as guest/i})).toHaveCount(0)
 await page.reload()
 await expect(page.locator('input[name="smu_user_password"]')).toBeVisible()
 await expect(page.getByRole('button',{name:'Submit claim',exact:true})).toHaveCount(0)
})

test('event switching confirms discard and clears prior simulation and recovery',async({page,app})=>{
 await app.open('/events',{authenticated:true,simulation:true})
 await expect(eventSelect(page)).toHaveValue('990001')
 await runDelay(page)
 await expect(page.getByRole('region',{name:'Event impact workspace',exact:true})).toContainText('Fixture activity 1')
 page.once('dialog',dialog=>dialog.dismiss())
 await eventSelect(page).selectOption('990003')
 await expect(eventSelect(page)).toHaveValue('990001')
 await expect(page.getByText('Simulation complete',{exact:true})).toBeVisible()
 page.once('dialog',dialog=>dialog.accept())
 await eventSelect(page).selectOption('990003')
 await expect(page.getByRole('region',{name:'Start a simulation',exact:true})).toBeVisible()
 await expect(page.getByRole('region',{name:'Event impact workspace',exact:true})).toHaveCount(0)
 await runDelay(page)
 await expect(page.getByRole('region',{name:'Event impact workspace',exact:true})).toContainText('Fixture Beta activity 1')
 await expect(page.getByRole('region',{name:'Event impact workspace',exact:true})).not.toContainText('Fixture activity 1')
})

test('leaving and returning through actual app navigation clears hypothetical work',async({page,app})=>{
 await app.open('/events',{authenticated:true,simulation:true})
 await expect(eventSelect(page).locator('option')).toHaveCount(2)
 await runDelay(page)
 page.once('dialog',dialog=>dialog.accept())
 await app.navigate('schedule','Personal Schedule')
 await expect(page).toHaveURL(/personal-schedule$/)
 await app.navigate('risk','Event Risk Planning')
 await expect(page.getByRole('region',{name:'Start a simulation',exact:true})).toBeVisible()
 await expect(page.getByText('Simulation complete',{exact:true})).toHaveCount(0)
})

test('failed refresh removes stale options/results and can recover',async({page,app})=>{
 await app.open('/events',{authenticated:true,simulation:true})
 await expect(eventSelect(page).locator('option')).toHaveCount(2)
 await runDelay(page)
 await page.evaluate(()=>window.__foundation.configure({tableError:'events'}))
 await page.getByRole('button',{name:'Refresh event data',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Could not load events')
 await expect(eventSelect(page).locator('option')).toHaveCount(0)
 await expect(page.getByRole('region',{name:'Event impact workspace',exact:true})).toHaveCount(0)
})

test('one failed roster is disclosed without borrowing another event roster',async({page,app})=>{
 await app.open('/events',{authenticated:true,simulation:true,rosterError:990003})
 await expect(eventSelect(page).locator('option')).toHaveCount(2)
 await eventSelect(page).selectOption('990003')
 await chooseDisruptionTime(page,'Unavailable from (Singapore)','2026-11-03T10:00')
 await chooseDisruptionTime(page,'Unavailable until (Singapore)','2026-11-03T10:30')
 await page.getByRole('button',{name:'Run simulation (1)',exact:true}).click()
 await page.getByText('Availability evidence and limitations',{exact:true}).click()
 await expect(page.getByText('The selected event roster is not verified. Check the coverage warning.',{exact:true})).toBeVisible()
 await expect(page.locator('[data-candidate-id]')).toHaveCount(0)
})

test('deep-link event context survives initial load and browser refresh',async({page,app})=>{
 await app.open('/events?eventId=990003',{authenticated:true,simulation:true})
 await expect(eventSelect(page)).toHaveValue('990003')
 await page.reload()
 await expect(eventSelect(page)).toHaveValue('990003')
})
