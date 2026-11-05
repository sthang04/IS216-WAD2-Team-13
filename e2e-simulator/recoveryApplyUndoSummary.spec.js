// BROWSER TEST PURPOSE: recovery Apply/Undo summaries user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
// Purpose: fixture-backed recovery Apply/Undo summaries browser regressions for simulator controls and state.
// Use Setup -> Actions -> Assert; real Vue/engine code runs, but these tests do not prove live Supabase integration.
import {test,expect} from '../e2e/helpers/browserUi.js'
import {bootRecovery,confirmRecovery} from './helpers/recoveryHarness.js'
async function applied(page){const panel=await bootRecovery(page);await panel.getByRole('button',{name:'Apply selected recovery',exact:true}).click();await confirmRecovery(panel);await expect(panel.getByRole('region',{name:'Applied recovery',exact:true})).toBeVisible();return panel}
// Mutations use the existing in-memory RPC harness; no external requests are allowed.
test('applied summary, exact reversal, cancellation and saved Undo inspection',async({page},testInfo)=>{
 const panel=await applied(page)
 await expect(panel.getByRole('region',{name:'Applied recovery',exact:true})).toContainText('1 member assignment changed')
 await panel.getByRole('button',{name:'View history',exact:true}).click();await expect(panel.getByLabel('Recovery change history',{exact:true})).toContainText('APPLY')
 await panel.getByRole('region',{name:'Saved Recoveries',exact:true}).getByRole('button',{name:'Review Undo',exact:true}).click()
 await panel.getByRole('button',{name:'Undo Recovery Plan',exact:true}).click()
 const dialog=panel.getByRole('dialog',{name:'Action confirmation',exact:true})
 await expect(dialog).toContainText('Undo applied recovery?');await expect(dialog).toContainText('Fixture exact standby');await expect(dialog).toContainText('Fixture affected member');await expect(dialog).toContainText('Event schedule')
 await expect(dialog).toContainText('bookings are not cancelled')
 await dialog.screenshot({path:testInfo.outputPath('undo-confirmation.png')})
 await dialog.getByRole('button',{name:'Dismiss action',exact:true}).click();await expect(dialog).toHaveCount(0)
 expect(await page.evaluate(()=>window.__localCalls.filter(c=>c.name==='rpc_simulator_undo_plan'))).toEqual([])
 expect(await page.evaluate(()=>window.__localPlan.application_status)).toBe('Applied')
})
test('denied Undo retains applied records and audit history',async({page})=>{
 const panel=await applied(page);await page.evaluate(()=>{window.__denyOperation=true})
 await panel.getByRole('button',{name:'Undo Recovery Plan',exact:true}).click();await confirmRecovery(panel)
 await expect(panel.getByRole('alert')).toContainText('permission required')
 await expect(panel.getByRole('region',{name:'Applied recovery',exact:true})).toBeVisible()
 expect(await page.evaluate(()=>window.__localPlan.application_status)).toBe('Applied')
 expect(await page.evaluate(()=>window.__audit.map(a=>a.action))).toEqual(['APPLY'])
})
test('successful Undo is displayed only after the backend response and history is retained',async({page})=>{
 const panel=await applied(page)
 await panel.locator('#resolution-1').fill('Original member independently confirmed availability.')
 await panel.getByRole('button',{name:'Mark disruption 1 resolved',exact:true}).click();await confirmRecovery(panel)
 await expect(panel).toContainText('Explicitly resolved')
 await panel.getByRole('button',{name:'Undo Recovery Plan',exact:true}).click()
 await expect(panel.getByRole('region',{name:'Undone recovery',exact:true})).toHaveCount(0)
 await confirmRecovery(panel)
 await expect(panel.getByRole('region',{name:'Undone recovery',exact:true})).toContainText('Recovery undo completed')
 await panel.getByRole('button',{name:'View recovery history',exact:true}).click()
 await expect(panel.getByLabel('Recovery change history',{exact:true})).toContainText('UNDO')
 expect(await page.evaluate(()=>window.__audit.map(a=>a.action))).toEqual(['APPLY','DISRUPTION_RESOLVED','UNDO'])
})
