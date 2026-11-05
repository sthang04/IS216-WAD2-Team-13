// BROWSER TEST PURPOSE: recovery Action Centre user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
// Purpose: fixture-backed recovery Action Centre browser regressions for simulator controls and state.
// Use Setup -> Actions -> Assert; real Vue/engine code runs, but these tests do not prove live Supabase integration.
import {test,expect} from '../e2e/helpers/browserUi.js'
import {bootRecovery} from './helpers/recoveryHarness.js'
const tab=(panel,name)=>panel.getByRole('tab',{name:new RegExp(name)})
// All statuses and RPC responses come from isolated records; external traffic is blocked.
test('applicable inline stages support keyboard navigation and fit the viewport',async({page},testInfo)=>{
 const panel=await bootRecovery(page,{acknowledge:false}),url=page.url()
 const tabs=panel.getByRole('tab');await expect(tabs).toHaveCount(3)
 for(let i=0;i<3;i++){
  await tabs.nth(i).click();await expect(tabs.nth(i)).toHaveAttribute('aria-selected','true')
  await expect(panel.getByRole('tabpanel')).toHaveCount(1)
  await expect(panel.getByRole('tabpanel').getByRole('heading').first()).toHaveText(['Member acceptance','Organiser review','Apply / Undo'][i])
 }
 await tabs.nth(2).press('Home');await expect(tabs.nth(0)).toBeFocused()
 await tabs.nth(0).press('ArrowRight');await expect(tabs.nth(1)).toBeFocused()
 expect(page.url()).toBe(url)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.addStyleTag({content:'.simulator-back-to-top{display:none!important}'})
 await panel.screenshot({path:testInfo.outputPath('recovery-action-centre.png')})
})
test('invitation response and Telegram delivery remain separate with supplied timestamps',async({page})=>{
 const panel=await bootRecovery(page,{acknowledge:false})
 await page.evaluate(()=>Object.assign(window.__localInvitation,{status:'Pending',delivery_status:'FAILED',created_at:'2026-11-02T01:00:00Z'}))
 await panel.getByRole('button',{name:'Refresh statuses',exact:true}).click()
 await tab(panel,'Member acceptance').click()
 const details=panel.getByRole('tabpanel');await expect(details).toContainText('Awaiting response');await expect(details).toContainText(/failed/i);await expect(details.locator('dt')).toHaveText('Created');await expect(details).not.toContainText('Timestamps not supplied.')
 await expect(details.getByRole('button',{name:'Send replacement request',exact:true})).toBeDisabled()
 await tab(panel,'Apply / Undo').click();await expect(panel.getByRole('button',{name:'Apply selected recovery',exact:true})).toBeDisabled()
 expect(await page.evaluate(()=>window.__localCalls.filter(c=>/invite$|apply_plan/.test(c.name)))).toEqual([])
})
test('booking actions open in their stage while review remains local',async({page})=>{
 const panel=await bootRecovery(page,{acknowledge:false})
 await page.evaluate(()=>{window.__localPlan.changes.push({segmentId:1,venueName:'Fixture Original Room',facilityBookingId:1});window.__localPlan.actions.push({kind:'Room',segmentId:1,status:'Pending Approval'})})
 await panel.getByRole('button',{name:'Refresh statuses',exact:true}).click()
 await tab(panel,'Facility approval').click();const details=panel.getByRole('tabpanel')
 await expect(details).toContainText('Fixture Original Room');await expect(details).toContainText('Pending approval')
 await details.getByText(/Can't find your booking/).click();await expect(details.getByRole('link',{name:/Open Facility Calendar/})).toBeVisible()
 await expect(details.getByRole('button',{name:'Refresh booking records',exact:true})).toBeVisible()
 await tab(panel,'Organiser review').click();await expect(details).toContainText(/local/i)
 await expect(details.getByRole('checkbox')).toBeDisabled()
 await expect(panel.getByRole('button',{name:'Review saved recovery',exact:true})).toBeVisible()
})

test('only relevant stages appear and a removed active stage falls back safely',async({page})=>{
 const panel=await bootRecovery(page,{acknowledge:false})
 await expect(panel.getByRole('tab',{name:/Facility approval/})).toHaveCount(0)
 await page.evaluate(()=>{window.__localPlan.changes=window.__localPlan.changes.filter(c=>c.replacementMemberId==null);window.__localPlan.actions=[]})
 await panel.getByRole('button',{name:'Refresh statuses',exact:true}).click()
 await expect(panel.getByRole('tab')).toHaveCount(2)
 await expect(panel.getByRole('tab',{name:/Member acceptance/})).toHaveCount(0)
 await expect(panel.getByRole('tab',{name:/Organiser review/})).toHaveAttribute('aria-selected','true')
 await expect(panel.getByRole('tabpanel').getByRole('heading').first()).toHaveText('Organiser review')
})
