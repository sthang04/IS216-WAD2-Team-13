// BROWSER TEST PURPOSE: schedule user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
import {test,expect} from './fixtures/app.js'
import {openScheduleForm,scheduleCard,downloadText} from './fixtures/journeys.js'

test('a signed-in member sees tasks from the events saved in Operations, not the sample',async({page,app})=>{
 const task={id:'t1',member_id:7001,title:'Fixture saved task',task_type:'setup',start_time:'10:00:00',end_time:'11:00:00',venue:'Fixture Hall',is_fixed:false}
 await app.open('/personal-schedule',{authenticated:true,savedOpsEvents:[
  {id:'e1',name:'Fixture Saved Event',event_date:'2099-01-02',venue:'Fixture Hall',start_time:null,end_time:null,
   ops_event_crew:[{member_id:7001,checked_in_at:null,late:null}],ops_tasks:[task]},
  {id:'e2',name:'Fixture Other Crew Event',event_date:'2099-01-03',venue:'Fixture Hall',start_time:null,end_time:null,
   ops_event_crew:[{member_id:7002,checked_in_at:null,late:null}],ops_tasks:[{...task,id:'t2',member_id:7002,title:'Fixture not mine'}]}]})
 // The schedule jumps to the saved event's date and lists only this member's crew task.
 // (The old "N Day-of Ops tasks linked from ..." banner was removed from the page.)
 // Ops task headings include their event name: "Task (Event)".
 await expect(scheduleCard(page,'Fixture saved task (Fixture Saved Event)')).toBeVisible()
 await expect(page.getByRole('heading',{name:/Fixture not mine/})).toHaveCount(0)
 // The built-in sample Day-of-Ops tasks are not mixed in for a signed-in member.
 await expect(scheduleCard(page,'Collect Props & Audio Gear')).toHaveCount(0)
})

test('with no saved tasks, a signed-in member sees no Day-of Ops link at all',async({page,app})=>{
 await app.open('/personal-schedule',{authenticated:true,savedOpsEvents:[]})
 await expect(page.getByRole('heading',{name:/here are your schedule/})).toBeVisible()
 await expect(page.getByText(/linked from/)).toHaveCount(0)
})

test('create, edit, toggle and delete a custom personal schedule entry',async({page,app})=>{
 await app.open('/personal-schedule',{authenticated:true})
 const modal=await openScheduleForm(page)
 await modal.getByPlaceholder('e.g. Bring dance sneakers.').fill('Fixture preparation notes')
 await modal.getByRole('button',{name:'Add to Schedule',exact:true}).click()
 let card=scheduleCard(page,'Fixture custom rehearsal')
 await expect(card).toContainText('Fixture preparation notes')
 await card.getByRole('button',{name:'Not Started',exact:true}).click()
 await expect(card.getByRole('button',{name:'In Progress',exact:true})).toBeVisible()
 await card.getByRole('button',{name:'Edit',exact:true}).click()
 await page.getByPlaceholder('e.g. IS216 Lab, Rehearsal Warmup').fill('Fixture updated rehearsal')
 await page.getByRole('button',{name:'Save Changes',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Fixture custom rehearsal',exact:true})).toHaveCount(0)
 card=scheduleCard(page,'Fixture updated rehearsal')
 await expect(card.getByRole('button',{name:'In Progress',exact:true})).toBeVisible()
 await card.getByRole('button',{name:'Delete',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Fixture updated rehearsal',exact:true})).toHaveCount(0)
})

test('required title prevents empty schedule submission and Cancel discards edits',async({page,app})=>{
 await app.open('/personal-schedule',{authenticated:true})
 await page.getByRole('button',{name:'Add Event / Class',exact:true}).first().click()
 const modal=page.locator('.modal.show')
 await modal.getByRole('button',{name:'Add to Schedule',exact:true}).click()
 await expect(modal).toBeVisible()
 expect(await modal.getByPlaceholder('e.g. IS216 Lab, Rehearsal Warmup').evaluate(e=>e.validity.valueMissing)).toBe(true)
 await modal.getByRole('button',{name:'Cancel',exact:true}).click()
 await expect(modal).toHaveCount(0)
})

test('category filter includes only academic entries and restores all events',async({page,app})=>{
 await app.open('/personal-schedule',{authenticated:true})
 await page.getByRole('button',{name:'Academic',exact:true}).click()
 await expect(page.getByRole('heading',{name:'IS216 Web Application Development II (G1)',exact:true})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Act 2 Audio & Lighting Programming',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:/All Events/}).click()
 await expect(page.getByRole('heading',{name:'Act 2 Audio & Lighting Programming',exact:true})).toBeVisible()
})

test('calendar download contains custom title, venue and Singapore timestamps',async({page,app})=>{
 await app.open('/personal-schedule',{authenticated:true})
 const modal=await openScheduleForm(page,'Fixture exported event')
 await modal.getByRole('button',{name:'Add to Schedule',exact:true}).click()
 const {text,name}=await downloadText(page,()=>page.getByRole('button',{name:'Export calendar (.ics)',exact:true}).click())
 expect(name).toMatch(/\.ics$/)
 expect(text).toContain('BEGIN:VCALENDAR')
 expect(text).toContain('SUMMARY:Fixture exported event')
 // 17:15 Singapore is 09:15 UTC; the current exporter uses portable UTC timestamps.
 expect(text).toContain('DTSTART:20261103T091500Z')
 expect(text).toContain('LOCATION:Studio L7.2')
})

test('overlapping academic and custom events display a clash warning',async({page,app})=>{
 await app.open('/personal-schedule',{authenticated:true})
 const modal=await openScheduleForm(page,'Fixture overlapping rehearsal')
 await modal.locator('input[type=time]').nth(0).fill('16:00')
 await modal.locator('input[type=time]').nth(1).fill('16:30')
 await modal.getByRole('button',{name:'Add to Schedule',exact:true}).click()
 await expect(scheduleCard(page,'Fixture overlapping rehearsal')).toContainText('Clash Detected')
 await expect(page.getByText('Academic Timetable Conflict Detected',{exact:true})).toBeVisible()
})

// Guest entry was removed; verify the supported signed-out boundary instead.
test('signed-out access to /personal-schedule requests login without exposing protected controls',async({page,app})=>{
 await app.open('/personal-schedule')
 await expect(page).toHaveURL(/redirect=/)
 await expect(page.locator('input[name="smu_user_password"]')).toBeVisible()
 await expect(page.getByRole('button',{name:/explore live facility calendar as guest/i})).toHaveCount(0)
 await page.reload()
 await expect(page.locator('input[name="smu_user_password"]')).toBeVisible()
 await expect(page.getByRole('button',{name:'Submit claim',exact:true})).toHaveCount(0)
})

test('end time preceding start time is rejected by the schedule form',async({page,app})=>{
 await app.open('/personal-schedule',{authenticated:true})
 const modal=await openScheduleForm(page,'Fixture reversed interval')
 await modal.locator('input[type=time]').nth(0).fill('18:00')
 await modal.locator('input[type=time]').nth(1).fill('17:00')
 await modal.getByRole('button',{name:'Add to Schedule',exact:true}).click()
 // Keep invalid intervals open for correction and never add them to the schedule.
 await expect(modal).toBeVisible()
 await expect(page.getByRole('heading',{name:'Fixture reversed interval',exact:true})).toHaveCount(0)
})


// ---- Database-backed Personal Schedule (rpc_my_personal_events / rpc_save_personal_event) ----

test('an empty day offers its own Add Event button and a saved entry survives a reload',async({page,app})=>{
 // Setup: a signed-in member with no saved personal events (fresh personal_events table).
 await app.open('/personal-schedule',{authenticated:true,emptySchedule:true})
 // Assert: the schedule opens on today (fixture clock: Tue 3 Nov) and shows the empty state.
 await expect(page.getByLabel('Schedule date',{exact:true})).toHaveValue('2026-11-03')
 const empty=page.locator('.pulse-card').filter({has:page.getByRole('heading',{name:'Nothing scheduled yet',exact:true})})
 await expect(empty).toBeVisible()
 // Action: add an entry from the empty-state card's button (not the header button).
 await empty.getByRole('button',{name:'Add Event / Class',exact:true}).click()
 const modal=page.locator('.modal.show')
 await modal.getByPlaceholder('e.g. IS216 Lab, Rehearsal Warmup').fill('Fixture first entry')
 await modal.getByRole('button',{name:'Add to Schedule',exact:true}).click()
 // Assert: the entry is saved through the backend RPC, not just drawn on the page...
 await expect(scheduleCard(page,'Fixture first entry')).toBeVisible()
 const saved=await page.evaluate(()=>window.__foundation.calls.filter(c=>c.name==='rpc_save_personal_event').length)
 expect(saved).toBe(1)
 // ...so it is read back from the database after a full page reload.
 await page.reload()
 await expect(scheduleCard(page,'Fixture first entry')).toBeVisible()
 await expect(empty).toHaveCount(0)
})

test('a failed schedule load is reported instead of showing stale or sample entries',async({page,app})=>{
 // Setup: the personal-events read is refused by the backend.
 await app.open('/personal-schedule',{authenticated:true,rpcError:'rpc_my_personal_events'})
 // Assert: the member is told why, and the sample events are not shown as if they were theirs.
 await expect(page.getByText(/Couldn't load your schedule/)).toBeVisible()
 await expect(page.getByRole('heading',{name:'IS216 Web Application Development II (G1)',exact:true})).toHaveCount(0)
 await expect(page.getByRole('heading',{name:'Nothing scheduled yet',exact:true})).toBeVisible()
})

// ---- OneMap walking time between consecutive entries in different buildings ----

test('walking time between buildings is shown from the OneMap route service',async({page,app})=>{
 // Setup: seeded day with a class in SCIS 1 followed by a rehearsal in Li Ka Shing Library.
 // Both are known SMU buildings, so no geocoding search is needed; the onemap-walk Edge
 // Function stub (fixtures/client.js) returns an 8-minute, 650 m route.
 await app.open('/personal-schedule',{authenticated:true})
 const rehearsal=scheduleCard(page,'Act 2 Floor Positioning & Soundcheck')
 // Assert: the hint names the previous venue and the route length.
 await expect(rehearsal).toContainText('~8 min walk (650m) from Seminar Room 2.1, SCIS1')
 // Entries in the same building need no walk.
 await expect(scheduleCard(page,'Act 2 Audio & Lighting Programming')).toContainText('Same building as your previous event')
})
