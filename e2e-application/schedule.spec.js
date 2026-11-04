// BROWSER TEST PURPOSE: schedule user workflows and regression coverage.
// Setup opens the real Vue UI; actions use its controls; assertions check visible results/state.
// Uses isolated fixture responses; passing UI checks do not prove deployed database or delivery integration.
﻿import {test,expect} from './fixtures/app.js'
import {openScheduleForm,scheduleCard,downloadText,guest} from './fixtures/journeys.js'

test('create, edit, toggle and delete a custom personal schedule entry',async({page,app})=>{
 await app.open('/personal-schedule',{authenticated:true})
 const modal=await openScheduleForm(page)
 await modal.getByPlaceholder('e.g. Bring dance sneakers, project slide deck ready.').fill('Fixture preparation notes')
 await modal.getByRole('button',{name:'Add to Schedule',exact:true}).click()
 let card=scheduleCard(page,'Fixture custom rehearsal')
 await expect(card).toContainText('Fixture preparation notes')
 await card.getByRole('button',{name:'Not Started',exact:true}).click()
 await expect(card.getByRole('button',{name:'In Progress',exact:true})).toBeVisible()
 await card.getByRole('button',{name:'Edit',exact:true}).click()
 await page.getByPlaceholder('e.g. IS216 Lab, Rehearsal Warmup, Team Debrief').fill('Fixture updated rehearsal')
 await page.getByRole('button',{name:'Save Changes',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Fixture custom rehearsal',exact:true})).toHaveCount(0)
 card=scheduleCard(page,'Fixture updated rehearsal')
 await expect(card.getByRole('button',{name:'In Progress',exact:true})).toBeVisible()
 await card.getByRole('button',{name:'Delete',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Fixture updated rehearsal',exact:true})).toHaveCount(0)
})

test('required title prevents empty schedule submission and Cancel discards edits',async({page,app})=>{
 await app.open('/personal-schedule',{authenticated:true})
 await page.getByRole('button',{name:'Add Event / Class',exact:true}).click()
 const modal=page.locator('.modal.show')
 await modal.getByRole('button',{name:'Add to Schedule',exact:true}).click()
 await expect(modal).toBeVisible()
 expect(await modal.getByPlaceholder('e.g. IS216 Lab, Rehearsal Warmup, Team Debrief').evaluate(e=>e.validity.valueMissing)).toBe(true)
 await modal.getByRole('button',{name:'Cancel',exact:true}).click()
 await expect(modal).toHaveCount(0)
})

test('category filter includes only academic entries and restores all events',async({page,app})=>{
 await app.open('/personal-schedule',{authenticated:true})
 await page.getByRole('button',{name:'Academic',exact:true}).click()
 await expect(page.getByRole('heading',{name:'IS216 Web Application Development II (G1)',exact:true})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Act 2 Audio & Lighting Programming',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:/All Events/}).click()
 await expect(page.getByRole('heading',{name:'Act 2 Audio & Lighting Programming',exact:true})).toBeVisible()
})

test('calendar download contains custom title, venue and Singapore timestamps',async({page,app})=>{
 await app.open('/personal-schedule',{authenticated:true})
 const modal=await openScheduleForm(page,'Fixture exported event')
 await modal.getByRole('button',{name:'Add to Schedule',exact:true}).click()
 const {text,name}=await downloadText(page,()=>page.getByRole('button',{name:'Sync / Export .ics',exact:true}).click())
 expect(name).toMatch(/\.ics$/)
 expect(text).toContain('BEGIN:VCALENDAR')
 expect(text).toContain('SUMMARY:Fixture exported event')
 // 17:15 Singapore is 09:15 UTC; the current exporter uses portable UTC timestamps.
 expect(text).toContain('DTSTART:20261023T091500Z')
 expect(text).toContain('LOCATION:Studio L7.2')
})

test('overlapping academic and custom events display a clash warning',async({page,app})=>{
 await app.open('/personal-schedule',{authenticated:true})
 const modal=await openScheduleForm(page,'Fixture overlapping rehearsal')
 await modal.locator('input[type=time]').nth(0).fill('16:00')
 await modal.locator('input[type=time]').nth(1).fill('16:30')
 await modal.getByRole('button',{name:'Add to Schedule',exact:true}).click()
 await expect(scheduleCard(page,'Fixture overlapping rehearsal')).toContainText('Clash Detected')
 await expect(page.getByText('Academic Timetable Conflict Detected',{exact:true})).toBeVisible()
})

test('guest cannot create, edit, delete or toggle personal schedule state',async({page,app})=>{
 await guest(page,app,'/personal-schedule')
 await page.getByRole('button',{name:'Add Event / Class',exact:true}).click()
 await expect(page.getByText(/Guest view is read-only/).first()).toBeVisible()
 await expect(page.locator('.modal.show')).toHaveCount(0)
 const title='IS216 Web Application Development II (G1)'
 const card=scheduleCard(page,title)
 await card.getByRole('button',{name:'Delete',exact:true}).click()
 await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible()
 await card.getByRole('button',{name:'Edit',exact:true}).click()
 await expect(page.locator('.modal.show')).toHaveCount(0)
 await card.getByRole('button',{name:'Completed',exact:true}).click()
 await expect(card.getByRole('button',{name:'Completed',exact:true})).toBeVisible()
})

test('end time preceding start time is rejected by the schedule form',async({page,app})=>{
 await app.open('/personal-schedule',{authenticated:true})
 const modal=await openScheduleForm(page,'Fixture reversed interval')
 await modal.locator('input[type=time]').nth(0).fill('18:00')
 await modal.locator('input[type=time]').nth(1).fill('17:00')
 await modal.getByRole('button',{name:'Add to Schedule',exact:true}).click()
 // Keep invalid intervals open for correction and never add them to the schedule.
 await expect(modal).toBeVisible()
 await expect(page.getByRole('heading',{name:'Fixture reversed interval',exact:true})).toHaveCount(0)
})

