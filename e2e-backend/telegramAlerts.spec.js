// Actual browser actions queue real database alerts for authenticated, derived recipients.
// Staging has no Telegram sender, so these checks send no external messages.
import {randomUUID} from 'node:crypto'
import {test,expect} from './helpers/actors.js'
const card=(page,title)=>page.locator('.pulse-card').filter({has:page.getByRole('heading',{name:title,exact:true})})

test('personal schedule create, edit and delete queue private alerts for the signed-in member',async({world})=>{
 // Setup: independent genuine sessions; the outsider must not read these new private rows.
 const member=await world.actor('claimant'),outsider=await world.actor('outsider'),page=member.page
 const title='Telegram schedule '+randomUUID().slice(0,8),ids=[]
 world.onCleanup(async()=>{for(const id of ids)await member.rpc('rpc_delete_notifications',{p_notification_id:id,p_demo_member_id:null})})
 await page.goto('/personal-schedule')
 async function savedAlert(action,perform){
  const response=page.waitForResponse(r=>r.url().includes('/rest/v1/rpc/rpc_notify_schedule_change')&&r.request().method()==='POST')
  await perform();const saved=await response;expect(saved.ok()).toBe(true)
  const result=await saved.json();expect(result.queued).toBe(1);ids.push(result.notification_id)
  const rows=await member.get('/rest/v1/notifications?id=eq.'+result.notification_id)
  expect(rows).toHaveLength(1);expect(rows[0].recipient_member_id).toBe(member.memberId)
  expect(rows[0].type).toBe('SCHEDULE_CHANGED');expect(rows[0].title).toBe('Personal schedule '+action)
  expect(rows[0].telegram_status).toBe('PENDING')
  expect(await outsider.get('/rest/v1/notifications?id=eq.'+result.notification_id)).toEqual([])
 }
 // Actions: create through the normal form, then reload to verify the entry.
 await page.getByRole('button',{name:'Add Event / Class',exact:true}).click()
 await page.getByPlaceholder('e.g. IS216 Lab, Rehearsal Warmup, Team Debrief').fill(title)
 await savedAlert('added',()=>page.getByRole('button',{name:'Add to Schedule',exact:true}).click())
 await page.reload();await expect(card(page,title)).toBeVisible()
 // Actions/Assert: edits and removal each enqueue their own intended alert.
 await card(page,title).getByRole('button',{name:'Edit',exact:true}).click()
 await page.getByPlaceholder('e.g. IS216 Lab, Rehearsal Warmup, Team Debrief').fill(title+' edited')
 await savedAlert('updated',()=>page.getByRole('button',{name:'Save Changes',exact:true}).click())
 await savedAlert('removed',()=>card(page,title+' edited').getByRole('button',{name:'Delete',exact:true}).click())
 await expect(card(page,title+' edited')).toHaveCount(0)
})

test('Notify crew queues alerts only for the persisted event crew and rejects another club',async({world})=>{
 // Setup: create an isolated real event using the organiser's normal table policies.
 const organiser=await world.actor('claimant'),member=await world.actor('participant'),outsider=await world.actor('outsider')
 const eventId=randomUUID(),name='Telegram crew '+eventId.slice(0,8),notices=[]
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
 await organiser.insert('ops_events',{id:eventId,club_id:10,name,event_date:today,venue:'E2E Studio',start_time:'09:00',end_time:'22:00',created_by:organiser.memberId})
 world.onCleanup(async()=>{for(const [actor,id] of notices)await actor.rpc('rpc_delete_notifications',{p_notification_id:id,p_demo_member_id:null});await organiser.remove('ops_events','id=eq.'+eventId)})
 await organiser.insert('ops_event_crew',[{event_id:eventId,member_id:organiser.memberId},{event_id:eventId,member_id:member.memberId}])
 // Actions: open Day-of Ops and use its actual Notify crew button.
 await organiser.page.goto('/operations')
 await organiser.page.locator('#opsEvent').selectOption(eventId)
 const response=organiser.page.waitForResponse(r=>r.url().includes('/rest/v1/rpc/rpc_notify_ops_schedule_change')&&r.request().method()==='POST')
 await organiser.page.getByRole('button',{name:/^Notify crew/}).click()
 const saved=await response;expect(saved.ok()).toBe(true);expect((await saved.json()).queued).toBe(2)
 await expect(organiser.page.getByRole('alert')).toContainText('Telegram alerts queued for 2 crew members.')
 // Assert: each intended member reads their own real queued record, with no outsider access.
 for(const actor of [organiser,member]){
  const rows=await actor.get('/rest/v1/notifications?type=eq.OPS_SCHEDULE_CHANGED&order=created_at.desc')
  const row=rows.find(n=>n.body.includes(name));expect(row).toBeTruthy();expect(row.recipient_member_id).toBe(actor.memberId)
  notices.push([actor,row.id]);expect(await outsider.get('/rest/v1/notifications?id=eq.'+row.id)).toEqual([])
 }
 const denied=await outsider.rpcRaw('rpc_notify_ops_schedule_change',{p_club_id:10,p_event_id:eventId})
 expect(denied.status()).toBe(403)
})
