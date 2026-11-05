// App-wide UI journeys, Setup -> Actions -> Assert style.
// Real Vue pages and controls run with synthetic API responses. No real messages or bookings are written.
import {test,expect} from './fixtures/app.js'
import {room,openScheduleForm,scheduleCard,downloadText} from './fixtures/journeys.js'
import {assertPageLayout,assertBoxOnScreen,assertControlUsable,swipeLeft} from '../e2e/helpers/browserUi.js'

async function signup(page,app,config={}){
 await app.open('/signup',config)
 await page.getByLabel('SMU email address',{exact:true}).fill('fixture.exco@smu.edu.sg')
 await page.getByRole('button',{name:/Continue/}).click()
 await expect(page.getByLabel('Full name',{exact:true})).toBeVisible()
}
async function meeting(page,app,config={}){
 await app.open('/availability',{authenticated:true,meetings:true,...config})
 await expect(page.getByRole('heading',{name:'Weekly Meeting Scheduler',exact:true})).toBeVisible()
}
async function ops(page,app){
 await page.clock.setFixedTime(new Date('2026-11-03T15:15:00+08:00'))
 await app.open('/operations',{authenticated:true,opsSample:true})
 await expect(page.getByRole('heading',{name:'Day-of Operations',exact:true})).toBeVisible()
}
async function uploadTimetable(page,contents,name='ui-timetable.ics'){
 // Use the visible import control and the browser's file chooser, not an application service call.
 const chosen=page.waitForEvent('filechooser')
 await page.getByRole('button',{name:/^(Import|Replace) Timetable/}).click()
 await (await chosen).setFiles({name,mimeType:'text/calendar',buffer:Buffer.from(contents)})
}
const timetable=['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:ui-class','DTSTART:20261104T020000Z','DTEND:20261104T030000Z','SUMMARY:UI imported class','END:VEVENT','END:VCALENDAR'].join('\r\n')

test('landing feature previews, password visibility and email clearing are usable',async({page,app})=>{
 // Setup: open the public landing with reduced motion, keeping the preview stable while inspected.
 await page.emulateMedia({reducedMotion:'reduce'});await app.open()
 // Actions: select each public feature tab and use login input controls.
 for(const name of [/^Facility Exchange/,/^Availability Heatmap/,/^What-If Simulator/]){
  const tab=page.getByRole('tab',{name});await tab.click()
  await expect(tab).toHaveAttribute('aria-selected','true')
  await expect(page.locator('.demo-stage')).not.toBeEmpty()
  await assertPageLayout(page)
 }
 const email=page.locator('input[name="smu_user_login_email"]'),password=page.locator('input[name="smu_user_password"]')
 await email.fill('fixture.exco@smu.edu.sg');await password.fill('FixturePass123!')
 await page.getByRole('button',{name:'Show password',exact:true}).click()
 await expect(password).toHaveAttribute('type','text')
 await page.getByRole('button',{name:'Hide password',exact:true}).click()
 await page.getByRole('button',{name:'Clear email',exact:true}).click()
 // Assert: controls affect visible fields, and sign-in remains reachable.
 await expect(email).toHaveValue('');await expect(password).toHaveAttribute('type','password')
 await assertControlUsable(page,page.locator('form button[type=submit]'),'Landing sign-in')
})

test('remembered account can switch account and clear its saved login card',async({page,app})=>{
 // Setup: obtain the remembered card through the actual login/logout workflow.
 await app.open();await app.login();await expect(page).toHaveURL(/facilities$/)
 await app.account();await page.getByRole('button',{name:'Sign out',exact:true}).click()
 // Actions: switch away, resume the remembered account, then clear it.
 await page.getByRole('button',{name:'Switch',exact:true}).click()
 await expect(page.getByText('Signing in with different account',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:/Resume Fixture/}).click()
 await page.getByRole('button',{name:'Clear saved login',exact:true}).click()
 // Assert: the normal email/password form returns without an authenticated session.
 await expect(page.locator('input[name="smu_user_login_email"]')).toHaveValue('')
 await expect(page.getByText('SESSION CACHED',{exact:true})).toHaveCount(0)
 await assertPageLayout(page)
})

test('signup validates required profile, Telegram, password length and password confirmation',async({page,app})=>{
 // Setup: reach signup step two using the email form.
 await signup(page,app)
 const submit=page.getByRole('button',{name:/Create account/})
 // Actions and assertions: submit each invalid state and verify its visible guidance.
 await page.getByLabel('Full name',{exact:true}).fill('');await submit.click()
 await expect(page.getByRole('alert')).toContainText('Please fill in your name')
 await page.getByLabel('Full name',{exact:true}).fill('UI Signup Student')
 await page.getByLabel('ExCo position',{exact:true}).selectOption('LOGISTICS')
 await page.getByLabel('Telegram handle',{exact:true}).fill('bad');await submit.click()
 await expect(page.getByRole('alert')).toContainText('Telegram handles')
 await page.getByLabel('Telegram handle',{exact:true}).fill('ui_student')
 await page.getByLabel('Password',{exact:true}).fill('short');await submit.click()
 await expect(page.getByRole('alert')).toContainText('at least 8 characters')
 await page.getByLabel('Password',{exact:true}).fill('FixturePass123!')
 await page.getByLabel('Confirm password',{exact:true}).fill('different');await submit.click()
 await expect(page.getByRole('alert')).toContainText("passwords don't match")
 await page.getByRole('button',{name:'Show password',exact:true}).click()
 await expect(page.getByLabel('Password',{exact:true})).toHaveAttribute('type','text')
 await assertControlUsable(page,submit,'Signup submit')
 await page.getByRole('button',{name:'Use a different email',exact:true}).click()
 await expect(page.getByLabel('SMU email address',{exact:true})).toHaveValue('fixture.exco@smu.edu.sg')
})

test('signup read failure is visible and a retry returns the profile form',async({page,app})=>{
 // Setup: the isolated API denies the initial eligibility read.
 await app.open('/signup',{rpcError:'rpc_check_signup'})
 await page.getByLabel('SMU email address',{exact:true}).fill('fixture.exco@smu.edu.sg')
 await page.getByRole('button',{name:/Continue/}).click()
 await expect(page.getByRole('alert')).toContainText('Could not check the ExCo list')
 // Actions: recover the synthetic API boundary, then retry through the same visible button.
 await page.evaluate(()=>window.__foundation.configure({rpcError:null}))
 await page.getByRole('button',{name:/Continue/}).click()
 // Assert: no reload or forged application state is needed to recover.
 await expect(page.getByLabel('Full name',{exact:true})).toBeVisible()
 await assertPageLayout(page)
})

for(const route of ['/admin','/facilities/my-club','/facilities/waitlist']){
 test('signed-out '+route+' shows sign-in rather than protected content',async({page,app})=>{
  // Setup and action: navigate directly to each remaining protected route.
  await app.open(route)
  // Assert: route protection leaves a usable login form.
  await expect(page).toHaveURL(/redirect=/)
  await assertControlUsable(page,page.locator('input[name="smu_user_password"]'),'Protected-route login')
  await expect(page.getByRole('button',{name:'Approve',exact:true})).toHaveCount(0)
 })
}

test('calendar status filtering and day selection show real empty and restored states',async({page,app})=>{
 // Setup: populate the calendar with different booking states.
 await app.open('/facilities',{authenticated:true,facilities:true})
 // Actions: filter by a weekday, restore the whole week, then select booking statuses.
 const tuesday=page.getByRole('button',{name:/^Tue\s*10/})
 await tuesday.click();await expect(tuesday).toHaveAttribute('aria-pressed','true')
 await expect(page.getByRole('button',{name:'Claim',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Show whole week',exact:true}).click()
 const availability=page.getByLabel('Availability',{exact:true})
 await availability.selectOption('Proposed Peer Transfer')
 await expect(room(page,'Fixture Music Room')).toBeVisible()
 await expect(page.getByRole('button',{name:'Release',exact:true})).toHaveCount(0)
 await availability.selectOption('Pending Admin Sign-off')
 await expect(page.getByRole('button',{name:'Claim',exact:true})).toHaveCount(0)
 await availability.selectOption('All')
 await page.getByLabel('Jump to week',{exact:true}).fill('2026-11-16')
 // Assert: a different week shows empty booking states and can return to its populated week.
 await expect(page.getByText('No bookings at this facility for the selected week.')).toHaveCount(3)
 await page.getByRole('button',{name:'Go to upcoming week',exact:true}).click()
 await expect(room(page,'Fixture Music Room').getByRole('button',{name:'Claim',exact:true})).toBeVisible()
 await assertPageLayout(page)
})

test('empty facilities and empty My Club remain readable and navigable',async({page,app})=>{
 // Setup: a signed-in club with no facility records.
 await app.open('/facilities',{authenticated:true})
 // Actions: visit the empty calendar, club dashboard and queue through their links.
 await expect(page.getByRole('heading',{name:'No facilities match these filters',exact:true})).toBeVisible()
 await page.getByRole('link',{name:'My Club',exact:true}).click()
 await expect(page.getByRole('heading',{name:'My Assigned Bookings',exact:true})).toBeVisible()
 await assertPageLayout(page)
 await page.getByRole('link',{name:/^Waitlist/}).click()
 // Assert: the empty queue is described explicitly, without hidden mutation controls.
 await expect(page.getByText('Fixture Arts Club is not queuing for any slot.',{exact:true})).toBeVisible()
 await assertPageLayout(page)
})

test('My Club undo release restores the assigned booking after confirmation',async({page,app})=>{
 // Setup: an assigned club booking.
 await app.open('/facilities/my-club',{authenticated:true,facilities:true})
 // Actions: release, review the undo dialog, and confirm restoration.
 await page.locator('#section-assigned').getByRole('button',{name:'Release',exact:true}).click()
 await page.getByRole('dialog').getByRole('button',{name:'Release slot',exact:true}).click()
 await page.locator('#section-released').getByRole('button',{name:'Undo Release',exact:true}).click()
 await assertBoxOnScreen(page,page.getByRole('dialog'),'My Club undo dialog')
 await page.getByRole('dialog').getByRole('button',{name:'Undo release',exact:true}).click()
 // Assert: the restored slot returns to assigned bookings.
 await expect(page.locator('#section-assigned')).toContainText('Fixture Dance Studio')
 await expect(page.locator('#section-assigned').getByRole('button',{name:'Release',exact:true})).toBeVisible()
})

test('waitlist offer refusal keeps the offer and displays the API error',async({page,app})=>{
 // Setup: an offer whose synthetic claim API will refuse the mutation.
 await app.open('/facilities/waitlist',{authenticated:true,facilities:true,offer:true,rpcError:'rpc_claim_booking'})
 // Actions: review and accept the offer through its confirmation dialog.
 await page.getByRole('button',{name:'Accept and claim',exact:true}).click()
 await assertBoxOnScreen(page,page.getByRole('dialog'),'Offer confirmation')
 await page.getByRole('dialog').getByRole('button',{name:'Accept and claim',exact:true}).click()
 // Assert: failure is explicit and the offer remains available for retry.
 await expect(page.getByRole('status').filter({hasText:'Fixture operation denied'})).toBeVisible()
 await expect(page.getByRole('button',{name:'Accept and claim',exact:true})).toBeEnabled()
})

test('schedule editor fields and footer fit while creating a long academic entry',async({page,app})=>{
 // Setup: open the actual custom-event form.
 await app.open('/personal-schedule',{authenticated:true})
 const modal=await openScheduleForm(page,'UI academic rehearsal with a long descriptive title')
 // Actions: exercise every editable field, including category, building, room, role and notes.
 await assertBoxOnScreen(page,modal.locator('.modal-content'),'Schedule form')
 await modal.locator('select').nth(0).selectOption('Academic')
 await modal.locator('select').nth(1).selectOption({index:1})
 await modal.getByPlaceholder('e.g. SR 2.1, Studio L7.2, B1 Stage').fill('Seminar Room 2.1')
 await modal.getByPlaceholder('e.g. Lead Dancer, Student').fill('Student coordinator')
 await modal.getByPlaceholder('e.g. Bring dance sneakers, project slide deck ready.').fill('Bring notes and review the long academic agenda. '.repeat(5))
 await assertControlUsable(page,modal.getByRole('button',{name:'Add to Schedule',exact:true}),'Schedule save')
 await modal.getByRole('button',{name:'Add to Schedule',exact:true}).click()
 // Assert: the new visible card preserves all user-entered information.
 const card=scheduleCard(page,'UI academic rehearsal with a long descriptive title')
 await expect(card).toContainText('Seminar Room 2.1')
 await expect(card).toContainText('Student coordinator')
 await expect(card).toContainText('Bring notes')
 await assertPageLayout(page)
})

test('schedule day navigation and full status cycle survive a refresh',async({page,app})=>{
 // Setup: create a custom entry using the form.
 await app.open('/personal-schedule',{authenticated:true})
 const modal=await openScheduleForm(page,'UI status cycle')
 await modal.getByRole('button',{name:'Add to Schedule',exact:true}).click()
 const card=scheduleCard(page,'UI status cycle')
 // Actions: complete the status cycle, move away a day, then return.
 for(const status of ['Not Started','In Progress','Completed'])await card.getByRole('button',{name:status,exact:true}).click()
 await expect(card.getByRole('button',{name:'Not Started',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Next day',exact:true}).click()
 await expect(page.getByRole('heading',{name:'UI status cycle',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Previous day',exact:true}).click()
 await expect(card).toBeVisible()
 // The date picker must select the same days as the previous/next controls.
 await page.getByLabel('Schedule date',{exact:true}).fill('2026-11-20')
 await expect(page.getByRole('heading',{name:'Nothing scheduled yet',exact:true})).toBeVisible()
 await page.getByLabel('Schedule date',{exact:true}).fill('2026-10-23')
 await expect(card).toBeVisible();await page.reload()
 // Assert: saved content and its current status survive re-entry.
 await expect(scheduleCard(page,'UI status cycle').getByRole('button',{name:'Not Started',exact:true})).toBeVisible()
})

test('meeting form validates title and participants while its controls remain usable',async({page,app})=>{
 // Setup: no meeting yet, so the scheduling form is available.
 await meeting(page,app,{emptyMeeting:true})
 await page.getByRole('button',{name:'Schedule Meeting',exact:true}).click()
 // Actions and assertions: clear the prefilled title, then validate missing participants.
 await page.getByLabel('Title',{exact:true}).fill('')
 await page.getByRole('button',{name:'Send Meeting Request',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Give the meeting a title')
 await page.getByLabel('Title',{exact:true}).fill('UI participant validation')
 const dancer=page.getByRole('checkbox',{name:/Fixture Dancer/})
 if(await dancer.isChecked())await dancer.uncheck()
 await page.getByRole('button',{name:'Send Meeting Request',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Pick at least one other participant')
 await page.getByRole('button',{name:'Dancers',exact:true}).click()
 await expect(dancer).toBeChecked()
 await assertControlUsable(page,page.getByLabel('Voting deadline',{exact:true}),'Voting deadline')
 await assertControlUsable(page,page.getByRole('button',{name:'Send Meeting Request',exact:true}),'Meeting submit')
 await page.getByRole('button',{name:'Close',exact:true}).click()
 await expect(page.getByLabel('Title',{exact:true})).toHaveCount(0)
})

test('meeting timetable import persists after refresh and can be removed',async({page,app})=>{
 // Setup: the real import UI with a valid in-memory .ics file.
 await meeting(page,app)
 // Actions: import via file chooser and revisit the saved baseline.
 await uploadTimetable(page,timetable)
 await expect(page.getByRole('alert')).toContainText('Imported 1 events')
 await expect(page.getByText('Timetable: ui-timetable.ics',{exact:true})).toBeVisible()
 await page.reload()
 await expect(page.getByRole('button',{name:'Replace Timetable (.ics)',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Remove',exact:true}).click()
 // Assert: the filename and replacement action disappear after removal.
 await expect(page.getByRole('alert')).toContainText('Timetable removed')
 await expect(page.getByRole('button',{name:'Import Timetable (.ics)',exact:true})).toBeVisible()
})

for(const scenario of ['empty','refused']){
 test('meeting timetable '+scenario+' import shows guidance without a saved baseline',async({page,app})=>{
  // Setup: either no timed events or an API that rejects saving the import.
  await meeting(page,app,scenario==='refused'?{rpcError:'rpc_save_my_baseline'}:{})
  // Action: choose the file through the actual import control.
  await uploadTimetable(page,scenario==='empty'?'BEGIN:VCALENDAR\r\nEND:VCALENDAR':timetable)
  // Assert: errors stay visible and the unsaved file is not presented as imported.
  await expect(page.getByRole('alert')).toContainText(scenario==='empty'?'No timed events found':'Could not import')
  await expect(page.getByRole('button',{name:'Import Timetable (.ics)',exact:true})).toBeVisible()
  await expect(page.getByText('Timetable: ui-timetable.ics',{exact:true})).toHaveCount(0)
 })
}

test('meeting reminders update visible cooldown without sending a real Telegram message',async({page,app})=>{
 // Setup: two pending synthetic participants.
 await meeting(page,app)
 // Action: use the visible individual reminder button.
 await page.getByRole('button',{name:'Nudge via Telegram',exact:true}).click()
 // Assert: visible confirmation and disabled cooldown actions come from the saved fixture response.
 await expect(page.getByRole('alert')).toContainText('Telegram reminder sent')
 await expect(page.getByText(/Nudged just now/)).toBeVisible()
 await expect(page.getByRole('button',{name:/All pending participants nudged/})).toBeDisabled()
})

test('meeting cancellation supports declining confirmation before cancelling',async({page,app})=>{
 // Setup: a collecting meeting owned by this organiser.
 await meeting(page,app)
 // Actions: dismiss cancellation once, then confirm it.
 page.once('dialog',dialog=>dialog.dismiss())
 await page.getByRole('button',{name:'Cancel meeting request',exact:true}).click()
 await expect(page.getByText('Fixture team meeting',{exact:true}).first()).toBeVisible()
 page.once('dialog',dialog=>dialog.accept())
 await page.getByRole('button',{name:'Cancel meeting request',exact:true}).click()
 // Assert: a cancelled request returns to the schedule-meeting state.
 await expect(page.getByRole('alert')).toContainText('Meeting request cancelled')
 await expect(page.getByRole('button',{name:'Schedule Meeting',exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Cancel meeting request',exact:true})).toHaveCount(0)
})

test('meeting loading and expired voting states expose no active vote controls',async({page,app})=>{
 // Setup: pause the snapshot response explicitly to inspect loading.
 await meeting(page,app,{holdRpc:'rpc_meeting_snapshot',meetingOptions:{status:'EXPIRED',vote_deadline:'2026-11-02T00:00:00Z'}})
 await expect(page.getByRole('status',{name:'Loading',exact:true})).toBeVisible()
 // Action: release the synthetic response; the real view renders its expired state.
 await page.evaluate(()=>{window.__foundation.configure({holdRpc:null});window.__foundation.release()})
 // Assert: expired feedback replaces loading, with no selectable vote blocks.
 await expect(page.getByText('Voting closed',{exact:true}).first()).toBeVisible()
 await expect(page.locator('.scheduler-grid [role=button]')).toHaveCount(0)
 await expect(page.getByRole('button',{name:'None of these times work',exact:true})).toHaveCount(0)
})

test('meeting member view shows organiser guidance instead of confirmation controls',async({page,app})=>{
 // Setup: a participant who is not the organiser.
 await meeting(page,app,{meetingOptions:{is_organiser:false,can_confirm:false}})
 // Action: inspect the visible participant workflow.
 await page.locator('.scheduler-grid [role=button]').first().click()
 // Assert: voting works, but organiser confirmation and cancellation are unavailable.
 await expect(page.getByText(/can confirm the meeting time once everyone has responded/)).toBeVisible()
 await expect(page.getByRole('button',{name:'Choose Meeting Day & Confirm',exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Cancel meeting request',exact:true})).toHaveCount(0)
})

test('Operations delay menu fits and closes without changing a task',async({page,app})=>{
 // Setup: the sample plan on its event day.
 await ops(page,app)
 const trigger=page.getByRole('button',{name:/Delay current tasks/})
 // Actions: open the actual delay menu and inspect its choices.
 await trigger.click()
 for(const name of ['+5 min','+15 min','+30 min'])await assertControlUsable(page,page.getByRole('button',{name:name+' Delay',exact:true}),name)
 await assertPageLayout(page)
 await trigger.click()
 // Assert: closing without a choice leaves the menu collapsed.
 await expect(trigger).toHaveAttribute('aria-expanded','false')
})

test('Operations task form validates, creates, edits and deletes a crew task',async({page,app})=>{
 // Setup: the local sample plan, so every mutation stays isolated.
 await ops(page,app)
 await page.getByRole('button',{name:'+ Add task',exact:true}).click()
 let dialog=page.getByRole('dialog')
 // Actions and assertions: submit invalid values, then correct the same form.
 await assertBoxOnScreen(page,dialog.locator('.modal-content'),'Operations task editor')
 await dialog.getByRole('button',{name:'Add task',exact:true}).click()
 await expect(dialog).toContainText('Give the task a name')
 await dialog.getByLabel('Task',{exact:true}).fill('UI crew preparation')
 await dialog.getByLabel('Start',{exact:true}).fill('12:00')
 await dialog.getByLabel('End',{exact:true}).fill('11:00')
 await dialog.getByRole('button',{name:'Add task',exact:true}).click()
 await expect(dialog).toContainText('end time must be after')
 await dialog.getByLabel('End',{exact:true}).fill('13:00')
 const person=dialog.locator('.ops-person-pill').filter({hasText:'Rachel Tan'})
 if(!/active/.test(await person.getAttribute('class')))await person.click()
 await dialog.getByLabel('Type',{exact:true}).selectOption({index:0})
 await dialog.getByLabel('Where',{exact:true}).fill('UI rehearsal room')
 await dialog.getByRole('checkbox',{name:/Fixed time/}).check()
 await assertControlUsable(page,dialog.getByRole('button',{name:'Add task',exact:true}),'Add task action')
 await dialog.getByRole('button',{name:'Add task',exact:true}).click()
 await expect(dialog).toHaveCount(0)
 await page.getByRole('button',{name:'Full grid',exact:true}).click()
 await page.locator('.ops-block').filter({hasText:'UI crew preparation'}).first().click()
 dialog=page.getByRole('dialog')
 await dialog.getByLabel('Task',{exact:true}).fill('UI updated preparation')
 await dialog.getByRole('button',{name:'Save',exact:true}).click()
 await page.locator('.ops-block').filter({hasText:'UI updated preparation'}).first().click()
 page.once('dialog',native=>native.accept())
 await page.getByRole('dialog').getByRole('button',{name:/^Delete/}).click()
 // Assert: the task is removed from the rendered plan, not just its editor.
 await expect(page.locator('.ops-block').filter({hasText:'UI updated preparation'})).toHaveCount(0)
})

test('Operations event editor preserves cancel and renders the next-day planning state',async({page,app})=>{
 // Setup: open the current event's actual editor.
 await ops(page,app)
 await page.getByRole('button',{name:'Edit event',exact:true}).click()
 let dialog=page.getByRole('dialog')
 // Actions: cancel one edit, then save a date/name change.
 await assertBoxOnScreen(page,dialog.locator('.modal-content'),'Operations event editor')
 await dialog.getByLabel(/^Event name/).fill('UI discarded name')
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
 await expect(page.getByRole('combobox',{name:'Event',exact:true})).not.toContainText('UI discarded name')
 await page.getByRole('button',{name:'Edit event',exact:true}).click()
 dialog=page.getByRole('dialog')
 await dialog.getByLabel(/^Event name/).fill('UI tomorrow showcase')
 await dialog.getByLabel(/^Date/).fill('2026-11-04')
 await assertControlUsable(page,dialog.getByRole('button',{name:'Save',exact:true}),'Event save')
 await dialog.getByRole('button',{name:'Save',exact:true}).click()
 // Assert: future-event guidance is readable and day-only delay actions are disabled.
 await expect(page.getByRole('status').filter({hasText:'Planning ahead:'})).toContainText('tomorrow')
 await expect(page.getByRole('button',{name:/Delay current tasks/})).toBeDisabled()
})

test('OSL confirmation dialogs fit and cancellation leaves the pending request unchanged',async({page,app})=>{
 // Setup: a pending transfer owned by the synthetic OSL role.
 await app.open('/facilities/admin',{authenticated:true,role:'admin',facilities:true,transfers:true})
 // Actions: review both decision dialogs and cancel rather than changing the request.
 for(const [action,title] of [['Approve','Approve this transfer?'],['Reject','Reject this transfer?']]){
  await page.getByRole('button',{name:action,exact:true}).click()
  const dialog=page.getByRole('dialog',{name:title,exact:true})
  await assertBoxOnScreen(page,dialog,'OSL '+action+' dialog')
  await assertControlUsable(page,dialog.getByRole('button',{name:'Cancel',exact:true}),'OSL cancel')
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
 }
 // Assert: neither review cancelled the original pending transfer.
 await expect(page.getByRole('heading',{name:'Awaiting OSL approval (1)',exact:true})).toBeVisible()
 await expect(page.getByText('No decisions yet.',{exact:true})).toBeVisible()
})

test('OSL missing transfer deep link shows an explicit empty state and can close',async({page,app})=>{
 // Setup and action: open a real transfer route with an unknown identifier.
 await app.open('/facilities/admin?transfer=99999',{authenticated:true,role:'admin'})
 const dialog=page.getByRole('dialog',{name:'Transfer request',exact:true})
 // Assert: missing data is reported rather than fabricating a request.
 await expect(dialog).toContainText('This request is no longer waiting for approval')
 await assertBoxOnScreen(page,dialog,'Missing transfer dialog')
 await dialog.getByRole('button',{name:'Close',exact:true}).click()
 await expect(page).toHaveURL(/facilities\/admin$/)
})

// The old inline administration console is still present in source but no current role can open it.
// Test its actual route boundary instead of enabling an obsolete screen just to exercise it.
for(const [label,config]of [['Dev',{email:'dev.admin@smu.edu.sg'}],['OSL',{role:'admin'}]]){
 test(label+' legacy administration route redirects to the supported facility screen',async({page,app})=>{
  // Setup and action: request the legacy route using the normal supported persona.
  await app.open('/admin',{authenticated:true,...config})
  // Assert: the supported route is shown, and legacy console actions are absent.
  await expect(page).toHaveURL(/facilities$/)
  await expect(page.getByRole('heading',{name:'Pulse - Master Facility Calendar',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:/Institutional Demerit Ledger/})).toHaveCount(0)
  await assertPageLayout(page)
 })
}


test('notification swipe deletes only the selected item using real browser pointer input',async({page,app},info)=>{
 // Setup: open the actual notification panel with two isolated items.
 await app.open('/facilities',{authenticated:true,notifications:true})
 await page.getByRole('button',{name:'Notifications, 2 unread',exact:true}).click()
 const item=page.getByRole('button',{name:/Fixture schedule update/})
 // Action: swipe the row with the pointer type used by this viewport project.
 await swipeLeft(page,item,!!info.project.use.hasTouch)
 // Assert: the chosen item disappears, while the other item and count remain correct.
 await expect(item).toHaveCount(0)
 await expect(page.getByRole('button',{name:/Fixture facility update/})).toBeVisible()
 await expect(page.getByRole('button',{name:'Notifications, 1 unread',exact:true})).toBeVisible()
})

test('Dev club selector and persona menu remain usable for every available club',async({page,app})=>{
 // Setup: the normal Dev persona resolved by the real authentication service.
 await app.open('/facilities',{authenticated:true,email:'dev.admin@smu.edu.sg'})
 const clubs=page.getByRole('combobox',{name:'Club scope',exact:true})
 // Actions: select each actual option, including long names, and inspect the opened account menu.
 const values=await clubs.locator('option').evaluateAll(options=>options.map(option=>option.value))
 expect(values.length).toBeGreaterThan(1)
 for(const value of values){await clubs.selectOption(value);await expect(clubs).toHaveValue(value);await assertPageLayout(page)}
 await page.getByRole('button',{name:'Account menu for Dev Administrator',exact:true}).click()
 const menu=page.locator('header .card').filter({has:page.getByRole('button',{name:'Sign out',exact:true})})
 await assertBoxOnScreen(page,menu,'Dev account menu')
 await assertControlUsable(page,page.getByRole('button',{name:'Sign out',exact:true}),'Dev sign out')
 await page.getByRole('button',{name:/Marcus Lim/}).click()
 await page.getByRole('button',{name:'Account menu for Marcus Lim',exact:true}).click()
 await page.getByRole('button',{name:/Dev Administrator/}).click()
 // Assert: changing the viewing persona can return to Dev without fabricating a new session.
 await expect(page.getByRole('button',{name:'Account menu for Dev Administrator',exact:true})).toBeVisible()
})

test('Operations running-late choices can be cancelled, recorded and cleared',async({page,app})=>{
 // Setup: the event-day crew with an overdue member.
 await ops(page,app)
 const card=page.locator('.transition-all').filter({has:page.getByText('Rachel Tan',{exact:true})})
 // Actions: undo the sample's initial check-in, cancel once, then choose an ETA.
 await card.getByRole('button',{name:'Undo check-in',exact:true}).click()
 await card.getByRole('button',{name:'Running late',exact:true}).click()
 await assertControlUsable(page,card.getByRole('button',{name:'Cancel',exact:true}),'Cancel late choice')
 await card.getByRole('button',{name:'Cancel',exact:true}).click()
 await card.getByRole('button',{name:'Running late',exact:true}).click()
 await card.getByRole('button',{name:'30 min',exact:true}).click()
 // Assert: the ETA is rendered and can be cleared without changing check-in state.
 await expect(card).toContainText('30 min')
 await card.getByRole('button',{name:'Clear late for Rachel Tan',exact:true}).click()
 await expect(card.getByRole('button',{name:'Running late',exact:true})).toBeVisible()
 await expect(card.getByRole('button',{name:'Check in',exact:true})).toBeVisible()
})


test('login error and keyboard navigation keep landing previews inside the screen',async({page,app})=>{
 // Setup: a denied membership lookup leaves the real sign-in page and error visible.
 await app.open('/',{membershipError:true});await app.login()
 await expect(page.getByRole('alert')).toContainText('Pulse sign-in is for CCA ExCos and OSL staff')
 await expect(page.getByRole('alert')).not.toContainText(/guest/i)
 // Actions: move keyboard focus through the public page after the layout expands for its error.
 for(let step=0;step<10;step++){
  await page.keyboard.press('Tab')
  await assertPageLayout(page)
 }
 // Assert: decorative overflow cannot pan the login container and hide the preview tabs.
 expect(await page.locator('.pulse-login-canvas').evaluate(element=>element.scrollLeft)).toBe(0)
})
