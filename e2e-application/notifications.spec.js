// BROWSER TEST PURPOSE: notifications user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
﻿import {test,expect} from './fixtures/app.js'
const bell=page=>page.getByRole('button',{name:/^Notifications, \d+ unread$/})
const notice=page=>page.getByRole('button',{name:/Fixture schedule update Review your synthetic assignment/})

test('notification opens its actual route and read state survives reload',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,notifications:true})
 await expect(bell(page)).toHaveAccessibleName('Notifications, 2 unread')
 await bell(page).click()
 await page.getByRole('button',{name:/Fixture schedule update/}).click()
 await expect(page).toHaveURL(/personal-schedule$/)
 await expect(page.getByRole('heading',{name:/Hi Fixture Exco/})).toBeVisible()
 await expect(bell(page)).toHaveAccessibleName('Notifications, 1 unread')
 await page.reload()
 await expect(bell(page)).toHaveAccessibleName('Notifications, 1 unread')
})

test('mark all read updates count and persists through reload',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,notifications:true})
 await bell(page).click()
 await page.getByRole('button',{name:'Mark all read',exact:true}).click()
 await expect(bell(page)).toHaveAccessibleName('Notifications, 0 unread')
 await page.reload()
 await expect(bell(page)).toHaveAccessibleName('Notifications, 0 unread')
})

test('keyboard Delete removes one notification and preserves the other',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,notifications:true})
 await bell(page).click()
 const notification=page.getByRole('button',{name:/Fixture schedule update/})
 await notification.focus()
 await page.keyboard.press('Delete')
 await expect(notification).toHaveCount(0)
 await expect(page.getByRole('button',{name:/Fixture facility update/})).toBeVisible()
 await expect(bell(page)).toHaveAccessibleName('Notifications, 1 unread')
})

test('clear-all confirmation can be cancelled then leaves a persisted empty state',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,notifications:true})
 await bell(page).click()
 page.once('dialog',dialog=>dialog.dismiss())
 await page.getByRole('button',{name:'Clear all',exact:true}).click()
 await expect(page.getByRole('button',{name:/Fixture schedule update/})).toBeVisible()
 page.once('dialog',dialog=>dialog.accept())
 await page.getByRole('button',{name:'Clear all',exact:true}).click()
 await expect(page.getByText('Nothing yet.',{exact:true})).toBeVisible()
 await page.reload()
 await bell(page).click()
 await expect(page.getByText('Nothing yet.',{exact:true})).toBeVisible()
})

test('failed notification deletion restores the item and reports failure',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,notifications:true,rpcError:'rpc_delete_notifications'})
 await bell(page).click()
 const notification=page.getByRole('button',{name:/Fixture schedule update/})
 await notification.focus();await page.keyboard.press('Delete')
 await expect(page.getByRole('status').filter({hasText:'Fixture operation denied'})).toBeVisible()
 await expect(notification).toBeVisible()
 await expect(bell(page)).toHaveAccessibleName('Notifications, 2 unread')
})

test('notification panel closes with Escape and outside pointer interaction',async({page,app})=>{
 await app.open('/facilities',{authenticated:true})
 await bell(page).click()
 await expect(page.getByText('Nothing yet.',{exact:true})).toBeVisible()
 await page.keyboard.press('Escape')
 await expect(bell(page)).toHaveAttribute('aria-expanded','false')
 await bell(page).click()
 await page.getByRole('heading',{name:'Pulse - Master Facility Calendar',exact:true}).click()
 await expect(bell(page)).toHaveAttribute('aria-expanded','false')
})

test('failed mark-read does not falsely present unread notifications as read',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,notifications:true,rpcError:'rpc_mark_notifications_read'})
 await bell(page).click()
 await page.getByRole('button',{name:'Mark all read',exact:true}).click()
 // A refused mark-read request must preserve the unread count.
 await expect(bell(page)).toHaveAccessibleName('Notifications, 2 unread')
})

test('Telegram linking failure is visible and does not open an external bot',async({page,app})=>{
 await app.open('/facilities',{authenticated:true,rpcError:'rpc_create_telegram_link_code'})
 await bell(page).click()
 await page.getByRole('button',{name:'Connect Telegram',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Fixture operation denied'})).toBeVisible()
})
