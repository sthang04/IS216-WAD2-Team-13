// BROWSER TEST PURPOSE: navigation user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
﻿import {test,expect} from './fixtures/app.js'

test('anonymous direct route returns to the requested page after login',async({page,app})=>{
 await app.open('/personal-schedule')
 await expect(page).toHaveURL(/redirect=/)
 await app.login()
 await expect(page).toHaveURL(/\/personal-schedule$/)
 await expect(page.getByRole('heading',{name:/Hi Fixture Exco/})).toBeVisible()
})

test('club navigation supports history, refresh and account-menu Escape',async({page,app})=>{
 await app.open('/facilities',{authenticated:true})
 await app.navigate('schedule','Personal Schedule')
 await expect(page.getByRole('heading',{name:/Hi Fixture Exco/})).toBeVisible()
 await app.navigate('heatmap','Availability Heatmap')
 await expect(page.getByRole('heading',{name:'Weekly Meeting Scheduler',exact:true})).toBeVisible()
 await page.goBack()
 await expect(page).toHaveURL(/\/personal-schedule$/)
 await page.goForward()
 await expect(page).toHaveURL(/\/availability$/)
 await page.reload()
 await expect(page.getByRole('heading',{name:'Weekly Meeting Scheduler',exact:true})).toBeVisible()
 await app.account()
 const account=page.getByRole('button',{name:'Account menu for Fixture Exco',exact:true})
 await expect(account).toHaveAttribute('aria-expanded','true')
 await page.keyboard.press('Escape')
 await expect(account).toHaveAttribute('aria-expanded','false')
})

test('OSL role opens review and cannot navigate directly to student operations',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,role:'admin'})
 await expect(page.getByRole('button',{name:'Personal Schedule',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'OSL Review',exact:true}).click()
 await expect(page).toHaveURL(/\/facilities\/admin$/)
 await expect(page.getByRole('heading',{name:'Pending Admin Sign-off (0)',exact:true})).toBeVisible()
 await page.goto('/operations')
 await expect(page).toHaveURL(/\/facilities$/)
 await expect(page.getByRole('heading',{name:'Pulse - Master Facility Calendar',exact:true})).toBeVisible()
})

test('club member is redirected away from OSL review',async({page,app})=>{
 await app.open('/facilities/admin',{authenticated:true,role:'member'})
 await expect(page).toHaveURL(/\/facilities$/)
 await expect(page.getByRole('heading',{name:'Pulse - Master Facility Calendar',exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'OSL Review',exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Reset Demo',exact:true})).toHaveCount(0)
})

// Guest entry was removed; verify the supported signed-out boundary instead.
test('signed-out access to /facilities/admin requests login without exposing protected controls',async({page,app})=>{
 await app.open('/facilities/admin')
 await expect(page).toHaveURL(/redirect=/)
 await expect(page.locator('input[name="smu_user_password"]')).toBeVisible()
 await expect(page.getByRole('button',{name:/explore live facility calendar as guest/i})).toHaveCount(0)
 await page.reload()
 await expect(page.locator('input[name="smu_user_password"]')).toBeVisible()
 await expect(page.getByRole('button',{name:'Submit claim',exact:true})).toHaveCount(0)
})

test('unknown route falls back to public landing without exposing a protected page',async({page,app})=>{
 await app.open('/does-not-exist')
 await expect(page).toHaveURL(/\/$/)
 await expect(page.locator('input[name="smu_user_login_email"]')).toBeVisible()
})

test('ordinary membership stays view-only in its club dashboard',async({page,app})=>{
 await app.open('/facilities/my-club',{authenticated:true,role:'member'})
 await expect(page.getByText('View only.',{exact:true})).toBeVisible()
 await expect(page.getByText(/Release and claim are limited to Fixture Arts Club/)).toBeVisible()
 await expect(page.getByRole('heading',{name:'My Assigned Bookings',exact:true})).toBeVisible()
 await page.getByRole('link',{name:'Waitlist',exact:true}).click()
 await expect(page).toHaveURL(/\/facilities\/waitlist$/)
 await expect(page.getByRole('heading',{name:'In the queue',exact:true})).toBeVisible()
})
