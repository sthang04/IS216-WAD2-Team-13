import {test,expect} from '@playwright/test'
import {bootRecovery} from './helpers/recoveryHarness.js'
const stage=(panel,name)=>panel.getByRole('tablist',{name:'Recovery stages'}).getByRole('tab').filter({hasText:name})
// These are persisted-record-shaped fixtures, not live approvals. Stage checks
// use only read refreshes; no invitation, booking or Apply RPC is dispatched.
for(const [status,tone] of [['Pending','pending'],['Accepted','complete'],['Declined','blocked']])test('member '+status+' maps to '+tone+' with tracker navigation',async({page})=>{
 const panel=await bootRecovery(page,{acknowledge:false});await page.evaluate(status=>{window.__localInvitation.status=status},status);await panel.getByRole('button',{name:'Refresh statuses',exact:true}).click()
 await expect(stage(panel,'Member acceptance')).toHaveAttribute('data-status-tone',tone);await expect(panel.getByLabel('Stage Status Guide',{exact:true})).toHaveCount(1)
 await stage(panel,'Member acceptance').click();const tracker=panel.getByRole('region',{name:'Pending recovery requirements',exact:true});await expect(tracker).toContainText(status==='Pending'?'Awaiting response':status)
 await expect(tracker).toContainText('Organiser review (local)')
 expect(await page.evaluate(()=>window.__localCalls.filter(c=>/apply_plan|invite$|attach_booking/.test(c.name)))).toEqual([])
})
for(const [status,tone] of [['Pending','pending'],['Approved','complete'],['Rejected','blocked'],[null,'unavailable']])test('facility '+status+' is a recorded stage status, never inferred vacancy',async({page})=>{
 const panel=await bootRecovery(page,{acknowledge:false});await page.evaluate(status=>{window.__localPlan.changes.push({segmentId:1,venueName:'Fixture Alternative Room',facilityBookingId:2});window.__localPlan.actions.push({kind:'Room',segmentId:1,status})},status);await panel.getByRole('button',{name:'Refresh statuses',exact:true}).click()
 await expect(stage(panel,'Facility approval')).toHaveAttribute('data-status-tone',tone);await stage(panel,'Facility approval').click();await expect(panel.getByRole('region',{name:'Pending recovery requirements'})).toContainText(status || 'Booking verification unavailable')
 if(status!=='Approved')await expect(panel.getByRole('button',{name:'Apply selected recovery',exact:true})).toHaveCount(0)
})
test('not-required stages, local acknowledgement, Apply readiness and read failures remain distinct',async({page})=>{
 const panel=await bootRecovery(page,{acknowledge:false});await expect(stage(panel,'Facility approval')).toHaveCount(0);await expect(stage(panel,'Organiser review')).toHaveAttribute('data-status-tone','pending')
 await stage(panel,'Organiser review').click();await panel.getByLabel('I manually checked personal availability, qualifications and facility suitability; incomplete data is not proof of availability.',{exact:true}).check();await expect(stage(panel,'Organiser review')).toHaveAttribute('data-status-tone','information');await expect(stage(panel,'Organiser review')).toContainText('Acknowledged locally');await expect(stage(panel,'Apply / Undo')).toContainText('Ready to apply')
 await page.evaluate(()=>{window.__denyHistory=true});await panel.getByRole('button',{name:'Refresh statuses',exact:true}).click();await expect(panel).toContainText('not authorized');await expect(stage(panel,'Member acceptance')).toHaveAttribute('data-status-tone','unavailable');await stage(panel,'Apply / Undo').click();await expect(panel.getByRole('button',{name:'Apply selected recovery',exact:true})).toBeDisabled()
})
test('timing-only recovery requires neither member acceptance nor facility approval',async({page})=>{
 const panel=await bootRecovery(page,{acknowledge:false});await page.evaluate(()=>{window.__localPlan.changes=window.__localPlan.changes.filter(c=>c.replacementMemberId==null);window.__localPlan.actions=[]});await panel.getByRole('button',{name:'Refresh statuses',exact:true}).click();for(const name of ['Member acceptance','Facility approval'])await expect(stage(panel,name)).toHaveCount(0)
 await panel.getByRole('group',{name:'Saved recovery views'}).getByRole('button',{name:'Applied',exact:true}).click();await expect(panel).toContainText('No recoveries in this view');await panel.getByRole('group',{name:'Saved recovery views'}).getByRole('button',{name:'All',exact:true}).click();await expect(panel.getByRole('button',{name:'Review saved recovery',exact:true})).toBeVisible()
})
