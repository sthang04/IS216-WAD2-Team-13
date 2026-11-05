// SUPPORT FILE PURPOSE: journeys.js supplies shared setup or controlled data for the browser workflows.
// Keep this support code: the Playwright tests depend on consistent setup and isolated state.
﻿import {expect} from './app.js'

export const eventSelect=page=>page.getByRole('region',{name:'Scenario builder',exact:true}).getByLabel('Event',{exact:true})
export async function runDelay(page){
 await page.getByLabel('Disruption type',{exact:true}).selectOption('SCHEDULE_DELAY')
 await page.getByLabel('Delay (minutes)',{exact:true}).fill('30')
 await page.getByRole('button',{name:'Run simulation (1)',exact:true}).click()
 await expect(page.getByText('Simulation complete',{exact:true})).toBeVisible()
}
export const room=(page,name)=>page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})})
export async function openScheduleForm(page,title='Fixture custom rehearsal'){
 await page.getByRole('button',{name:'Add Event / Class',exact:true}).click()
 const modal=page.locator('.modal.show')
 await modal.getByPlaceholder('e.g. IS216 Lab, Rehearsal Warmup, Team Debrief').fill(title)
 // Keep schedule examples on the day of the fixture's baseline classes.
 await modal.locator('input[type=date]').fill('2026-10-23')
 return modal
}
export const scheduleCard=(page,title)=>page.locator('.pulse-card').filter({has:page.getByRole('heading',{name:title,exact:true})})
export async function downloadText(page,action){
 const waiting=page.waitForEvent('download')
 await action()
 const download=await waiting
 const stream=await download.createReadStream()
 let text=''
 for await(const part of stream)text+=part.toString()
 expect(await download.failure()).toBeNull()
 return {text,name:download.suggestedFilename()}
}
// Deprecated: public guest entry was removed. No current test calls this helper.
// Retained for review only; removal is proposed in docs/testing-audit.md, pending your approval.
export async function guest(page,app,path){
 await app.open('/')
 await page.getByRole('button',{name:/explore live facility calendar as guest/i}).click()
 await expect(page).toHaveURL(/facilities$/)
 await page.goto(path)
}
export async function fit(page){
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width+1)
}
