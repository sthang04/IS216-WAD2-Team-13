// BROWSER TEST PURPOSE: member Invitations user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
import {test,expect} from '@playwright/test'
import {readFileSync} from 'node:fs'
const client=readFileSync(new URL('./memberClient.js',import.meta.url),'utf8')
const service=readFileSync(new URL('../src/services/simulatorWorkflowService.js',import.meta.url),'utf8')
async function boot(page,path='/personal-schedule'){
 // Block all external requests before visiting the REAL app, router and page.
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
 await page.route('**/src/supabase.js*',route=>route.fulfill({contentType:'application/javascript',body:client}))
 await page.route('**/src/services/simulatorWorkflowService.js*',route=>route.fulfill({contentType:'application/javascript',body:service.replace(/^export const SIMULATOR_WORKFLOW_VERIFIED = .*$/m,'export const SIMULATOR_WORKFLOW_VERIFIED = true')}))
 await page.goto(path)
 await expect(page.getByRole('heading',{name:'My Replacement Invitations',exact:true})).toBeVisible()
 await expect(page.locator('#simulator-invitation-inbox')).toHaveAttribute('aria-busy','false')
}
const card=(page,id)=>page.locator('[data-invitation-id="'+id+'"]')
async function respond(page,id,verb){
 await card(page,id).getByRole('button',{name:verb+' this invitation',exact:true}).click()
 const box=page.getByLabel('Confirm invitation response',{exact:true})
 await box.getByRole('checkbox').check()
 await box.getByRole('button',{name:'Confirm invitation response',exact:true}).click()
 await expect(page.getByText('Response persisted.',{exact:false})).toBeVisible()
}
test('ordinary member uses actual PULSE navigation and sees complete invitation terms without organizer permission',async({page})=>{
 await boot(page)
 const mobile=page.getByLabel('Navigate PULSE',{exact:true})
 if(await mobile.isVisible()){
  await mobile.selectOption('heatmap');await mobile.selectOption('schedule')
 }else if(await page.getByRole('navigation',{name:'Mobile PULSE navigation',exact:true}).isVisible()){
  const nav=page.getByRole('navigation',{name:'Mobile PULSE navigation',exact:true})
  await nav.getByRole('button',{name:/Heatmap/}).click()
  await nav.getByRole('button',{name:/My Schedule/}).click()
 }else{
  await page.getByRole('button',{name:/^(Availability )?Heatmap$/,exact:true}).click()
  await page.getByRole('button',{name:/^(Personal )?Schedule$/,exact:true}).click()
 }
 await expect(page).toHaveURL(/personal-schedule/)
 const item=card(page,'accept-me')
 for(const text of ['Dance Showcase','Opening rehearsal','Stage crew','Gym Studio','Fixture Dance Club','SGT','Expires','Pending'])await expect(item).toContainText(text)
 await expect(item.getByRole('button',{name:'Accept this invitation',exact:true})).toBeEnabled()
 await expect(item.getByRole('button',{name:'Decline this invitation',exact:true})).toBeEnabled()
})
test('accept and decline update the exact mock records, survive reload, and drive the real organizer tracker service',async({page})=>{
 await boot(page);await respond(page,'accept-me','Accept');await respond(page,'decline-me','Decline')
 expect(await page.evaluate(()=>window.__memberInvitations.calls.filter(c=>c.name==='rpc_simulator_respond_invitation').map(c=>c.args))).toEqual([{p_invitation_id:'accept-me',p_response:'Accepted'},{p_invitation_id:'decline-me',p_response:'Declined'}])
 await page.reload()
 await expect(card(page,'accept-me')).toContainText('Accepted');await expect(card(page,'decline-me')).toContainText('Declined')
 for(const id of ['accept-me','decline-me'])for(const verb of ['Accept','Decline'])await expect(card(page,id).getByRole('button',{name:verb+' this invitation',exact:true})).toBeDisabled()
 const tracked=await page.evaluate(async()=>{
  const {supabase}=await import('/src/supabase.js');const {createSimulatorWorkflow}=await import('/src/services/simulatorWorkflowService.js');const {buildRecoveryTracker}=await import('/src/services/simulatorRecoveryTracker.js')
  const history=await createSimulatorWorkflow(supabase,{enabled:true}).history(1)
  return buildRecoveryTracker({plan:history.plans[0],invitations:history.invitations,enabled:true}).rows.find(r=>r.kind==='Member acceptance').status
 })
 expect(tracked).toContain('Accepted')
})
test('another member has no access to the invitation; direct forged response is rejected by the mock server',async({page})=>{
 await boot(page);await page.evaluate(()=>window.__memberInvitations.setMember(8))
 await expect(page.locator('[data-invitation-id]')).toHaveCount(0)
 await expect(page.locator('#simulator-invitation-inbox').getByText(/all caught up/)).toBeVisible()
 const result=await page.evaluate(async()=>{const {createSimulatorWorkflow}=await import('/src/services/simulatorWorkflowService.js');const {supabase}=await import('/src/supabase.js');try{await createSimulatorWorkflow(supabase,{enabled:true}).respond('accept-me','Accepted',true);return 'unexpected success'}catch(e){return e.message}})
 expect(result).toContain('Only the invited member')
})
test('expired and cancelled invitations cannot be answered',async({page})=>{
 await boot(page)
 for(const id of ['expired','cancelled'])for(const verb of ['Accept','Decline'])await expect(card(page,id).getByRole('button',{name:verb+' this invitation',exact:true})).toBeDisabled()
 await expect(card(page,'expired')).toContainText('Expired')
})
test('deep link scrolls and focuses the visible inbox; layout fits desktop and mobile',async({page})=>{
 await boot(page,'/personal-schedule#simulator-invitation-inbox')
 const inbox=page.locator('#simulator-invitation-inbox');await expect(inbox).toBeFocused()
 const box=await inbox.boundingBox(),header=await page.getByRole('banner').boundingBox();expect(box.y).toBeGreaterThanOrEqual(header.y+header.height);expect(box.y).toBeLessThan(header.height+40)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
 await page.screenshot({path:test.info().outputPath('member-invitations.png')})
})
test('friendly empty state and read failure remain distinct',async({page})=>{
 await boot(page);await page.evaluate(()=>window.__memberInvitations.empty());await page.getByRole('button',{name:'Refresh my invitations',exact:true}).click()
 await expect(page.locator('#simulator-invitation-inbox').getByText(/all caught up/)).toBeVisible()
 await page.evaluate(()=>window.__memberInvitations.readError=true);await page.getByRole('button',{name:'Refresh my invitations',exact:true}).click()
 await expect(page.getByText(/Inbox unavailable/)).toBeVisible();await expect(page.locator('#simulator-invitation-inbox').getByText(/all caught up/)).toHaveCount(0)
})
test('loading, write errors and disabled backend gate are visible and never imply success',async({page})=>{
 await boot(page);await page.evaluate(()=>{window.__memberInvitations.holdWrites=true;window.__memberInvitations.writeError=true})
 await card(page,'accept-me').getByRole('button',{name:'Accept this invitation',exact:true}).click()
 const box=page.getByLabel('Confirm invitation response',{exact:true});await box.getByRole('checkbox').check();await box.getByRole('button',{name:'Confirm invitation response',exact:true}).click()
 await expect(page.getByText(/^Saving your response/)).toBeVisible()
 await page.evaluate(()=>window.__memberInvitations.releaseWrites())
 await expect(page.getByRole('alert')).toContainText('Fixture response unavailable')
 await page.evaluate(()=>{window.__memberInvitations.gate=false;window.__memberInvitations.holdReads=true});await page.getByRole('button',{name:'Refresh my invitations',exact:true}).click()
 await expect(page.getByText(/^Loading your invitations/)).toBeVisible()
 await page.evaluate(()=>window.__memberInvitations.releaseReads())
 await expect(card(page,'accept-me').getByRole('button',{name:'Accept this invitation',exact:true})).toBeDisabled()
 await expect(page.getByText(/Responses are currently unavailable/)).toBeVisible()
})
