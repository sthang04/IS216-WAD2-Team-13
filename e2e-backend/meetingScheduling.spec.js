// Real multi-user meeting scheduling, voting, confirmation and authorisation.
// Writes use visible controls; snapshots read the actual persisted backend records.
import {test,expect} from './helpers/actors.js'
import {assertPageLayout} from '../e2e/helpers/browserUi.js'

test('organiser creates a meeting, participant votes and both see its persisted confirmation',async({world},info)=>{
 // Setup: separate real sessions for two members of the same club and an outsider.
 const organiser=await world.actor('claimant'),participant=await world.actor('participant'),outsider=await world.actor('outsider')
 const row=await world.booking(),title='Playwright meeting '+info.project.use.viewport.width+'x'+info.project.use.viewport.height
 await organiser.page.goto('/availability')
 // Actions: create a future meeting through the actual organiser form.
 await organiser.page.getByRole('button',{name:'Schedule Meeting',exact:true}).click()
 await organiser.page.getByLabel('Title',{exact:true}).fill(title)
 await organiser.page.getByLabel('Meeting week',{exact:true}).selectOption(row.booking_date)
 await organiser.page.getByRole('button',{name:'Everyone',exact:true}).click()
 const response=organiser.page.waitForResponse(r=>r.url().includes('/rest/v1/rpc/rpc_create_meeting')&&r.request().method()==='POST')
 await organiser.page.getByRole('button',{name:'Send Meeting Request',exact:true}).click()
 const created=await response;expect(created.ok()).toBe(true)
 const meetingId=Number(await created.json());expect(meetingId).toBeGreaterThan(0)
 world.onCleanup(()=>organiser.rpc('rpc_cancel_meeting',{p_meeting_id:meetingId,p_demo_member_id:null}))
 const snapshot=()=>organiser.rpc('rpc_meeting_snapshot',{p_club_id:10,p_week_start:row.booking_date,p_meeting_id:meetingId,p_demo_member_id:null})
 await expect.poll(async()=>(await snapshot()).meeting.title).toBe(title)
 await organiser.page.goto('/availability?meeting='+meetingId);await participant.page.goto('/availability?meeting='+meetingId)
 for(const actor of [organiser,participant]){
  await expect(actor.page.getByText(title,{exact:true}).first()).toBeVisible()
  const cell=actor.page.locator('.scheduler-grid [role=button]').first()
  await expect(cell).toHaveAttribute('aria-pressed','false')
  // Actions: both users vote through the heatmap; reload verifies persistence.
  const savedVote=actor.page.waitForResponse(r=>r.url().includes('/rest/v1/rpc/rpc_set_meeting_availability')&&r.request().method()==='POST')
  await cell.click();await expect(cell).toHaveAttribute('aria-pressed','true')
  expect((await savedVote).ok(),'The backend acknowledges the availability save').toBe(true)
  await expect.poll(async()=>(await snapshot()).availability.some(v=>Number(v.member_id)===actor.memberId),{message:'The actual database contains this participant vote'}).toBe(true)
  await actor.page.reload();await expect(cell).toHaveAttribute('aria-pressed','true')
 }
 await expect.poll(async()=>(await snapshot()).availability.length).toBe(2)
 // Actions: an unrelated club tries to forge a participant vote. It must be refused.
 const denied=await outsider.rpcRaw('rpc_set_meeting_availability',{p_meeting_id:meetingId,p_slot_date:row.booking_date,p_hour:8,p_available:true,p_demo_member_id:participant.memberId})
 expect(denied.ok()).toBe(false);expect([400,403]).toContain(denied.status())
 expect((await snapshot()).availability).toHaveLength(2)
 // Actions: the organiser confirms the selected future time using the form.
 await organiser.page.reload()
 await organiser.page.getByRole('button',{name:'Choose Meeting Day & Confirm',exact:true}).click()
 await organiser.page.getByLabel('Day',{exact:true}).selectOption(row.booking_date)
 await organiser.page.getByLabel('From',{exact:true}).selectOption('8')
 await organiser.page.getByLabel('To',{exact:true}).selectOption('9')
 await organiser.page.getByRole('button',{name:'Confirm & Notify Participants',exact:true}).click()
 // Assert: actual stored confirmation, then both users' independently refreshed UI.
 await expect.poll(async()=>(await snapshot()).meeting.status).toBe('CONFIRMED')
 const saved=(await snapshot()).meeting
 expect([saved.confirmed_date,saved.confirmed_start_hour,saved.confirmed_end_hour]).toEqual([row.booking_date,8,9])
 for(const actor of [organiser,participant]){
  await actor.page.reload();await expect(actor.page.getByRole('button',{name:'Add to Calendar (.ics)',exact:true})).toBeVisible()
  await expect(actor.page.getByText(title,{exact:true}).first()).toBeVisible();await assertPageLayout(actor.page)
 }
})
