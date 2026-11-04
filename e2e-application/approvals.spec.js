// BROWSER TEST PURPOSE: approvals user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
﻿import {test,expect} from './fixtures/app.js'

test('OSL searches pending requests, inspects audit evidence and restores search',async({page,app})=>{
 await app.open('/facilities/admin',{authenticated:true,role:'admin',facilities:true,transfers:true})
 await expect(page.getByRole('heading',{name:'Pending Admin Sign-off (1)',exact:true})).toBeVisible()
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
 await expect(page.getByRole('heading',{name:'Pending Admin Sign-off (1)',exact:true})).toBeVisible()
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
