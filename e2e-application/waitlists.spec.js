// BROWSER TEST PURPOSE: waitlists user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
﻿import {test,expect} from './fixtures/app.js'
import {room} from './fixtures/journeys.js'

test('join queue, inspect position and leave through the actual waitlist page',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,facilities:true})
 await room(page,'Fixture Sports Hall').getByRole('button',{name:'Join waitlist',exact:true}).click()
 await expect(room(page,'Fixture Sports Hall')).toContainText('0 CCAs in front of you')
 await page.getByRole('link',{name:/^Waitlist/}).click()
 await expect(page.getByText('#1 in queue',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'View queue',exact:true}).click()
 await expect(page.locator('ol.pulse-queue')).toContainText('Fixture Arts Club')
 await page.getByRole('button',{name:'Hide queue',exact:true}).click()
 await expect(page.locator('ol.pulse-queue')).toHaveCount(0)
 await page.getByRole('button',{name:'Leave',exact:true}).click()
 await expect(page.getByText('Fixture Arts Club is not queuing for any slot.',{exact:true})).toBeVisible()
})

test('offer acceptance requires review and updates the booking to pending sign-off',async({page,app})=>{
 await app.open('/facilities/waitlist',{authenticated:true,facilities:true,offer:true})
 await expect(page.getByText('30:00',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Accept and claim',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Accept this waitlist offer?',exact:true})
 await expect(dialog).toContainText('Fixture Music Room')
 await dialog.getByRole('button',{name:'Accept and claim',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Pending Admin Sign-off'})).toBeVisible()
 await expect(page.getByRole('button',{name:'Accept and claim',exact:true})).toHaveCount(0)
 await page.getByRole('link',{name:'All Facilities',exact:true}).click()
 await expect(room(page,'Fixture Music Room')).toContainText('Pending Admin Sign-off')
})

test('declining an offer supports cancellation before removing it',async({page,app})=>{
 await app.open('/facilities/waitlist',{authenticated:true,facilities:true,offer:true})
 page.once('dialog',dialog=>dialog.dismiss())
 await page.getByRole('button',{name:'Decline',exact:true}).click()
 await expect(page.getByRole('button',{name:'Accept and claim',exact:true})).toBeEnabled()
 page.once('dialog',dialog=>dialog.accept())
 await page.getByRole('button',{name:'Decline',exact:true}).click()
 await expect(page.getByRole('button',{name:'Accept and claim',exact:true})).toHaveCount(0)
 await expect(page.getByRole('status').filter({hasText:'Offer declined.'})).toBeVisible()
})

test('read-only member cannot accept or decline another club role offer',async({page,app})=>{
 await app.open('/facilities/waitlist',{authenticated:true,role:'member',facilities:true,offer:true})
 await expect(page.getByRole('button',{name:'Accept and claim',exact:true})).toBeDisabled()
 await expect(page.getByRole('button',{name:'Decline',exact:true})).toBeDisabled()
 await expect(page.getByText('View only.',{exact:true})).toBeVisible()
})

test('failed queue join reports an error without creating membership',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,facilities:true,rpcError:'rpc_join_waitlist'})
 const card=room(page,'Fixture Sports Hall')
 await card.getByRole('button',{name:'Join waitlist',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Fixture operation denied'})).toBeVisible()
 await expect(card.getByRole('button',{name:'Join waitlist',exact:true})).toBeEnabled()
})

test('expired offer disables acceptance without pretending server expiry occurred',async({page,app})=>{
 await page.clock.setFixedTime(new Date('2026-11-03T10:31:00+08:00'))
 await app.open('/facilities/waitlist',{authenticated:true,facilities:true,offer:true})
 await expect(page.getByText('00:00',{exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Accept and claim',exact:true})).toBeDisabled()
})
