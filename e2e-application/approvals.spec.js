// BROWSER TEST PURPOSE: approvals user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
﻿import {test,expect} from './fixtures/app.js'

test('recent decisions list the latest action first and a late transfer reads as rejected',async({page,app})=>{
 const decision=(transfer_id,state,decided_at,booking_date,fbs_reference,rejection_reason=null)=>({transfer_id,state,decided_at,booking_date,fbs_reference,rejection_reason,
  start_time:'10:00:00',end_time:'11:00:00',facility_name:'Fixture Studio',releasing_club_name:'Fixture One',claiming_club_name:'Fixture Two',audit_voucher_id:'#V'+transfer_id})
 await app.open('/facilities/admin',{authenticated:true,role:'admin',facilities:true,decisions:[
  decision(1,'APPROVED','2026-11-01T01:00:00Z','2026-11-20','FBS-MIDDLE'),
  decision(2,'EXPIRED','2026-11-03T01:00:00Z','2026-11-04','FBS-LATEST','Late approval: OSL did not sign off'),
  decision(3,'REJECTED','2026-10-30T01:00:00Z','2026-11-30','FBS-OLDEST','Wrong slip')]})
 const rows=page.locator('section',{has:page.getByRole('heading',{name:'Recent decisions',exact:true})}).locator('tbody tr')
 await expect(rows).toHaveCount(3)
 await expect(rows.nth(0)).toContainText('FBS-LATEST')
 await expect(rows.nth(0)).toContainText('Rejected')
 await expect(rows.nth(0)).toContainText('Late approval')
 await expect(rows.nth(1)).toContainText('FBS-MIDDLE')
 await expect(rows.nth(2)).toContainText('FBS-OLDEST')
 await page.getByLabel('Sort transfers',{exact:true}).selectOption('name-asc')
 await expect(rows.nth(0)).toContainText('FBS-LATEST')
 await page.getByLabel('Search transfers',{exact:true}).fill('FBS-OLDEST')
 await expect(rows).toHaveCount(1)
})

test('OSL searches pending requests, inspects audit evidence and restores search',async({page,app})=>{
 await app.open('/facilities/admin',{authenticated:true,role:'admin',facilities:true,transfers:true})
 await expect(page.getByRole('heading',{name:'Awaiting OSL approval (1)',exact:true})).toBeVisible()
 await page.getByLabel('Search transfers',{exact:true}).fill('does not exist')
 await expect(page.getByText('No pending transfers match your search.',{exact:true})).toBeVisible()
 await page.getByLabel('Search transfers',{exact:true}).fill('FIXTURE-FBS-502')
 await page.getByLabel('Sort transfers',{exact:true}).selectOption('name-asc')
 await page.getByRole('button',{name:'Show audit history',exact:true}).click()
 await expect(page.locator('ol.pulse-timeline')).toContainText('Claimed')
 await expect(page.locator('ol.pulse-timeline')).toContainText('Fixture Exco')
})

test('approval changes pending request to an approved recent decision',async({page,app})=>{
 await app.open('/facilities/admin',{authenticated:true,role:'admin',facilities:true,transfers:true})
 await page.getByRole('button',{name:'Approve',exact:true}).click()
 await page.getByRole('dialog',{name:'Approve this transfer?',exact:true}).getByRole('button',{name:'Approve transfer',exact:true}).click()
 await expect(page.getByText('Nothing is waiting for approval.',{exact:true})).toBeVisible()
 await expect(page.getByRole('row').filter({hasText:'FIXTURE-FBS-502'})).toContainText('Approved')
 await expect(page.getByRole('row').filter({hasText:'FIXTURE-FBS-502'})).toContainText('QUEUED')
})

test('rejection requires a reason and preserves it in decision history',async({page,app})=>{
 await app.open('/facilities/admin',{authenticated:true,role:'admin',facilities:true,transfers:true})
 await page.getByRole('button',{name:'Reject',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Reject this transfer?',exact:true})
 await expect(dialog.getByRole('button',{name:'Reject transfer',exact:true})).toBeDisabled()
 await dialog.getByLabel('Reason (shared with both CCAs)',{exact:true}).fill('Fixture booking slip does not match')
 await dialog.getByRole('button',{name:'Reject transfer',exact:true}).click()
 const decision=page.getByRole('row').filter({hasText:'FIXTURE-FBS-502'})
 await expect(decision).toContainText('Rejected')
 await expect(decision).toContainText('Fixture booking slip does not match')
})

test('failed approval retains pending request and displays refusal',async({page,app})=>{
 await app.open('/facilities/admin',{authenticated:true,role:'admin',facilities:true,transfers:true,rpcError:'rpc_approve_transfer'})
 await page.getByRole('button',{name:'Approve',exact:true}).click()
 await page.getByRole('dialog',{name:'Approve this transfer?',exact:true}).getByRole('button',{name:'Approve transfer',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Fixture operation denied'})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Awaiting OSL approval (1)',exact:true})).toBeVisible()
 await expect(page.getByText('No decisions yet.',{exact:true})).toBeVisible()
})

test('transfer deep link opens request and closes without losing review route',async({page,app})=>{
 await app.open('/facilities/admin?transfer=801',{authenticated:true,role:'admin',facilities:true,transfers:true})
 const dialog=page.getByRole('dialog',{name:'Transfer request',exact:true})
 await expect(dialog).toContainText('FIXTURE-AUDIT-801')
 await dialog.getByRole('button',{name:'Close',exact:true}).click()
 await expect(dialog).toHaveCount(0)
 await expect(page).toHaveURL(/\/facilities\/admin$/)
})
