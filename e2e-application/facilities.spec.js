// BROWSER TEST PURPOSE: facilities user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
﻿import {test,expect} from './fixtures/app.js'
import {room} from './fixtures/journeys.js'

test('facility type, equipment, capacity and search filters constrain actual cards',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,facilities:true})
 await expect(page.locator('article.pulse-facility')).toHaveCount(3)
 await page.getByLabel('Facility Type',{exact:true}).selectOption('Music')
 await expect(page.locator('article.pulse-facility')).toHaveCount(1)
 await expect(room(page,'Fixture Music Room')).toBeVisible()
 await page.getByLabel('Facility Type',{exact:true}).selectOption('All')
 await page.getByLabel('Equipment',{exact:true}).selectOption('Mirrors')
 await expect(room(page,'Fixture Dance Studio')).toBeVisible()
 await expect(page.locator('article.pulse-facility')).toHaveCount(1)
 await page.getByLabel('Equipment',{exact:true}).selectOption('All')
 await page.getByLabel('Capacity',{exact:true}).selectOption('151+')
 await expect(room(page,'Fixture Sports Hall')).toBeVisible()
 await expect(page.locator('article.pulse-facility')).toHaveCount(1)
 await page.getByLabel('Capacity',{exact:true}).selectOption('any')
 await page.getByLabel('Search facility, CCA or equipment',{exact:true}).fill('no such fixture')
 await expect(page.getByRole('heading',{name:'No facilities match these filters',exact:true})).toBeVisible()
 await page.getByLabel('Search facility, CCA or equipment',{exact:true}).fill('Music')
 await expect(room(page,'Fixture Music Room')).toBeVisible()
})

test('release cancellation leaves booked state; confirmation and undo update calendar',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,facilities:true})
 const card=room(page,'Fixture Dance Studio')
 await card.getByRole('button',{name:'Release',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Release this slot?',exact:true})
 await expect(dialog).toContainText('Fixture Dance Studio')
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
 await expect(card.getByRole('button',{name:'Release',exact:true})).toBeEnabled()
 await card.getByRole('button',{name:'Release',exact:true}).click()
 await dialog.getByRole('button',{name:'Release slot',exact:true}).click()
 await expect(card).toContainText('Available to Claim')
 await card.getByRole('button',{name:'Undo Release',exact:true}).click()
 await page.getByRole('dialog',{name:'Undo this release?',exact:true}).getByRole('button',{name:'Undo release',exact:true}).click()
 await expect(card.getByRole('button',{name:'Release',exact:true})).toBeEnabled()
 await expect(card).toContainText('Booked')
})

test('claim stays pending and appears in My Club rather than claiming approval',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,facilities:true})
 const card=room(page,'Fixture Music Room')
 await card.getByRole('button',{name:'Claim',exact:true}).click()
 await page.getByRole('dialog',{name:'Claim this slot?',exact:true}).getByRole('button',{name:'Submit claim',exact:true}).click()
 await expect(card).toContainText('Awaiting OSL approval')
 await page.getByRole('link',{name:'My Club',exact:true}).click()
 const pending=page.locator('#section-pending')
 await expect(pending).toContainText('Fixture Music Room')
 await expect(pending).toContainText('Awaiting OSL approval')
})

test('failed claim leaves the slot claimable and reports the server refusal',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,facilities:true,rpcError:'rpc_claim_booking'})
 const card=room(page,'Fixture Music Room')
 await card.getByRole('button',{name:'Claim',exact:true}).click()
 await page.getByRole('dialog',{name:'Claim this slot?',exact:true}).getByRole('button',{name:'Submit claim',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Fixture operation denied'})).toBeVisible()
 await expect(card.getByRole('button',{name:'Claim',exact:true})).toBeEnabled()
 await expect(card).not.toContainText('Awaiting OSL approval')
})

test('week navigation changes URL and booking data, refresh preserves the week',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,facilities:true})
 await expect(room(page,'Fixture Music Room').getByRole('button',{name:'Claim',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Next week',exact:true}).click()
 await expect(page).toHaveURL(/week=2026-11-16/)
 await expect(page.getByText('No bookings at this facility for the selected week.')).toHaveCount(3)
 await page.reload()
 await expect(page.getByLabel('Jump to week',{exact:true})).toHaveValue('2026-11-16')
 await page.getByRole('button',{name:'Previous week',exact:true}).click()
 await expect(room(page,'Fixture Music Room').getByRole('button',{name:'Claim',exact:true})).toBeVisible()
})

test('calendar read failure is visible rather than inventing bookings',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,facilities:true,tableError:'v_master_facility_calendar'})
 await expect(page.getByRole('status').filter({hasText:'Could not load the calendar'})).toBeVisible()
 await expect(page.getByRole('button',{name:'Claim',exact:true})).toHaveCount(0)
})

// Guest entry was removed; verify the supported signed-out boundary instead.
test('signed-out access to /facilities requests login without exposing protected controls',async({page,app})=>{
 await app.open('/facilities')
 await expect(page).toHaveURL(/redirect=/)
 await expect(page.locator('input[name="smu_user_password"]')).toBeVisible()
 await expect(page.getByRole('button',{name:/explore live facility calendar as guest/i})).toHaveCount(0)
 await page.reload()
 await expect(page.locator('input[name="smu_user_password"]')).toBeVisible()
 await expect(page.getByRole('button',{name:'Submit claim',exact:true})).toHaveCount(0)
})

test('day tiles follow the search, and suggestions and capacity labels match real results',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,facilities:true})
 const tile=page.getByText('1 open',{exact:true})
 await expect(tile).toBeVisible()
 await page.getByLabel('Search facility, CCA or equipment',{exact:true}).fill('Fixture Dance')
 await expect(tile).toHaveCount(0)
 await page.getByLabel('Search facility, CCA or equipment',{exact:true}).fill('Fixture Music')
 await expect(tile).toBeVisible()
 await expect(page.getByRole('button',{name:'Connexion',exact:true})).toHaveCount(0)
 await expect(page.getByLabel('Capacity',{exact:true}).locator('option')).toContainText(['Any capacity','1–25 people','26–50 people','51–150 people','151+ people'])
})
